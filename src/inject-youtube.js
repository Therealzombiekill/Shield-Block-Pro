/**
 * ShieldBlock Pro — YouTube MAIN World Injection
 *
 * Runs at document_start in the MAIN execution world on YouTube.
 * Intercepts YouTube's InnerTube player API to strip ad placements
 * before the player has a chance to queue them.
 *
 * content-youtube.js (ISOLATED world) handles DOM-level skip/mute as
 * a fallback for ads that slip through and signals this script to
 * disable itself when the youtube toggle is off.
 */

(function () {
  'use strict';

  // ── Disable flag ──────────────────────────────────────────────────────────────
  // MAIN world can't call chrome APIs. content-youtube.js reads settings and
  // posts SB_YOUTUBE_DISABLE / SB_YOUTUBE_ENABLE here.
  // Default true — catches ytInitialPlayerResponse on first page load before
  // content-youtube.js has had a chance to run.
  // NOTE: NOT using {once:true} — the user may toggle the youtube setting on/off
  // within the same session and we need to respond to both messages.
  let _disabled = false;
  window.addEventListener('message', function (e) {
    if (e.source !== window) return;
    if (e.data?.type === 'SB_YOUTUBE_DISABLE') _disabled = true;
    if (e.data?.type === 'SB_YOUTUBE_ENABLE')  _disabled = false;
  });

  // ── Strip ad data from an InnerTube player response ───────────────────────────
  function stripAds(obj) {
    if (!obj || typeof obj !== 'object') return;
    if (Array.isArray(obj.adPlacements))  obj.adPlacements = [];
    if (Array.isArray(obj.playerAds))     obj.playerAds = [];
    if (Array.isArray(obj.adSlots))       obj.adSlots = [];
    if (obj.auxiliaryUi)                  delete obj.auxiliaryUi;
    // Some responses nest ad data inside playerResponse
    if (obj.playerResponse)               stripAds(obj.playerResponse);
  }

  // ── 1. ytInitialPlayerResponse — first page load ─────────────────────────────
  // YouTube inlines this global in a <script> tag before the player boots.
  // Wrapping it in a setter lets us strip the ad payload from that first load.
  let _ytInitial;
  Object.defineProperty(window, 'ytInitialPlayerResponse', {
    get() { return _ytInitial; },
    set(v) { if (!_disabled) stripAds(v); _ytInitial = v; },
    configurable: true,
  });

  // ── 2. fetch hook — SPA navigations re-request /player via InnerTube API ─────
  const _origFetch = window.fetch;
  window.fetch = async function (...args) {
    const res = await _origFetch.apply(this, args);
    if (_disabled) return res;
    try {
      const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url ?? '');
      if (url.includes('/youtubei/') && url.includes('/player')) {
        const json = await res.clone().json();
        stripAds(json);
        return new Response(JSON.stringify(json), {
          status:     res.status,
          statusText: res.statusText,
          headers:    res.headers,
        });
      }
    } catch (_) {}
    return res;
  };
  try { window.fetch.toString = () => _origFetch.toString(); } catch (_) {}

})();
