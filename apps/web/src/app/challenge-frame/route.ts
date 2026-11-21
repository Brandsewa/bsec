import { getCheckoutTurnstileSiteKey } from "@bs/domain";
import { BRIDGE_MESSAGE_TYPE, toOrigin } from "@/lib/turnstile-bridge.ts";

/**
 * The Turnstile challenge for stores on their own domain (audit A3-04). A store's checkout frames this page; it renders
 * the widget on the platform host (the one hostname Cloudflare knows) and posts the token to the page that framed it.
 * Plain HTML on purpose: no storefront layout, no tenant lookup, nothing to load but Cloudflare's script.
 * The token goes only to the origin named in ?parent=, never to "*". Framing is open to any origin because custom domains
 * are unbounded; a frame cannot skip the challenge, since bot detection runs inside the widget wherever it is framed.
 */
/** JSON that is safe inside an inline <script>. */
const js = (value: unknown): string =>
  JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");

export function GET(req: Request) {
  const siteKey = getCheckoutTurnstileSiteKey();
  const parent = toOrigin(new URL(req.url).searchParams.get("parent"));
  if (!siteKey || !parent) {
    return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>Security check</title><style>html,body{margin:0;padding:0;background:transparent;overflow:hidden}</style></head>
<body><div id="w"></div>
<script>
(function () {
  var PARENT = ${js(parent)}, KEY = ${js(siteKey)}, TYPE = ${js(BRIDGE_MESSAGE_TYPE)};
  function send(m) { m.type = TYPE; try { window.parent.postMessage(m, PARENT); } catch (e) {} }
  function size() { send({ kind: "height", height: document.getElementById("w").offsetHeight }); }
  window.__bsTurnstileReady = function () {
    window.turnstile.render("#w", {
      sitekey: KEY,
      appearance: "interaction-only",
      callback: function (token) { send({ kind: "token", token: token }); size(); },
      "expired-callback": function () { send({ kind: "expired" }); },
      "error-callback": function () { send({ kind: "failed" }); }
    });
    if (window.ResizeObserver) new ResizeObserver(size).observe(document.getElementById("w"));
    size();
  };
  window.__bsTurnstileFailed = function () { send({ kind: "failed" }); };
})();
</script>
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=__bsTurnstileReady" async defer onerror="__bsTurnstileFailed()"></script>
</body></html>`;
  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}
