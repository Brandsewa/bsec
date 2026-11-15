/* BCOM storefront cookie banner and consent-gated integrations (ADR-047). Vanilla JS, loaded async, outside the app bundle.
   Reads the store's config from <script id="bs-consent-cfg" type="application/json">. All text is set with textContent. */
(function () {
  var el = document.getElementById("bs-consent-cfg");
  if (!el || window.top !== window.self) return;
  var cfg;
  try { cfg = JSON.parse(el.textContent || ""); } catch { return; }
  if (!cfg || cfg.v !== 1) return;

  var COOKIE = "bs_consent";
  var loaded = {};

  function read() {
    var m = document.cookie.match(/(?:^|; )bs_consent=([^;]*)/);
    if (!m) return null;
    var p = decodeURIComponent(m[1]).split(".");
    // A choice made under older wording or other integrations is asked again.
    if (p[0] !== cfg.rev || !/^[01]{2}$/.test(p[1] || "")) return null;
    return { a: p[1].charAt(0) === "1", m: p[1].charAt(1) === "1" };
  }
  function write(a, m) {
    var v = cfg.rev + "." + (a ? "1" : "0") + (m ? "1" : "0");
    document.cookie = COOKIE + "=" + encodeURIComponent(v) + "; Path=/; Max-Age=15552000; SameSite=Lax" + (location.protocol === "https:" ? "; Secure" : "");
  }

  function loadGa4(id) {
    if (loaded.ga4 || !id) return;
    loaded.ga4 = true;
    window.dataLayer = window.dataLayer || [];
    window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
    window.gtag("js", new Date());
    window.gtag("config", id);
    var s = document.createElement("script");
    s.async = true;
    s.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(id);
    document.head.appendChild(s);
  }
  function loadPixel(id) {
    if (loaded.pixel || !id) return;
    loaded.pixel = true;
    (function (f, b, e, v, n, t, s) {
      if (f.fbq) return;
      n = f.fbq = function () { if (n.callMethod) n.callMethod.apply(n, arguments); else n.queue.push(arguments); };
      if (!f._fbq) f._fbq = n;
      n.push = n; n.loaded = true; n.version = "2.0"; n.queue = [];
      t = b.createElement(e); t.async = true; t.src = v;
      s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s);
    })(window, document, "script", "https://connect.facebook.net/en_US/fbevents.js");
    window.fbq("init", id);
    window.fbq("track", "PageView");
    // Single-page navigations are page views too.
    var last = location.pathname;
    ["pushState", "replaceState"].forEach(function (k) {
      var o = history[k];
      history[k] = function () {
        var r = o.apply(this, arguments);
        setTimeout(function () { if (location.pathname !== last) { last = location.pathname; window.fbq("track", "PageView"); } }, 0);
        return r;
      };
    });
  }
  function apply(c) {
    if (c.a) loadGa4(cfg.ga4);
    if (c.m) loadPixel(cfg.pixel);
  }

  var box = null;
  var css = ".bsc{position:fixed;z-index:2147483000;max-width:26rem;margin:1rem;padding:1.1rem 1.25rem;border:1px solid var(--border,#d4d4d8);border-radius:.75rem;background:var(--background,#fff);color:var(--foreground,#18181b);box-shadow:0 10px 30px rgba(0,0,0,.18);font:14px/1.5 system-ui,sans-serif}" +
    ".bsc[data-pos=bottom]{left:50%;bottom:0;transform:translateX(-50%);width:calc(100% - 2rem);max-width:40rem}" +
    ".bsc[data-pos=bottom-left]{left:0;bottom:0}.bsc[data-pos=bottom-right]{right:0;bottom:0}" +
    ".bsc[data-pos=center]{left:50%;top:50%;transform:translate(-50%,-50%);width:calc(100% - 2rem)}" +
    ".bsc h2{margin:0 0 .35rem;font-size:1rem;font-weight:600}.bsc p{margin:0 0 .75rem}.bsc a{color:inherit;text-decoration:underline}" +
    ".bsc .r{display:flex;flex-wrap:wrap;gap:.5rem}.bsc button{cursor:pointer;border-radius:.5rem;padding:.55rem .9rem;font:inherit;font-weight:500;border:1px solid var(--border,#d4d4d8);background:transparent;color:inherit}" +
    ".bsc button.p{background:var(--primary,#18181b);color:var(--primary-foreground,#fff);border-color:transparent}" +
    ".bsc label{display:flex;gap:.5rem;align-items:flex-start;margin:0 0 .6rem}.bsc input{margin-top:.25rem}" +
    ".bsc button:focus-visible,.bsc input:focus-visible,.bsc a:focus-visible{outline:2px solid currentColor;outline-offset:2px}";

  function close() { if (box) { box.remove(); box = null; } }
  function decide(a, m) {
    var before = read();
    write(a, m);
    close();
    // Scripts that are already running cannot be unloaded, so withdrawing consent reloads the page without them.
    if (before && ((before.a && !a) || (before.m && !m))) { location.reload(); return; }
    apply({ a: a, m: m });
    document.dispatchEvent(new CustomEvent("bs:consent", { detail: { analytics: a, marketing: m } }));
  }
  function mk(tag, props, text) {
    var n = document.createElement(tag);
    for (var k in props) n.setAttribute(k, props[k]);
    if (text) n.textContent = text;
    return n;
  }
  function button(label, cls, fn) {
    var b = mk("button", { type: "button", class: cls || "" }, label);
    b.addEventListener("click", fn);
    return b;
  }
  function open() {
    close();
    if (!document.getElementById("bsc-style")) { var st = mk("style", { id: "bsc-style" }); st.textContent = css; document.head.appendChild(st); }
    var cur = read() || { a: false, m: false };
    box = mk("div", { class: "bsc", "data-pos": cfg.position, role: "dialog", "aria-labelledby": "bsc-t", "aria-describedby": "bsc-m" });
    box.appendChild(mk("h2", { id: "bsc-t" }, cfg.title));
    var p = mk("p", { id: "bsc-m" }, cfg.message + " ");
    if (cfg.policyPath) p.appendChild(mk("a", { href: cfg.policyPath }, "Privacy policy"));
    box.appendChild(p);
    var row = mk("div", { class: "r" });
    var pick = null;
    var customize = button(cfg.customizeLabel, "", function () {
      if (pick) return;
      pick = mk("div", {});
      var ia, im;
      if (cfg.ga4) { var la = mk("label", {}); ia = mk("input", { type: "checkbox" }); ia.checked = cur.a; la.appendChild(ia); la.appendChild(mk("span", {}, "Analytics: helps the store understand how it is used.")); pick.appendChild(la); }
      if (cfg.pixel) { var lm = mk("label", {}); im = mk("input", { type: "checkbox" }); im.checked = cur.m; lm.appendChild(im); lm.appendChild(mk("span", {}, "Marketing: lets the store measure and improve its ads.")); pick.appendChild(lm); }
      pick.appendChild(button("Save choices", "p", function () { decide(!!(ia && ia.checked), !!(im && im.checked)); }));
      box.insertBefore(pick, row);
      customize.setAttribute("hidden", "");
    });
    row.appendChild(button(cfg.acceptLabel, "p", function () { decide(!!cfg.ga4, !!cfg.pixel); }));
    row.appendChild(button(cfg.rejectLabel, "", function () { decide(false, false); }));
    if (cfg.ga4 && cfg.pixel) row.appendChild(customize);
    box.appendChild(row);
    document.body.appendChild(box);
    var first = box.querySelector("button");
    if (first) first.focus({ preventScroll: true });
  }

  // Footer or menu link: <a href="#cookie-settings">Cookie settings</a>
  document.addEventListener("click", function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[href="#cookie-settings"]') : null;
    if (a) { e.preventDefault(); open(); }
  });
  window.bsConsent = { open: open };

  function start() {
    var c = read();
    if (c) { apply(c); return; }
    // Global Privacy Control is a standing "no": record it as a rejection and do not interrupt the visitor.
    if (navigator.globalPrivacyControl) { write(false, false); return; }
    open();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
