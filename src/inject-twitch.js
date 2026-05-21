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

  // ── Main-thread fetch hook ────────────────────────────────────────────────────
  // Guard: prevent double-wrapping if script re-runs after extension update
  if (!window.fetch._sbTwitchHooked) {
  const _fetch = window.fetch;
  window.fetch = async function (resource, init) {
    if (_disabled) return _fetch.apply(this, arguments);

    const url = (typeof resource === 'string' ? resource : resource?.url) ?? '';

    // 1. Patch PlaybackAccessToken playerType site → embed to reduce pre-rolls.
    //    'embed' player type skips many server-side ad insertions.
    if (url.includes('gql.twitch.tv') && init?.body) {
      try {
        const raw  = typeof init.body === 'string' ? init.body : null;
        if (raw) {
          const arr     = JSON.parse(raw);
          const items   = Array.isArray(arr) ? arr : [arr];
          let changed   = false;
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
            return _fetch.call(this, resource, {
              ...init,
              body: JSON.stringify(Array.isArray(arr) ? items : items[0]),
            });
          }
        }
      } catch (_) {}
    }

    // 2. Block obvious ad-tracking / ad-serving endpoints.
    //    Note: client-event.twitch.tv is intentionally NOT blocked — Twitch
    //    uses it for session heartbeats that gate stream playback.
    const BLOCK = [
      'twitchadvertising.tv',
      'imasdk.googleapis.com',
      'tv.freewheel.tv',
      'securepubads.g.doubleclick.net',
      'stats.g.doubleclick.net',
      'cm.g.doubleclick.net',
      'tag.targeting.unrulymedia.com',
      'beacon.krxd.net',
      'audience-media.twitch.tv',
    ];
    if (BLOCK.some(h => url.includes(h))) {
      return new Response('', { status: 200 });
    }

    return _fetch.apply(this, arguments);
  };
  window.fetch._sbTwitchHooked = true;
  } // end idempotency guard

})();
