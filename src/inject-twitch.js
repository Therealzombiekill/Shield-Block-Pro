/**
 * ShieldBlock Pro — Twitch MAIN World Injection (simplified)
 *
 * Worker injection (vaft-style) was removed — vaft was archived Mar 2026 and
 * Twitch's player updates since then cause the worker hook to crash the HLS
 * player entirely, preventing any stream from loading.
 *
 * What remains (safe, low-maintenance):
 *   1. GQL playerType patch — forces playerType=embed on PlaybackAccessToken
 *      requests, which reduces / eliminates server-side pre-roll ads for many
 *      channels without touching the HLS worker at all.
 *   2. Main-thread telemetry block — drops obvious ad-tracking requests.
 *
 * Ad muting / toast is handled entirely by content-twitch.js (ISOLATED world)
 * via DOM-level detection.
 */

(function () {
  'use strict';

  // ── Disable flag ──────────────────────────────────────────────────────────────
  let _disabled = false;
  window.addEventListener('message', function (e) {
    if (e.source !== window) return;
    if (e.data?.type === 'SB_TWITCH_DISABLE') _disabled = true;
    if (e.data?.type === 'SB_TWITCH_ENABLE')  _disabled = false;
  });

  // ── Fake IMA SDK stub ─────────────────────────────────────────────────────────
  // Twitch checks window.google.ima after loading imasdk.googleapis.com.
  // Returning an empty 200 leaves google.ima undefined, which Twitch detects
  // and shows an "ad blocker" warning that blocks the stream.
  // This stub satisfies the detection without serving any real ads.
  const _IMA_STUB = `(function(){
    if(window.google&&window.google.ima)return;
    function n(){}
    window.google=window.google||{};
    window.google.ima={
      AdDisplayContainer:function(c,v){this.initialize=n;this.destroy=n;},
      AdsLoader:function(c){
        this.settings={setVpaidMode:n,setLocale:n,setNumRedirects:n,setPlayerType:n,setPlayerVersion:n};
        this.addEventListener=n;this.removeEventListener=n;
        this.requestAds=n;this.destroy=n;this.contentComplete=n;
      },
      AdsRequest:function(){this.setAdWillAutoPlay=n;this.setAdWillPlayMuted=n;},
      AdsRenderingSettings:function(){},
      AdsManagerLoadedEvent:{Type:{ADS_MANAGER_LOADED:'adsManagerLoaded'}},
      AdErrorEvent:{Type:{AD_ERROR:'adError'}},
      AdEvent:{Type:{
        ALL_ADS_COMPLETED:'allAdsCompleted',CLICK:'click',COMPLETE:'complete',
        CONTENT_PAUSE_REQUESTED:'contentPauseRequested',
        CONTENT_RESUME_REQUESTED:'contentResumeRequested',
        DURATION_CHANGE:'durationChange',FIRST_QUARTILE:'firstQuartile',
        IMPRESSION:'impression',LOADED:'loaded',MIDPOINT:'midpoint',
        PAUSED:'pause',RESUMED:'resume',SKIPPABLE_STATE_CHANGED:'skippableStateChanged',
        SKIPPED:'skip',STARTED:'start',THIRD_QUARTILE:'thirdQuartile',
        USER_CLOSE:'userClose',VOLUME_CHANGED:'volumeChange',VOLUME_MUTED:'mute'
      }},
      settings:{setVpaidMode:n,setLocale:n,setNumRedirects:n,setPlayerType:n,setPlayerVersion:n},
      UiElements:{AD_ATTRIBUTION:'adAttribution',COUNTDOWN:'countdown'},
      ViewMode:{FULLSCREEN:'fullscreen',NORMAL:'normal'},
      VERSION:'3.517.2'
    };
  })();`;

  // ── Main-thread fetch hook ────────────────────────────────────────────────────
  const _fetch = window.fetch;
  window.fetch = async function (resource, init) {
    if (_disabled) return _fetch.apply(this, arguments);

    const url = (typeof resource === 'string' ? resource : resource?.url) ?? '';

    // 1. Patch PlaybackAccessToken playerType site → embed to reduce pre-rolls.
    //    Falls back to the original (site) request if Twitch rejects embed —
    //    this ensures streams always load even if Twitch patches the embed trick.
    if (url.includes('gql.twitch.tv') && init?.body) {
      try {
        const raw  = typeof init.body === 'string' ? init.body : null;
        if (raw) {
          const arr   = JSON.parse(raw);
          const items = Array.isArray(arr) ? arr : [arr];
          let changed = false;
          for (const q of items) {
            if (
              (q.operationName === 'PlaybackAccessToken' ||
               q.operationName === 'PlaybackAccessToken_Template') &&
              q.variables?.playerType === 'site'
            ) {
              q.variables.playerType = 'embed';
              changed = true;
            }
          }
          if (changed) {
            const patchedInit = {
              ...init,
              body: JSON.stringify(Array.isArray(arr) ? items : items[0]),
            };
            try {
              const resp = await _fetch.call(this, resource, patchedInit);
              if (resp.ok) {
                try {
                  const clone = resp.clone();
                  const data  = await clone.json();
                  const isArr = Array.isArray(data);
                  const hasErr = isArr
                    ? data.some(d => d.errors?.length > 0)
                    : (data.errors?.length > 0);
                  if (!hasErr) return resp;
                } catch (_) {
                  return resp; // can't parse JSON — assume success
                }
              }
            } catch (_) {}
            // embed was rejected or errored — fall through to unpatched request
            return _fetch.call(this, resource, init);
          }
        }
      } catch (_) {}
    }

    // 2. Return fake IMA SDK stub — prevents Twitch's anti-adblock detection
    //    from firing when google.ima is accessed after script load.
    if (url.includes('imasdk.googleapis.com')) {
      return new Response(_IMA_STUB, {
        status: 200,
        headers: { 'Content-Type': 'text/javascript' },
      });
    }

    // 3. Block obvious ad-tracking / ad-serving endpoints.
    //    Note: client-event.twitch.tv is intentionally NOT blocked — Twitch
    //    uses it for session heartbeats that gate stream playback.
    //    Note: twitchsvc.net is intentionally NOT blocked — it is also used
    //    for stream authentication / playback and lives in PROTECTED_DOMAINS
    //    in filter-parser.js for the same reason.
    const BLOCK = [
      'twitchadvertising.tv',
      'tv.freewheel.tv',
      'securepubads.g.doubleclick.net',
      'stats.g.doubleclick.net',
      'cm.g.doubleclick.net',
      'tag.targeting.unrulymedia.com',
      'beacon.krxd.net',
      'audience-media.twitch.tv',
      'ad.doubleclick.net',
    ];
    if (BLOCK.some(h => url.includes(h))) {
      return new Response('', { status: 200 });
    }

    return _fetch.apply(this, arguments);
  };

})();
