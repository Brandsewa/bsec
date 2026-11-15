#!/usr/bin/env node
// Read-only SEO / GEO / AEO check of a deployed storefront (docs/SEO-GEO-AEO-PLAN.md).
// Usage: pnpm seo:audit https://store.example [--sample 25]
// Makes plain GET requests (about one per second) to the public site; never writes anything.
// Exit code 1 when a failure (not a warning) is found, so it can gate a deploy later.

const args = process.argv.slice(2);
const base = (args.find((a) => /^https?:\/\//.test(a)) ?? "").replace(/\/$/, "");
const sampleIdx = args.indexOf("--sample");
const sample = sampleIdx >= 0 ? Number(args[sampleIdx + 1]) || 25 : 25;
if (!base) {
  console.error("Usage: pnpm seo:audit https://store.example [--sample 25]");
  process.exit(2);
}

const fails = [];
const warns = [];
const fail = (where, msg) => fails.push(`${where}: ${msg}`);
const warn = (where, msg) => warns.push(`${where}: ${msg}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(path) {
  const res = await fetch(path.startsWith("http") ? path : base + path, { redirect: "follow", headers: { "User-Agent": "bsec-seo-audit/1 (read-only)" } });
  const text = await res.text();
  await sleep(900);
  return { res, text };
}

const tag = (html, re) => html.match(re)?.[1];
const entities = (s) => s?.replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/&quot;/g, '"');

function jsonLd(html) {
  const out = [];
  for (const m of html.matchAll(/<script type="application\/ld\+json">([^<]*)<\/script>/g)) {
    try {
      out.push(JSON.parse(m[1]));
    } catch {
      out.push({ __invalid: true });
    }
  }
  return out;
}

// robots.txt
const robots = await get("/robots.txt");
if (robots.res.status !== 200) fail("robots.txt", `status ${robots.res.status}`);
else {
  if (/^\s*Disallow:\s*\/\s*$/m.test(robots.text.split(/\n\s*\n/)[0] ?? "")) warn("robots.txt", "whole site is disallowed (store hidden or not live); sitemap checks skipped");
  if (!/^Sitemap:/im.test(robots.text)) fail("robots.txt", "no Sitemap line");
  for (const bot of ["OAI-SearchBot", "ChatGPT-User", "Claude-SearchBot", "PerplexityBot", "GPTBot", "ClaudeBot"]) {
    if (new RegExp(`User-agent:\\s*${bot}\\s*\\n\\s*Disallow:\\s*/\\s*$`, "im").test(robots.text)) warn("robots.txt", `${bot} is blocked (AI answers cannot cite this store)`);
  }
  if (/Disallow:\s*\/_next/i.test(robots.text)) fail("robots.txt", "blocks /_next/ (Google cannot render pages)");
}

// llms.txt
const llms = await get("/llms.txt");
if (llms.res.status !== 200) warn("llms.txt", `status ${llms.res.status}`);
else if (!llms.text.startsWith("# ")) fail("llms.txt", "does not start with an H1");

// sitemap
const sm = await get("/sitemap.xml");
const locs = [...sm.text.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => entities(m[1]));
if (sm.res.status !== 200) fail("sitemap.xml", `status ${sm.res.status}`);
else if (locs.length === 0) warn("sitemap.xml", "no URLs (store hidden, empty, or not live)");
console.log(`robots.txt ${robots.res.status}, llms.txt ${llms.res.status}, sitemap.xml ${sm.res.status} with ${locs.length} URLs`);

// sample: first of each kind, then spread through the rest
const kind = (u) => new URL(u).pathname.split("/")[1] || "home";
const firstOfKind = new Map();
for (const u of locs) if (!firstOfKind.has(kind(u))) firstOfKind.set(kind(u), u);
const rest = locs.filter((u) => ![...firstOfKind.values()].includes(u));
const picks = [...firstOfKind.values(), ...rest.filter((_, i) => i % Math.max(1, Math.ceil(rest.length / Math.max(1, sample - firstOfKind.size))) === 0)].slice(0, sample);

for (const url of picks) {
  const path = new URL(url).pathname || "/";
  const { res, text: html } = await get(url);
  if (res.status !== 200) {
    fail(path, `sitemap URL answers ${res.status}`);
    continue;
  }
  const title = entities(tag(html, /<title>([^<]*)<\/title>/));
  const desc = entities(tag(html, /<meta name="description" content="([^"]*)"/));
  const robotsMeta = tag(html, /<meta name="robots" content="([^"]*)"/);
  const canonical = tag(html, /<link rel="canonical" href="([^"]*)"/);
  const h1 = (html.match(/<h1[\s>]/g) ?? []).length;
  if (!title || /^(home|collections|shopping cart)$/i.test(title.trim())) fail(path, `weak title "${title ?? ""}"`);
  else if (title.length > 70) warn(path, `title is ${title.length} characters`);
  if (!desc || /^welcome to our store\.?$/i.test(desc)) fail(path, `missing or default description "${desc ?? ""}"`);
  if (/noindex/i.test(robotsMeta ?? "")) fail(path, "in the sitemap but noindex");
  if (!canonical) fail(path, "no canonical");
  else if (canonical.replace(/\/$/, "") !== url.replace(/\/$/, "")) warn(path, `canonical differs from sitemap URL (${canonical})`);
  if (h1 !== 1) warn(path, `${h1} H1 elements`);
  const imgs = html.match(/<img [^>]*>/g) ?? [];
  const noAlt = imgs.filter((i) => !/ alt="[^"]/.test(i) && !/aria-hidden/.test(i)).length;
  if (noAlt > 0) warn(path, `${noAlt} of ${imgs.length} images have no alt text`);
  if (!/<meta property="og:title"/.test(html)) warn(path, "no Open Graph tags");

  const ld = jsonLd(html);
  if (ld.some((x) => x.__invalid)) fail(path, "invalid JSON-LD");
  const product = ld.find((x) => x["@type"] === "Product");
  if (kind(url) === "products") {
    if (!product) fail(path, "product page without Product schema");
    else {
      const offers = [product.offers].flat().filter(Boolean);
      if (offers.length === 0) warn(path, "Product schema has no offers");
      // The schema price must be a price the shopper can see on the page.
      const visible = new Set([...html.matchAll(/[₹$€£]\s?([0-9][0-9,]*(?:\.[0-9]+)?)/g)].map((m) => Number(m[1].replace(/,/g, ""))));
      for (const o of offers) {
        if (!visible.has(Number(o.price))) fail(path, `schema price ${o.price} is not shown on the page (shown: ${[...visible].slice(0, 5).join(", ")})`);
        if (!/^https:\/\/schema\.org\/(InStock|OutOfStock|PreOrder|BackOrder|LimitedAvailability|SoldOut)$/.test(o.availability ?? "")) warn(path, `odd availability ${o.availability}`);
      }
    }
    const crumb = ld.find((x) => x["@type"] === "BreadcrumbList");
    for (const it of crumb?.itemListElement ?? []) {
      const probe = await get(it.item);
      if (probe.res.status !== 200) fail(path, `breadcrumb "${it.name}" points at ${it.item} (${probe.res.status})`);
    }
  }
}

console.log(`\nChecked ${picks.length} pages on ${base}`);
for (const w of warns) console.log(`  warn  ${w}`);
for (const f of fails) console.log(`  FAIL  ${f}`);
console.log(`\n${fails.length} failure(s), ${warns.length} warning(s)`);
process.exit(fails.length > 0 ? 1 : 0);
