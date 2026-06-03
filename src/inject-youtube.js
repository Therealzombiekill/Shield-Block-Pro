/**
 * ShieldBlock Pro — YouTube MAIN World (playback-safe mode)
 *
 * ONE stable strategy — do not add fetch/XHR Response rewriting here.
 * Reconstructing fetch Responses (even with fixed headers) has repeatedly caused
 * black-screen playback while googlevideo.com still loads. DOM fallback in
 * content-youtube.js handles ads that play in the player UI.
 *
 * What we DO here (cannot break the network layer):
 *   • ytInitialPlayerResponse setter — in-place JSON prune on first paint only
 *   • SB_YOUTUBE_ENABLE / DISABLE listener (for toggles)
 *
 * SPA video changes re-fetch /player in the page; those responses stay pristine.
 * Skip/mute/overlay removal in the ISOLATED script covers those ads.
 */

(function () {
  'use strict';

  let _disabled = false;
  try { if (localStorage.getItem('__sbYtOff') === '1') _disabled = true; } catch (_) {}

  window.addEventListener('message', function (e) {
    if (e.source !== window) return;
    if (e.data?.type === 'SB_YOUTUBE_DISABLE') _disabled = true;
    if (e.data?.type === 'SB_YOUTUBE_ENABLE')  _disabled = false;
  });

  function _sbLog(level, message, data) {
    try { window.postMessage({ type: 'SB_YT_LOG', level, message, data: data ?? {} }, '*'); } catch (_) {}
  }

  // Conservative prune — ad slots only. Do NOT delete auxiliaryUi (breaks player chrome).
  function stripAds(obj, depth) {
    if (!obj || typeof obj !== 'object') return false;
    depth = depth || 0;
    if (depth > 6) return false;
    let stripped = false;
    if (Array.isArray(obj.adPlacements) && obj.adPlacements.length) { obj.adPlacements = []; stripped = true; }
    if (Array.isArray(obj.playerAds)    && obj.playerAds.length)    { obj.playerAds = [];    stripped = true; }
    if (Array.isArray(obj.adSlots)      && obj.adSlots.length)      { obj.adSlots = [];      stripped = true; }
    if (obj.adBreakHeartbeatParams)     { delete obj.adBreakHeartbeatParams; stripped = true; }
    if (obj.playerResponse && typeof obj.playerResponse === 'object') {
      if (stripAds(obj.playerResponse, depth + 1)) stripped = true;
    }
    return stripped;
  }

  try {
    let _ytInitial;
    Object.defineProperty(window, 'ytInitialPlayerResponse', {
      get() { return _ytInitial; },
      set(v) {
        try {
          if (!_disabled && stripAds(v)) _sbLog('info', 'ytInitial: stripped ad placements');
        } catch (_) { /* never block assign */ }
        _ytInitial = v;
      },
      configurable: true,
    });
  } catch (e) {
    _sbLog('warn', `ytInitial hook unavailable: ${e?.message ?? e}`);
  }
})();
