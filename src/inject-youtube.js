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
  // Starts disabled until content-youtube.js sends SB_YOUTUBE_ENABLE. Starts disabled until ENABLE.
  // NOTE: NOT using {once:true} — the user may toggle the youtube setting on/off
  // within the same session and we need to respond to both messages.
  // Default on until bootstrap/content-youtube sends DISABLE (youtube is on by default).
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
    if (Array.isArray(obj.adPlacements) && obj.adPlacements.length) { obj.adPlacements = []; stripped = true; }
    if (Array.isArray(obj.playerAds) && obj.playerAds.length) { obj.playerAds = []; stripped = true; }
    if (Array.isArray(obj.adSlots) && obj.adSlots.length) { obj.adSlots = []; stripped = true; }
    if (obj.auxiliaryUi) { delete obj.auxiliaryUi; stripped = true; }
    if (obj.adBreakHeartbeatParams) { delete obj.adBreakHeartbeatParams; stripped = true; }
    if (obj.adBreakFeedParams) { delete obj.adBreakFeedParams; stripped = true; }
    if (obj.adBreakServiceResponse) { delete obj.adBreakServiceResponse; stripped = true; }
    if (obj.playerAdParams) { delete obj.playerAdParams; stripped = true; }
    if (obj.adBreakMetadata) { delete obj.adBreakMetadata; stripped = true; }
    if (obj.playerLegacyDesktopWatchAdsRenderer) { delete obj.playerLegacyDesktopWatchAdsRenderer; stripped = true; }
    if (obj.playerLegacyMobileWatchAdsRenderer) { delete obj.playerLegacyMobileWatchAdsRenderer; stripped = true; }
    if (obj.playerResponse && stripAds(obj.playerResponse)) stripped = true;
    return stripped;
  }

  function isInnerTubePlayerUrl(url) {
    if (!url || !url.includes('/youtubei/')) return false;
    return /\/(player|next|reel\/watch_sequence|get_watch)/.test(url);
  }

  function patchInnerTubeJson(json) {
    return stripAds(json) ? JSON.stringify(json) : null;
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
  const _origFetch = window.fetch;
  window.fetch = async function (...args) {
    const res = await _origFetch.apply(this, args);
    if (_disabled) return res;
    try {
      const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url ?? '');
      if (isInnerTubePlayerUrl(url)) {
        const json = await res.clone().json();
        const body = patchInnerTubeJson(json);
        if (body) {
          _sbLog('info', 'InnerTube fetch: stripped ad placements', {
            path: url.split('?')[0].split('/').slice(-3).join('/'),
          });
          return new Response(body, {
            status: res.status,
            statusText: res.statusText,
            headers: res.headers,
          });
        }
      }
    } catch (e) {
      _sbLog('warn', `InnerTube fetch hook error: ${e?.message ?? e}`);
    }
    return res;
  };
  try { window.fetch.toString = () => _origFetch.toString(); } catch (_) {}

  // ── 3. XHR hook — some clients still use XMLHttpRequest for InnerTube ────────
  const _origXhrOpen = XMLHttpRequest.prototype.open;
  const _origXhrSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    try {
      this._sbYtUrl = typeof url === 'string' ? url : String(url ?? '');
    } catch (_) {
      this._sbYtUrl = '';
    }
    return _origXhrOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function (...args) {
    const xhr = this;
    const reqUrl = xhr._sbYtUrl ?? '';
    if (!_disabled && isInnerTubePlayerUrl(reqUrl)) {
      const onLoad = function () {
        try {
          if (xhr.readyState !== 4 || xhr.status < 200 || xhr.status >= 300) return;
          const json = JSON.parse(xhr.responseText);
          const body = patchInnerTubeJson(json);
          if (!body) return;
          Object.defineProperty(xhr, 'responseText', { value: body, configurable: true });
          Object.defineProperty(xhr, 'response', { value: body, configurable: true });
          _sbLog('info', 'InnerTube XHR: stripped ad placements', {
            path: reqUrl.split('?')[0].split('/').slice(-3).join('/'),
          });
        } catch (_) {}
      };
      xhr.addEventListener('readystatechange', onLoad);
    }
    return _origXhrSend.apply(this, args);
  };
  try {
    XMLHttpRequest.prototype.open.toString = () => _origXhrOpen.toString();
    XMLHttpRequest.prototype.send.toString = () => _origXhrSend.toString();
  } catch (_) {}

  // If ytInitialPlayerResponse was set before our setter installed, strip once.
  try {
    const desc = Object.getOwnPropertyDescriptor(window, 'ytInitialPlayerResponse');
    if (desc?.value && !_disabled) {
      stripAds(desc.value);
      _sbLog('info', 'InnerTube ytInitial: stripped pre-existing ad placements');
    }
  } catch (_) {}

})();
