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

  // ── Log relay → content-youtube.js (ISOLATED) ────────────────────────────────
  // MAIN world cannot call chrome.runtime APIs. We postMessage and the ISOLATED
  // content script relays the entry to the background via LOG_EVENT.
  function _sbLog(level, message, data) {
    try { window.postMessage({ type: 'SB_YT_LOG', level, message, data: data ?? {} }, '*'); } catch (_) {}
  }

  // ── Strip ad data from an InnerTube player response ───────────────────────────
  function stripAds(obj) {
    if (!obj || typeof obj !== 'object') return;
    let stripped = false;
    if (Array.isArray(obj.adPlacements)    && obj.adPlacements.length)    { obj.adPlacements = [];    stripped = true; }
    if (Array.isArray(obj.playerAds)       && obj.playerAds.length)       { obj.playerAds = [];       stripped = true; }
    if (Array.isArray(obj.adSlots)         && obj.adSlots.length)         { obj.adSlots = [];         stripped = true; }
    if (Array.isArray(obj.adBreaks)        && obj.adBreaks.length)        { obj.adBreaks = [];        stripped = true; }
    if (obj.auxiliaryUi)                                                   { delete obj.auxiliaryUi;   stripped = true; }
    if (obj.adMessagingConfig)                                             { delete obj.adMessagingConfig; stripped = true; }
    // frameworkUpdates carries mid-roll cue-point mutations — strip ad-break entries only
    if (obj.frameworkUpdates?.entityBatchUpdate?.mutations) {
      const muts = obj.frameworkUpdates.entityBatchUpdate.mutations;
      const before = muts.length;
      obj.frameworkUpdates.entityBatchUpdate.mutations = muts.filter(
        m => !m.payload?.adBreakSuggestionEntityPayload && !m.payload?.adSlotLoggingDataEntityPayload
      );
      if (obj.frameworkUpdates.entityBatchUpdate.mutations.length < before) stripped = true;
    }
    if (obj.playerResponse) stripAds(obj.playerResponse);
    return stripped;
  }

  // ── 1. ytInitialPlayerResponse — first page load ─────────────────────────────
  // YouTube inlines this global in a <script> tag before the player boots.
  // Wrapping it in a setter lets us strip the ad payload from that first load.
  let _ytInitial;
  Object.defineProperty(window, 'ytInitialPlayerResponse', {
    get() { return _ytInitial; },
    set(v) {
      if (!_disabled) {
        const stripped = stripAds(v);
        if (stripped) _sbLog('info', 'InnerTube ytInitial: stripped ad placements');
      }
      _ytInitial = v;
    },
    configurable: true,
  });

  // ── 2. fetch hook — SPA navigations re-request /player via InnerTube API ─────
  // Guard: prevent double-wrapping if script somehow re-runs (extension update, re-inject)
  if (!window.fetch._sbYouTubeHooked) {
  const _origFetch = window.fetch;
  window.fetch = async function (...args) {
    const res = await _origFetch.apply(this, args);
    if (_disabled) return res;
    try {
      const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url ?? '');
      if (url.includes('/youtubei/') && url.includes('/player')) {
        const json = await res.clone().json();
        const stripped = stripAds(json);
        if (stripped) _sbLog('info', 'InnerTube fetch: stripped ad placements', { path: url.split('?')[0].split('/').slice(-3).join('/') });
        return new Response(JSON.stringify(json), {
          status:     res.status,
          statusText: res.statusText,
          headers:    res.headers,
        });
      }
    } catch (e) {
      _sbLog('warn', `InnerTube fetch hook error: ${e?.message ?? e}`);
    }
    return res;
  };
  try { window.fetch.toString = () => _origFetch.toString(); } catch (_) {}
  window.fetch._sbYouTubeHooked = true;
  } // end idempotency guard

})();
