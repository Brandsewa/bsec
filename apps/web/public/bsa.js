/* BCOM storefront traffic beacon (ADR-046). Cookieless: sets nothing on the device. ~0.6 KB, loaded async, outside the app bundle. */
(function () {
  if (window.top !== window.self) return; // theme-editor preview frames are not shoppers
  if (navigator.doNotTrack === "1" || navigator.globalPrivacyControl) return;
  var URL_ = "/api/storefront/analytics/collect";
  var last = "";
  var first = true;
  function send(t) {
    var p = location.pathname;
    if (t === "pageview") {
      if (p === last) return;
      last = p;
    }
    var body = JSON.stringify({ t: t, p: p, r: first ? document.referrer : "", s: first ? location.search : "" });
    if (t === "pageview") first = false;
    try {
      if (!(navigator.sendBeacon && navigator.sendBeacon(URL_, new Blob([body], { type: "text/plain" })))) {
        fetch(URL_, { method: "POST", body: body, keepalive: true });
      }
    } catch {
      /* analytics must never throw into the page */
    }
  }
  function view() {
    if (document.visibilityState === "prerender") return;
    send("pageview");
  }
  ["pushState", "replaceState"].forEach(function (k) {
    var o = history[k];
    history[k] = function () {
      var r = o.apply(this, arguments);
      setTimeout(view, 0);
      return r;
    };
  });
  addEventListener("popstate", function () { setTimeout(view, 0); });
  window.bsTrack = send; // add_to_cart / begin_checkout are sent from the server where possible; this is for custom hooks
  if (document.readyState === "complete") view();
  else addEventListener("load", view);
})();
