/**
 * ShieldBlock Pro — YouTube MAIN World Injection
 *
 * Runs at document_start in the MAIN execution world on YouTube.
 * Intercepts YouTube's InnerTube player API to strip ad placements
 * before the player has a chance to queue them.
 *
 * Three interception points, installed most-reliable-first so a failure
 * in one never prevents the others from installing:
 *   1. fetch() hook        — SPA navigations re-request /player
 *   2. XMLHttpRequest hook  — some clients/paths request /player via XHR
 *   3. ytInitialPlayerResponse setter — the very first page load
 *
 * content-youtube.js (ISOLATED world) handles DOM-level skip/mute and the
 * anti-adblock enforcement popup as a fallback, and signals this script to
 * disable itself when the youtube toggle is off.
 */

(function () {
  'use strict';

  // ── Disable flag ──────────────────────────────────────────────────────────────
  // MAIN world can't call chrome APIs. content-youtube.js (ISOLATED, document_idle)
  // reads settings and posts SB_YOUTUBE_DISABLE / SB_YOUTUBE_ENABLE here.
  //
  // The catch: the *initial* player payload (ytInitialPlayerResponse, and often the
  // first /player fetch) is processed by YouTube before document_idle — i.e. before
  // content-youtube.js can send a signal. If we started disabled and waited, the
  // first video's ads would always leak through (the #1 user complaint).
  //
  // So we seed the flag synchronously at document_start from a decision cached in
  // the page's localStorage by content-youtube.js on a previous load (localStorage
  // is shared between the ISOLATED and MAIN worlds on the same origin). Default to
  // ENABLED when no cache exists, matching the default youtube:true setting. The
  // postMessage signals below remain authoritative and correct any drift.
  // NOTE: NOT using {once:true} — the user may toggle the youtube setting on/off
  // within the same session and we need to respond to both messages.
  let _disabled = false;
  try { if (localStorage.getItem('__sbYtOff') === '1') _disabled = true; } catch (_) {}
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
  // Mutates `obj` in place; returns true if anything was removed. Mirrors the
  // json-prune paths uBlock Origin uses for youtube.com.
  function stripAds(obj, _depth) {
    if (!obj || typeof obj !== 'object') return false;
    _depth = _depth || 0;
    if (_depth > 6) return false; // guard against pathologically deep / cyclic data
    let stripped = false;
    if (Array.isArray(obj.adPlacements) && obj.adPlacements.length) { obj.adPlacements = []; stripped = true; }
    if (Array.isArray(obj.playerAds)    && obj.playerAds.length)    { obj.playerAds = [];    stripped = true; }
    if (Array.isArray(obj.adSlots)      && obj.adSlots.length)      { obj.adSlots = [];      stripped = true; }
    if (obj.adBreakHeartbeatParams)     { delete obj.adBreakHeartbeatParams; stripped = true; } // mid-roll heartbeat
    if (obj.auxiliaryUi)                { delete obj.auxiliaryUi;            stripped = true; }
    // Some endpoints wrap the player payload inside playerResponse.
    if (obj.playerResponse && typeof obj.playerResponse === 'object') {
      if (stripAds(obj.playerResponse, _depth + 1)) stripped = true;
    }
    // Shorts / reel feed: drop entries flagged as ads so the player never sees them.
    if (_stripReelAds(obj)) stripped = true;
    return stripped;
  }

  // Remove ad entries from a Shorts/reel watch sequence. Heavily guarded — does
  // nothing unless the exact nested structure is present, so it can't corrupt a
  // normal reel feed.
  function _stripReelAds(obj) {
    try {
      const seq = obj.reelWatchSequenceResponse || obj;
      const entries = seq && Array.isArray(seq.entries) ? seq.entries : null;
      if (!entries) return false;
      let changed = false;
      for (let i = entries.length - 1; i >= 0; i--) {
        const isAd = entries[i] && entries[i].command &&
                     entries[i].command.reelWatchEndpoint &&
                     entries[i].command.reelWatchEndpoint.adClientParams &&
                     entries[i].command.reelWatchEndpoint.adClientParams.isAd;
        if (isAd) { entries.splice(i, 1); changed = true; }
      }
      return changed;
    } catch (_) { return false; }
  }

  // Does this URL look like an InnerTube endpoint that can carry ad data?
  function _isAdCarryingUrl(url) {
    return url.includes('/youtubei/') &&
           (url.includes('/player') || url.includes('/reel_watch_sequence'));
  }

  // ── 1. fetch hook — primary path ─────────────────────────────────────────────
  // SPA navigations re-request /player via the InnerTube API. This is the
  // mechanism uBlock Origin's json-prune-fetch-response relies on.
  const _origFetch = window.fetch;
  const _sbFetch = async function (...args) {
    const res = await _origFetch.apply(this, args);
    if (_disabled) return res;
    try {
      const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url ?? '');
      // res.ok guard: error/opaque responses (status 0, 3xx, 4xx, 5xx) carry no
      // ad data and would make `new Response(..., {status})` throw a RangeError.
      if (res.ok && _isAdCarryingUrl(url)) {
        const json = await res.clone().json();
        if (stripAds(json)) {
          _sbLog('info', 'InnerTube fetch: stripped ad data', { path: url.split('?')[0].split('/').slice(-2).join('/') });
          // IMPORTANT: do NOT reuse res.headers verbatim — the cloned body has
          // already been decoded, so the original content-encoding/-length now
          // describe a different payload and would make the player fail to parse
          // our rewritten JSON.
          const headers = new Headers(res.headers);
          headers.delete('content-length');
          headers.delete('content-encoding');
          return new Response(JSON.stringify(json), {
            status:     res.status,
            statusText: res.statusText,
            headers,
          });
        }
      }
    } catch (e) {
      _sbLog('warn', `InnerTube fetch hook error: ${e?.message ?? e}`);
    }
    return res;
  };
  // Only the assignment can throw (if a locker made window.fetch non-writable);
  // guarding it keeps the XHR + ytInitial hooks below installable regardless.
  try {
    window.fetch = _sbFetch;
    try { window.fetch.toString = () => _origFetch.toString(); } catch (_) {}
  } catch (e) {
    _sbLog('warn', `fetch hook install failed (locker?): ${e?.message ?? e}`);
  }

  // ── 2. XMLHttpRequest hook — secondary path ──────────────────────────────────
  // Some YouTube clients/embeds request /player via XHR. We capture the native
  // responseText/response getters once, then install lazy per-instance getters
  // that prune on first read after completion. Doing it lazily (rather than in a
  // load listener) makes us immune to listener-ordering races with the player.
  try {
    const XHR = window.XMLHttpRequest;
    const proto = XHR && XHR.prototype;
    const rtDesc = proto && Object.getOwnPropertyDescriptor(proto, 'responseText');
    const rDesc  = proto && Object.getOwnPropertyDescriptor(proto, 'response');
    if (proto && rtDesc && rtDesc.get && rDesc && rDesc.get) {
      const _open = proto.open;
      const _send = proto.send;
      proto.open = function (method, url) {
        try { this.__sbUrl = typeof url === 'string' ? url : (url?.href ?? ''); } catch (_) { this.__sbUrl = ''; }
        return _open.apply(this, arguments);
      };
      proto.send = function () {
        try {
          // Clear any shadow getters left over from a previous send — XHR objects
          // can be reopened and reused, and a stale shadow would return the wrong
          // (previously-pruned) body for an unrelated request.
          if (Object.prototype.hasOwnProperty.call(this, 'responseText')) { try { delete this.responseText; } catch (_) {} }
          if (Object.prototype.hasOwnProperty.call(this, 'response'))     { try { delete this.response; }     catch (_) {} }
          const url = this.__sbUrl || '';
          const rType = this.responseType;
          // Only text-like responses expose responseText for safe rewriting.
          if (!_disabled && _isAdCarryingUrl(url) && (rType === '' || rType === 'text')) {
            let cache; let computed = false;
            const compute = () => {
              if (computed) return cache;
              computed = true;
              try {
                const raw = rtDesc.get.call(this);
                const json = JSON.parse(raw);
                if (stripAds(json)) {
                  cache = JSON.stringify(json);
                  _sbLog('info', 'InnerTube XHR: stripped ad data');
                } else {
                  cache = raw;
                }
              } catch (_) {
                try { cache = rtDesc.get.call(this); } catch (e) { cache = ''; }
              }
              return cache;
            };
            Object.defineProperty(this, 'responseText', {
              configurable: true,
              get() { return this.readyState === 4 ? compute() : rtDesc.get.call(this); },
            });
            Object.defineProperty(this, 'response', {
              configurable: true,
              get() { return this.readyState === 4 ? compute() : rDesc.get.call(this); },
            });
          }
        } catch (_) { /* fall through to native send untouched */ }
        return _send.apply(this, arguments);
      };
    }
  } catch (e) {
    _sbLog('warn', `InnerTube XHR hook failed: ${e?.message ?? e}`);
  }

  // ── 3. ytInitialPlayerResponse — first page load ─────────────────────────────
  // YouTube inlines this global in a <script> tag before the player boots.
  // Wrapping it in a setter lets us strip the ad payload from that first load.
  // Installed last and guarded: if YouTube's anti-adblock "locker" has already
  // defined this as non-configurable, redefining throws — but the fetch/XHR
  // hooks above are already live, so interception still works.
  try {
    let _ytInitial;
    Object.defineProperty(window, 'ytInitialPlayerResponse', {
      get() { return _ytInitial; },
      set(v) {
        if (!_disabled) {
          try { if (stripAds(v)) _sbLog('info', 'InnerTube ytInitial: stripped ad placements'); } catch (_) {}
        }
        _ytInitial = v;
      },
      configurable: true,
    });
  } catch (e) {
    _sbLog('warn', `ytInitialPlayerResponse hook failed (locker?): ${e?.message ?? e}`);
  }

})();
