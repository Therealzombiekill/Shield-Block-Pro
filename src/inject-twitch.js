/**
 * ShieldBlock Pro — Twitch MAIN World Injection
 *
 * Strategy (modelled on pixeltris/TwitchAdSolutions vaft, archived Mar 2026):
 *   1. Worker injection — intercepts Twitch's HLS worker, hooks self.fetch
 *      to detect the 'stitched' ad signifier and swap to a clean stream
 *   2. GQL fetch hook — captures auth headers + forces playerType=embed on
 *      the main stream token request to reduce prerolls
 *   3. Telemetry blocking — drops ad-tracking requests before they send
 *
 * When a swap fails: strips ad segments from the M3U8 instead of looping
 * (loops use expiring CDN URLs and cause black screens).
 */

(function () {
  'use strict';

  // ── Disable flag ──────────────────────────────────────────────────────────────
  // MAIN world scripts can't call chrome APIs. content-twitch.js (isolated world)
  // reads settings and posts SB_TWITCH_DISABLE here if the toggle is off.
  // Default true — wrong default is just a skipped ad, wrong default the other
  // way means hooks never run at all.
  let _disabled = false;
  window.addEventListener('message', function (e) {
    if (e.source !== window) return;
    if (e.data?.type === 'SB_TWITCH_DISABLE') _disabled = true;
  }, { once: true });

  function getCurrentChannel() {
    const m = location.pathname.match(/^\/([a-zA-Z0-9_]{1,25})\/?(?:\?|$|\/)/);
    return m ? m[1].toLowerCase() : null;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // WORKER SCRIPT — injected into Twitch's HLS worker blob
  // ─────────────────────────────────────────────────────────────────────────────
  const WORKER_INJECT = /* js */`
(function() {
  'use strict';

  var _origFetch    = self.fetch;
  var _adActive     = false;
  var _sbChannel    = null; // injected by main world at construction time
  var _authHeader   = null; // captured from main-world postMessage
  var _deviceID     = null;
  var _clientID     = 'kimne78kx3ncx6brgo4mv6wki5h1ko';
  var _swapCooldown = false; // prevent concurrent swap attempts

  // Player types to try for clean stream — ordered by quality.
  // vaft: ['embed','site','autoplay','picture-by-picture']
  var PLAYER_TYPES = ['embed', 'site', 'autoplay'];

  // ── Receive auth headers forwarded from main world ──────────────────────────
  self.addEventListener('message', function(e) {
    if (!e.data) return;
    if (e.data.type === 'SB_AUTH') {
      if (e.data.auth)     _authHeader = e.data.auth;
      if (e.data.deviceId) _deviceID   = e.data.deviceId;
      if (e.data.clientId) _clientID   = e.data.clientId;
    }
  });

  // ── Ad detection ─────────────────────────────────────────────────────────────
  // Primary signifier: 'stitched' — this string appears in the EXT-X-DATERANGE
  // tag Twitch inserts when SSAI stitches an ad into the manifest.
  // vaft uses this as its sole AdSignifier. We also check legacy SCTE-35 markers
  // for streams that use older injection formats.
  function hasAdMarkers(text) {
    return (
      text.includes('stitched') ||
      text.includes('EXT-OATCLS-SCTE35') ||
      text.includes('EXT-X-CUE-OUT') ||
      text.includes('imasdk.googleapis.com') ||
      text.includes('tv.freewheel.tv')
    );
  }

  function isTwitchM3U8(url) {
    return (
      (url.includes('video-weaver') || url.includes('video-edge')) &&
      url.includes('.m3u8') &&
      !url.includes('usher.twitchsvc.net') &&
      !url.includes('usher.twitch.tv')
    );
  }

  // ── Ad segment stripping ─────────────────────────────────────────────────────
  // When swap fails, remove ad segments from the M3U8 instead of looping.
  // Loops reuse CDN URLs that expire in ~30-60s → 403s → black screen.
  // Stripping causes a brief pause/freeze but NO black screen.
  function stripAdSegments(text) {
    var lines        = text.split('\\n');
    var out          = [];
    var inAd         = false;
    var skipNext     = false; // skip the segment URL line after an ad EXTINF
    var addedDiscont = false; // only add one EXT-X-DISCONTINUITY per ad break

    for (var i = 0; i < lines.length; i++) {
      var l = lines[i].trim();

      // Detect ad entry markers
      if (l.includes('EXT-X-CUE-OUT') || l.includes('EXT-OATCLS-SCTE35') ||
          (l.includes('EXT-X-DATERANGE') && l.includes('stitched'))) {
        inAd        = true;
        addedDiscont = false; // reset so we add one discontinuity when exiting
        continue;
      }

      // Ad exit — add a discontinuity marker so the HLS player knows
      // there is a timeline gap (avoids stall / timestamp mismatch errors)
      if (l.includes('EXT-X-CUE-IN') && inAd) {
        inAd = false;
        if (!addedDiscont) {
          out.push('#EXT-X-DISCONTINUITY');
          addedDiscont = true;
        }
        continue;
      }

      if (inAd) {
        // Also remove any EXT-X-DISCONTINUITY that Twitch injected at the ad boundary
        // (we'll add our own clean one when exiting the ad block)
        if (l.startsWith('#EXT-X-DISCONTINUITY') ||
            l.startsWith('#EXT-OATCLS-SCTE35') ||
            l.startsWith('#EXT-X-DATERANGE') ||
            l.startsWith('#EXT-X-CUE') ||
            l.startsWith('#EXT-X-PROGRAM-DATE-TIME')) {
          continue;
        }
        // Skip EXTINF tag and the segment URL that follows it
        if (l.startsWith('#EXTINF')) { skipNext = true; continue; }
        if (skipNext && !l.startsWith('#')) { skipNext = false; continue; }
        // Any other in-ad line — skip it
        continue;
      }

      out.push(l);
    }

    return out.join('\\n');
  }

  // ── GQL helpers ──────────────────────────────────────────────────────────────
  function buildHeaders() {
    var h = { 'Client-Id': _clientID, 'Content-Type': 'application/json' };
    if (_authHeader)  h['Authorization']     = _authHeader;
    if (_deviceID)    h['X-Device-Id']        = _deviceID;
    return h;
  }

  function buildGQL(channel, playerType) {
    return JSON.stringify([{
      operationName: 'PlaybackAccessToken',
      variables: { isLive: true, login: channel, isVod: false, vodID: '', playerType: playerType },
      extensions: {
        persistedQuery: {
          version: 1,
          sha256Hash: '0828119ded1c13477966434e15800ff57ddacf13ba1911c129dc2200705b0712'
        }
      }
    }]);
  }

  function buildGQLFull(channel, playerType) {
    return JSON.stringify([{
      operationName: 'PlaybackAccessToken',
      variables: { isLive: true, login: channel, isVod: false, vodID: '', playerType: playerType },
      query: 'query PlaybackAccessToken($login:String!,$isLive:Boolean!,$vodID:ID!,$isVod:Boolean!,$playerType:String!){streamPlaybackAccessToken(channelName:$login,params:{platform:"web",playerBackend:"mediaplayer",playerType:$playerType})@include(if:$isLive){value signature}videoPlaybackAccessToken(id:$vodID,params:{platform:"web",playerBackend:"mediaplayer",playerType:$playerType})@include(if:$isVod){value signature}}'
    }]);
  }

  async function fetchCleanStreamUrl(channel, playerType) {
    try {
      var res  = await _origFetch('https://gql.twitch.tv/gql', {
        method: 'POST', headers: buildHeaders(), body: buildGQL(channel, playerType),
      });
      var data = await res.json();
      var token = data[0]?.data?.streamPlaybackAccessToken;

      // Hash expired — retry with full query
      if (!token && data[0]?.errors?.some(function(e) {
        return e.message && (e.message.includes('PersistedQueryNotFound') || e.message.includes('Not Found'));
      })) {
        res   = await _origFetch('https://gql.twitch.tv/gql', {
          method: 'POST', headers: buildHeaders(), body: buildGQLFull(channel, playerType),
        });
        data  = await res.json();
        token = data[0]?.data?.streamPlaybackAccessToken;
      }
      if (!token) return null;

      var p = new URLSearchParams({
        sig: token.signature, token: token.value,
        allow_source: 'true', allow_spectre: 'true', fast_bread: 'true',
        p: Math.floor(Math.random() * 9999999),
        play_session_id: Math.random().toString(36).slice(2),
        player_backend: 'mediaplayer', player_version: '1.28.0',
        playlist_include_framerate: 'true', supported_codecs: 'avc1',
      });

      var usherRes = await _origFetch(
        'https://usher.twitchsvc.net/api/channel/hls/' + channel + '.m3u8?' + p.toString()
      );
      if (!usherRes.ok) return null;
      var master = await usherRes.text();
      // Return best-quality stream URL (first non-comment line)
      var urls = master.split('\\n').filter(function(l) {
        return l.trim().length > 0 && !l.startsWith('#');
      });
      return urls[0] || null;
    } catch(e) { return null; }
  }

  // ── Telemetry block ──────────────────────────────────────────────────────────
  var TELEMETRY = [
    'spade.twitch.tv','twitchadvertising.tv','client-event.twitch.tv',
    'audience-media.twitch.tv','imasdk.googleapis.com','tv.freewheel.tv',
    'securepubads.g.doubleclick.net','stats.g.doubleclick.net',
    'cm.g.doubleclick.net','tag.targeting.unrulymedia.com','beacon.krxd.net',
  ];

  // ── Main fetch interceptor ───────────────────────────────────────────────────
  self.fetch = async function(resource, init) {
    var url = (typeof resource === 'string' ? resource : (resource && resource.url)) || '';

    // Block ad telemetry
    for (var ti = 0; ti < TELEMETRY.length; ti++) {
      if (url.includes(TELEMETRY[ti])) return new Response('', { status: 200 });
    }

    if (!isTwitchM3U8(url)) return _origFetch.apply(this, arguments);

    var res = await _origFetch.apply(this, arguments);
    try {
      var text = await res.clone().text();

      // ── No ad — clean content ─────────────────────────────────────────────
      if (!hasAdMarkers(text)) {
        if (_adActive) {
          _adActive = false;
          _swapCooldown = false;
          self.postMessage({ type: 'SB_AD_END' });
        }
        return res;
      }

      // ── Ad detected ──────────────────────────────────────────────────────
      if (!_adActive) {
        _adActive = true;
        self.postMessage({ type: 'SB_AD_START' });
      }

      // ── Strategy 1: Swap to clean stream ─────────────────────────────────
      // Reset cooldown on each new ad cycle so we keep trying.
      if (!_swapCooldown) {
        var channel = _sbChannel;
        if (!channel) {
          var chanMatch = url.match(/\/hls\/([a-z0-9_]+)\//i);
          channel = chanMatch ? chanMatch[1] : null;
        }

        if (channel) {
          _swapCooldown = true; // prevent concurrent swaps this cycle
          for (var pi = 0; pi < PLAYER_TYPES.length; pi++) {
            var swapUrl = await fetchCleanStreamUrl(channel, PLAYER_TYPES[pi]);
            if (swapUrl) {
              try {
                var swapRes  = await _origFetch(swapUrl);
                var swapText = await swapRes.text();
                if (!hasAdMarkers(swapText)) {
                  _adActive     = false;
                  _swapCooldown = false;
                  self.postMessage({ type: 'SB_AD_SWAPPED' });
                  return new Response(swapText, {
                    status: swapRes.status, statusText: swapRes.statusText,
                    headers: swapRes.headers,
                  });
                }
              } catch(_) {}
            }
          }
          // All types had ads — allow retry on next M3U8 poll (~2s)
          setTimeout(function() { _swapCooldown = false; }, 2000);
        }
      }

      // ── Strategy 2: Strip ad segments from the manifest ──────────────────
      // Returns a modified M3U8 with ad segments removed → brief pause, no black screen.
      // This is always better than looping (loop URLs expire → 403 → actual black screen).
      var stripped = stripAdSegments(text);
      // Only return stripped version if we removed something useful
      if (stripped !== text && stripped.includes('#EXTINF')) {
        return new Response(stripped, {
          status: 200, statusText: 'OK',
          headers: { 'Content-Type': 'application/vnd.apple.mpegurl' },
        });
      }

      // ── Strategy 3: Pass through (content script will mute) ──────────────
      return res;

    } catch(e) { return res; }
  };

})();
`;

  // ─────────────────────────────────────────────────────────────────────────────
  // MAIN WINDOW — Worker constructor hijacking + auth header capture
  // ─────────────────────────────────────────────────────────────────────────────

  // Capture Twitch's own auth headers so worker backup requests look legitimate
  let _capturedAuth     = null;
  let _capturedDeviceId = null;
  let _capturedClientId = 'kimne78kx3ncx6brgo4mv6wki5h1ko';
  const _twitchWorkers  = [];

  const _Worker = window.Worker;

  window.Worker = function (scriptUrl, options) {
    let url = scriptUrl instanceof URL ? scriptUrl.href : (scriptUrl ?? '');

    if (!_disabled && typeof url === 'string' && url.startsWith('blob:')) {
      try {
        // Read original Twitch worker script synchronously BEFORE creating the worker.
        // Twitch calls URL.revokeObjectURL() immediately after `new Worker(blobUrl)`,
        // so any deferred importScripts() inside the worker would 404 on the revoked
        // URL — Twitch's HLS logic silently fails to load and the stream never plays.
        // Embedding the script content directly avoids this entirely.
        let originalScript = '';
        try {
          const _xhr = new XMLHttpRequest();
          _xhr.open('GET', url, false); // synchronous — acceptable here, pre-construction
          _xhr.send(null);
          if (_xhr.status === 200 || _xhr.status === 0) originalScript = _xhr.responseText;
        } catch (_xhrErr) {
          console.warn('[SB] XHR blob read failed, falling back to importScripts');
        }

        const channel = getCurrentChannel();
        // WORKER_INJECT sets _origFetch = real fetch, then self.fetch = our interceptor.
        // Twitch's embedded script then does: orig = self.fetch (= our interceptor),
        //   self.fetch = TwitchWrapper(ourInterceptor).
        // Requests flow: TwitchWrapper → ourInterceptor → _origFetch (real fetch).
        // Our M3U8 interception fires correctly — no re-seat needed.
        const patched = WORKER_INJECT
          .replace(/var _sbChannel\s*=\s*null;/, `var _sbChannel = ${JSON.stringify(channel || null)};`)
          + (originalScript
            // ── Preferred path: original script embedded, URL revocation harmless ──
            ? `\n// Twitch original worker script (embedded to survive URL revocation):\n${originalScript}\n`
            // ── Fallback: importScripts (used only if XHR blob read failed) ──
            : `\n(function(_u){\n  var _sbI=self.fetch;\n` +
              `  if(typeof importScripts==='function'){\n` +
              `    try{importScripts(_u);}catch(e){console.warn('[SB] importScripts failed:',e.message);}\n` +
              `    if(self.fetch!==_sbI){var _tf=self.fetch;self.fetch=async function(r,i){return _sbI.apply(this,arguments);};}\n` +
              `  }else{\n` +
              `    import(_u).then(function(){if(self.fetch!==_sbI){self.fetch=async function(r,i){return _sbI.apply(this,arguments);};}})` +
              `.catch(function(e){console.warn('[SB] import failed:',e.message);});\n` +
              `  }\n})(${JSON.stringify(url)});\n`
          );

        const blob = new Blob([patched], { type: 'application/javascript' });
        url = URL.createObjectURL(blob);
      } catch (_) {
        url = scriptUrl instanceof URL ? scriptUrl.href : scriptUrl;
      }
    }

    const worker = new _Worker(url, options);
    _twitchWorkers.push(worker);

    // Forward captured auth headers to worker whenever they're available
    function _forwardAuth() {
      if (_capturedAuth) {
        worker.postMessage({
          type: 'SB_AUTH',
          auth:     _capturedAuth,
          deviceId: _capturedDeviceId,
          clientId: _capturedClientId,
        });
      }
    }
    _forwardAuth();

    // Relay worker events to content script
    worker.addEventListener('message', function (e) {
      if (!e.data || typeof e.data.type !== 'string') return;
      const t = e.data.type;
      if (t === 'SB_AD_START') {
        document.dispatchEvent(new CustomEvent('_sb_twitch_ad_start'));
      } else if (t === 'SB_AD_END' || t === 'SB_AD_SWAPPED') {
        document.dispatchEvent(new CustomEvent('_sb_twitch_ad_end'));
      }
    });

    return worker;
  };

  try { window.Worker.prototype = _Worker.prototype; } catch (_) {}
  try { Object.defineProperty(window.Worker, 'toString', { value: () => _Worker.toString() }); } catch (_) {}

  // ── Main-thread fetch hook ───────────────────────────────────────────────────
  // 1. Capture auth headers from Twitch's own GQL requests and forward to workers
  // 2. Replace playerType 'site' → 'embed' on PlaybackAccessToken to reduce prerolls
  // 3. Block main-thread ad telemetry
  const _fetch = window.fetch;
  window.fetch = async function (resource, init) {
    const url = (typeof resource === 'string' ? resource : resource?.url) ?? '';

    // Capture auth headers from ANY Twitch API call
    if (url.includes('.twitch.tv') && init?.headers) {
      try {
        const h = init.headers instanceof Headers
          ? Object.fromEntries(init.headers.entries())
          : (typeof init.headers === 'object' ? init.headers : {});
        if (h['Authorization'] || h['authorization']) {
          _capturedAuth     = h['Authorization'] || h['authorization'];
          _capturedDeviceId = h['X-Device-Id']   || h['x-device-id'] || _capturedDeviceId;
          _capturedClientId = h['Client-Id']      || h['client-id']   || _capturedClientId;
          // Forward to all active workers; prune any that have been terminated
          const msg = { type: 'SB_AUTH', auth: _capturedAuth,
                        deviceId: _capturedDeviceId, clientId: _capturedClientId };
          for (let wi = _twitchWorkers.length - 1; wi >= 0; wi--) {
            try { _twitchWorkers[wi].postMessage(msg); }
            catch (_) { _twitchWorkers.splice(wi, 1); } // remove dead worker
          }
        }
      } catch (_) {}
    }

    // Patch PlaybackAccessToken playerType
    if (url.includes('gql.twitch.tv') && init?.body) {
      try {
        let body    = typeof init.body === 'string' ? JSON.parse(init.body) : init.body;
        const arr   = Array.isArray(body) ? body : [body];
        let changed = false;
        for (const q of arr) {
          if ((q.operationName === 'PlaybackAccessToken' ||
               q.operationName === 'PlaybackAccessToken_Template') &&
              q.variables?.playerType === 'site') {
            q.variables.playerType = 'embed';
            changed = true;
          }
        }
        if (changed) {
          return _fetch.call(this, resource, {
            ...init,
            body: JSON.stringify(Array.isArray(body) ? arr : arr[0]),
          });
        }
      } catch (_) {}
    }

    // Block main-thread telemetry
    const TELEMETRY = [
      'spade.twitch.tv','twitchadvertising.tv','client-event.twitch.tv',
      'audience-media.twitch.tv','imasdk.googleapis.com','tv.freewheel.tv',
      'securepubads.g.doubleclick.net','stats.g.doubleclick.net',
      'tag.targeting.unrulymedia.com','beacon.krxd.net',
    ];
    if (TELEMETRY.some(h => url.includes(h))) {
      return new Response('', { status: 200 });
    }

    return _fetch.apply(this, arguments);
  };

})();
