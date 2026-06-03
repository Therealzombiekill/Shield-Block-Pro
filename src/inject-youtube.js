/**
 * ShieldBlock Pro — YouTube MAIN World (playback-safe mode)
 *
 * Do not add fetch/XHR Response rewriting — causes black screen / error 282054944.
 *
 * ytInitialPlayerResponse is only pruned AFTER content-youtube.js signals
 * SB_YT_PLAYBACK_READY (video has started). First paint stays pristine so the
 * player can initialize; SPA navigations after that may be pruned.
 */

(function () {
  'use strict';

  let _disabled = false;
  let _playbackReady = false;
  try {
    if (localStorage.getItem('__sbYtOff') === '1') _disabled = true;
    if (sessionStorage.getItem('__sbYtRecovery') === '1') _disabled = true;
  } catch (_) {}

  window.addEventListener('message', function (e) {
    if (e.source !== window) return;
    if (e.data?.type === 'SB_YOUTUBE_DISABLE') _disabled = true;
    if (e.data?.type === 'SB_YOUTUBE_ENABLE')  _disabled = false;
    if (e.data?.type === 'SB_YT_PLAYBACK_READY') _playbackReady = true;
  });

  function _sbLog(level, message, data) {
    try { window.postMessage({ type: 'SB_YT_LOG', level, message, data: data ?? {} }, '*'); } catch (_) {}
  }

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
        _ytInitial = v;
        if (_disabled || !_playbackReady) return;
        try {
          if (stripAds(v)) _sbLog('info', 'ytInitial: stripped ad placements (post-playback)');
        } catch (_) { /* never block assign */ }
      },
      configurable: true,
    });
  } catch (e) {
    _sbLog('warn', `ytInitial hook unavailable: ${e?.message ?? e}`);
  }
})();
