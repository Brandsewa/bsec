import dns from "node:dns/promises";
import type { LookupAddress, LookupOptions } from "node:dns";
import https from "node:https";
import type { IncomingHttpHeaders } from "node:http";
import { checkImageUrl, IMAGE_MAX_BYTES, isBlockedAddress, sniffImageMime } from "./image-guard.ts";

/**
 * Downloads one merchant-supplied image URL for the product import (docs/PRODUCT-BULK-IO-PLAN.md section 4).
 * Every hop: https only, DNS resolved here, every resolved address checked, and the request is pinned to the address
 * that passed (no second lookup, so DNS rebinding cannot swap it). Max 3 redirects, 15 s per hop, 10 MB, no cookies.
 */

export const IMAGE_FETCH_TIMEOUT_MS = 15_000;
export const IMAGE_MAX_REDIRECTS = 3;

export interface TransportResponse {
  status: number;
  headers: Record<string, string | undefined>;
  /** Async chunks of the body. The fetcher stops reading past the size cap. */
  body: AsyncIterable<Uint8Array>;
  destroy(): void;
}
export type Transport = (url: URL, ip: string, signal: AbortSignal) => Promise<TransportResponse>;
export type Resolver = (hostname: string) => Promise<string[]>;

export interface FetchedImage {
  bytes: Buffer;
  mime: "image/jpeg" | "image/png" | "image/gif" | "image/webp" | "image/avif";
  filename: string;
  finalUrl: string;
}

export class ImageFetchError extends Error {}

type LookupCb = (err: Error | null, address: string | LookupAddress[], family?: number) => void;

/** A `lookup` that always answers with the address that passed the checks. Node 20+ asks for a list (`all: true`) and expects one back. */
export const pinnedLookup = (ip: string) => (_host: string, opts: LookupOptions, cb: LookupCb): void => {
  const family = ip.includes(":") ? 6 : 4;
  if (opts.all) cb(null, [{ address: ip, family }]);
  else cb(null, ip, family);
};

const defaultResolver: Resolver = async (hostname) => (await dns.lookup(hostname, { all: true })).map((a) => a.address);

export const defaultTransport: Transport = (url, ip, signal) =>
  new Promise((resolve, reject) => {
    const req = https.request(
      {
        protocol: "https:",
        hostname: url.hostname,
        port: 443,
        path: `${url.pathname}${url.search}`,
        method: "GET",
        servername: url.hostname,
        headers: { host: url.host, "user-agent": "BrandSewaImageImport/1.0", accept: "image/*" },
        // The pinned address: the TLS name stays the hostname, the socket goes to the IP that was checked.
        lookup: pinnedLookup(ip),
        signal,
      },
      (res) => {
        const headers: Record<string, string | undefined> = {};
        for (const [k, v] of Object.entries(res.headers as IncomingHttpHeaders)) headers[k] = Array.isArray(v) ? v[0] : v;
        resolve({ status: res.statusCode ?? 0, headers, body: res, destroy: () => res.destroy() });
      },
    );
    req.on("error", reject);
    req.end();
  });

function filenameFor(url: URL, mime: FetchedImage["mime"]): string {
  const ext = { "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp", "image/avif": "avif" }[mime];
  const last = decodeURIComponent(url.pathname.split("/").filter(Boolean).pop() ?? "image").replace(/\.[a-z0-9]{2,5}$/i, "");
  const safe = last.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "image";
  return `${safe}.${ext}`;
}

export async function fetchImageSafely(rawUrl: string, deps: { resolve?: Resolver; transport?: Transport } = {}): Promise<FetchedImage> {
  const resolve = deps.resolve ?? defaultResolver;
  const transport = deps.transport ?? defaultTransport;
  let current = rawUrl;

  for (let hop = 0; hop <= IMAGE_MAX_REDIRECTS; hop++) {
    const checked = checkImageUrl(current);
    if (!checked.ok) throw new ImageFetchError(checked.reason);
    const url = checked.url;

    const host = url.hostname.replace(/^\[|\]$/g, "");
    let addresses: string[];
    try {
      addresses = /^[\d.]+$|:/.test(host) ? [host] : await resolve(host);
    } catch {
      throw new ImageFetchError("the host could not be found");
    }
    if (!addresses.length) throw new ImageFetchError("the host could not be found");
    if (addresses.some(isBlockedAddress)) throw new ImageFetchError("private or reserved addresses are not allowed");

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), IMAGE_FETCH_TIMEOUT_MS);
    try {
      const pinned = addresses[0];
      if (!pinned) throw new ImageFetchError("the host could not be found");
      const res = await transport(url, pinned, ac.signal);
      if (res.status >= 300 && res.status < 400) {
        res.destroy();
        const loc = res.headers["location"];
        if (!loc) throw new ImageFetchError(`redirect (${res.status}) without a location`);
        current = new URL(loc, url).toString();
        continue;
      }
      if (res.status !== 200) {
        res.destroy();
        throw new ImageFetchError(`the server answered ${res.status}`);
      }
      const declared = Number(res.headers["content-length"] ?? 0);
      if (declared > IMAGE_MAX_BYTES) {
        res.destroy();
        throw new ImageFetchError("the image is larger than 10 MB");
      }
      const chunks: Uint8Array[] = [];
      let total = 0;
      for await (const chunk of res.body) {
        total += chunk.length;
        if (total > IMAGE_MAX_BYTES) {
          res.destroy();
          throw new ImageFetchError("the image is larger than 10 MB");
        }
        chunks.push(chunk);
      }
      const bytes = Buffer.concat(chunks);
      const mime = sniffImageMime(bytes);
      if (!mime) throw new ImageFetchError("the file is not a JPEG, PNG, GIF, WebP or AVIF image");
      return { bytes, mime, filename: filenameFor(url, mime), finalUrl: url.toString() };
    } catch (e) {
      if (e instanceof ImageFetchError) throw e;
      if (ac.signal.aborted) throw new ImageFetchError("the download timed out");
      throw new ImageFetchError("the download failed");
    } finally {
      clearTimeout(timer);
    }
  }
  throw new ImageFetchError("too many redirects");
}
