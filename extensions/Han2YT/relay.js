// Han2YT relay script — runs in MAIN world (via manifest "world": "MAIN")
// Bridges postMessage (from bridge.js in isolated world) to CustomEvents (for the page app)
// and vice versa.
(function () {
  if (window.__han2yt_relay) return;
  window.__han2yt_relay = true;

  // Direction 1: bridge (isolated) → page (main world)
  window.addEventListener('message', function (e) {
    if (e.data && e.data.__h2y) {
      window.dispatchEvent(new CustomEvent(e.data.__h2y, { detail: e.data.__h2d }));
    }
  });

  // Direction 2: page (main world) → bridge (isolated)
  // Intercept page's CustomEvents and relay via postMessage so bridge can read detail
  ['Han2YT_flow_start', 'Han2YT_flow_stop', 'Han2YT_flow_ping'].forEach(function (name) {
    window.addEventListener(name, function (e) {
      window.postMessage({ __h2y_cmd: name, __h2d: e.detail || {} }, '*');
    });
  });
})();
