/* BCOM storefront cookie banner and consent-gated integrations (ADR-047). Vanilla JS, loaded async, outside the app bundle.
   Reads the store's config from <script id="bs-consent-cfg" type="application/json">. All text is set with textContent. */
(function () {
  if (window.top !== window.self) return;
  // The framework hoists this script into <head>, so it can run before the config element (further down the document) exists.
  function boot() {
    var el = document.getElementById("bs-consent-cfg");
    if (el) main(el);
  }
  if (document.getElementById("bs-consent-cfg")) boot();
  else if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);

  function main(el) {
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
  // ---- Shop events (view item, add to cart, begin checkout, purchase) ----
  // Server-rendered blobs and the cart request are turned into GA4 and Pixel events, only for the tools the visitor accepted.
  var state = null; // the visitor's decision, once there is one
  var queue = [];
  var META = { view_item: "ViewContent", add_to_cart: "AddToCart", begin_checkout: "InitiateCheckout", purchase: "Purchase" };

  function send(ev) {
    if (!state) { if (queue.length < 20) queue.push(ev); return; }
    var useGa = state.a && loaded.ga4 && window.gtag;
    var usePx = state.m && loaded.pixel && window.fbq;
    if (!useGa && !usePx) return;
    if (ev.t === "purchase") {
      // A refresh of the thank-you page must not count the order twice.
      var key = "bs_pur_" + ev.orderId;
      try { if (localStorage.getItem(key)) return; localStorage.setItem(key, "1"); } catch { /* storage blocked: send anyway */ }
    }
    var items = ev.items || [];
    if (useGa) {
      var g = { currency: ev.currency, value: ev.value, items: items.map(function (i) { return { item_id: i.id, item_name: i.name, item_variant: i.variant, price: i.price, quantity: i.quantity }; }) };
      if (ev.t === "purchase") { g.transaction_id = ev.orderId; g.shipping = ev.shipping; }
      window.gtag("event", ev.t, g);
    }
    if (usePx) {
      var px = {
        currency: ev.currency, value: ev.value, content_type: "product",
        content_ids: items.map(function (i) { return i.id; }),
        contents: items.map(function (i) { return { id: i.id, quantity: i.quantity, item_price: i.price }; })
      };
      if (ev.t === "purchase") px.num_items = items.reduce(function (n, i) { return n + i.quantity; }, 0);
      // The server sends the same event to Meta; the shared id makes Meta count it once.
      var eid = ev.t === "purchase" ? ev.orderId : ev.eventId;
      if (eid) window.fbq("track", META[ev.t], px, { eventID: eid }); else window.fbq("track", META[ev.t], px);
    }
  }
  function handle(n) {
    if (n.__bs) return;
    n.__bs = 1;
    var ev;
    try { ev = JSON.parse(n.textContent || ""); } catch { return; }
    if (ev && META[ev.t]) send(ev);
  }
  function scan(root) {
    var list = root.querySelectorAll ? root.querySelectorAll("script[data-bs-ev]") : [];
    for (var i = 0; i < list.length; i++) handle(list[i]);
  }
  function decimals(cur) {
    try { return new Intl.NumberFormat("en", { style: "currency", currency: cur }).resolvedOptions().maximumFractionDigits; } catch { return 2; }
  }
  function cartAdded(cart, body, eventId) {
    if (!cart || !cart.items || !body) return;
    var line = null;
    for (var i = 0; i < cart.items.length; i++) if (cart.items[i].variantId === body.variantId) line = cart.items[i];
    if (!line) return;
    var d = Math.pow(10, decimals(cart.currency));
    var price = line.unitPriceSnapshot / d;
    var vt = line.variant && line.variant.title;
    var qty = body.quantity > 0 ? body.quantity : 1;
    send({
      t: "add_to_cart", eventId: eventId, currency: cart.currency, value: Math.round(price * qty * 100) / 100,
      items: [{ id: (line.variant && line.variant.sku) || line.variantId, name: line.product.title, variant: vt && vt.toLowerCase() !== "default title" && vt.toLowerCase() !== "default" ? vt : undefined, price: price, quantity: qty }]
    });
  }
  if (cfg.ga4 || cfg.pixel) {
    var realFetch = window.fetch;
    if (realFetch) {
      window.fetch = function (input, init) {
        var p = realFetch.apply(this, arguments);
        try {
          var url = typeof input === "string" ? input : (input && input.url) || "";
          var method = ((init && init.method) || (input && input.method) || "GET").toUpperCase();
          if (method === "POST" && /\/api\/storefront\/cart\/items\/?(\?|$)/.test(url) && init && typeof init.body === "string") {
            var body = JSON.parse(init.body);
            p.then(function (r) {
              if (r.ok) r.clone().json().then(function (d) { cartAdded(d && d.cart, body, d && d.analyticsEventId); }).catch(function () {});
            }).catch(function () {});
          }
        } catch { /* never interfere with the shop's own request */ }
        return p;
      };
    }
    if (window.MutationObserver) {
      new MutationObserver(function (muts) {
        for (var i = 0; i < muts.length; i++) {
          var added = muts[i].addedNodes;
          for (var j = 0; j < added.length; j++) {
            var n = added[j];
            if (n.nodeType !== 1) continue;
            if (n.matches && n.matches("script[data-bs-ev]")) handle(n); else scan(n);
          }
        }
      }).observe(document.documentElement, { childList: true, subtree: true });
    }
  }

  function apply(c) {
    state = c;
    if (c.a) loadGa4(cfg.ga4);
    if (c.m) loadPixel(cfg.pixel);
    var q = queue; queue = [];
    for (var i = 0; i < q.length; i++) send(q[i]);
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
    if (c) { apply(c); scan(document); return; }
    // Global Privacy Control is a standing "no": record it as a rejection and do not interrupt the visitor.
    if (navigator.globalPrivacyControl) { write(false, false); apply({ a: false, m: false }); return; }
    scan(document);
    open();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
  }
})();
