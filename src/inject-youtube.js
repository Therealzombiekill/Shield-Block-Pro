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
  // MUST default to enabled (false): YouTube inlines ytInitialPlayerResponse in
  // the page HTML, so our setter (below) fires while the document is parsing at
  // document_start — long before content-youtube.js runs at document_idle and
  // can send ENABLE. If this started disabled, the first video on every fresh
  // page load would keep its ads (the most common case). content-youtube.js
  // sends DISABLE when the youtube toggle is off, the site is whitelisted, or
  // global pause is active, so respecting the toggle still works.
  // NOTE: NOT using {once:true} — the user may toggle the youtube setting on/off
  // within the same session and we need to respond to both messages.
  let _disabled = false;
  window.addEventListener('message', function (e) {
    if (e.source !== window) return;
    if (e.data?.type === 'SB_YOUTUBE_DISABLE') _disabled = true;
    if (e.data?.type === 'SB_YOUTUBE_ENABLE')  _disabled = false;
  });

  // ── Log relay → content-youtube.js (ISOLATED) ────────────────────────────────
  // MAIN world cannot call chrome.runtime APIs. We postMessage and the ISOLATED
  // content script relays the entry to the background via LOG_EVENT.
  function _sbLog(level, message, data) {
    try { window.postMessage({ type: 'SB_YT_LOG', level, message, data: data ?? {} }, '*'); } catch (_) {}
  }

  // ── Strip ad data from an InnerTube player response ───────────────────────────
  function stripAds(obj) {
    if (!obj || typeof obj !== 'object') return false;
    let stripped = false;
    if (Array.isArray(obj.adPlacements)  && obj.adPlacements.length)  { obj.adPlacements = [];  stripped = true; }
    if (Array.isArray(obj.playerAds)     && obj.playerAds.length)     { obj.playerAds = [];     stripped = true; }
    if (Array.isArray(obj.adSlots)       && obj.adSlots.length)       { obj.adSlots = [];       stripped = true; }
    if (obj.adBreakHeartbeatParams)                                   { delete obj.adBreakHeartbeatParams; stripped = true; }
    if (obj.auxiliaryUi)                                              { delete obj.auxiliaryUi; stripped = true; }
    // Some responses nest the player payload (and its ad data) one level deeper.
    // Propagate the nested result so callers know the object was modified.
    if (obj.playerResponse && stripAds(obj.playerResponse))           stripped = true;
    return stripped;
  }

  // ── 1. ytInitialPlayerResponse — first page load ─────────────────────────────
  // YouTube inlines this global in a <script> tag before the player boots.
  // Wrapping it in a setter lets us strip the ad payload from that first load.
  // CRITICAL: stripping is best-effort and fully isolated — _ytInitial MUST be
  // assigned even if stripAds throws, or the getter returns undefined and the
  // player renders a black screen. defineProperty itself is also guarded so a
  // timing/redefinition failure never leaves the page without its data.
  try {
    let _ytInitial;
    Object.defineProperty(window, 'ytInitialPlayerResponse', {
      get() { return _ytInitial; },
      set(v) {
        try {
          if (!_disabled && stripAds(v)) _sbLog('info', 'InnerTube ytInitial: stripped ad placements');
        } catch (_) { /* never let ad-stripping break playback */ }
        _ytInitial = v;
      },
      configurable: true,
    });
  } catch (_) { /* property already locked by the page — leave it as-is */ }

  // ── 2. fetch hook — SPA navigations re-request /player via InnerTube API ─────
  const _origFetch = window.fetch;
  window.fetch = async function (...args) {
    const res = await _origFetch.apply(this, args);
    if (_disabled) return res;
    try {
      const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url ?? '');
      if (url.includes('/youtubei/') && url.includes('/player')) {
        const json = await res.clone().json();
        const stripped = stripAds(json);
        // Nothing to change — serve the original response untouched rather than
        // round-tripping every /player payload through JSON (cheaper + safer).
        if (!stripped) return res;
        _sbLog('info', 'InnerTube fetch: stripped ad placements', { path: url.split('?')[0].split('/').slice(-3).join('/') });
        // The original response may be gzip-encoded with a fixed content-length;
        // our re-stringified JSON is plain and a different size, so drop those
        // headers (and force JSON content-type) to avoid a decode/length mismatch.
        const headers = new Headers(res.headers);
        headers.delete('content-encoding');
        headers.delete('content-length');
        headers.set('content-type', 'application/json; charset=utf-8');
        return new Response(JSON.stringify(json), {
          status:     res.status,
          statusText: res.statusText,
          headers,
        });
      }
    } catch (e) {
      _sbLog('warn', `InnerTube fetch hook error: ${e?.message ?? e}`);
    }
    return res;
  };
  try { window.fetch.toString = () => _origFetch.toString(); } catch (_) {}

})();
