/**
 * ShieldBlock Pro — YouTube MAIN World Injection (SAFE / DOM-only mode)
 *
 * HISTORY / WHY THIS IS A STUB:
 * This script previously intercepted YouTube's InnerTube /player API to strip
 * ad placements before the player queued them. It did this two ways:
 *   1. wrapping window.ytInitialPlayerResponse in a getter/setter, and
 *   2. overriding window.fetch to re-serialize the /player JSON response
 *      (new Response(JSON.stringify(strippedJson), ...)).
 *
 * On Firefox that path was implicated in a black-screen playback failure:
 * exported logs showed video data still downloading from googlevideo.com and
 * ads being "stripped", yet the player rendered black. Reconstructing a
 * Response loses the original response.url / response.type and re-frames a body
 * the player fetched expecting the original encoding/length — a plausible cause
 * of the player bailing out while the network layer kept fetching.
 *
 * To make it IMPOSSIBLE for this extension to break YouTube playback, the
 * MAIN-world interception is fully disabled. The player now receives YouTube's
 * pristine, unmodified responses. Ad handling is done entirely at the DOM level
 * by content-youtube.js — clicking skip buttons, seeking past short ads, muting
 * unskippable ads, and removing page-level ad elements — none of which can blank
 * the video.
 *
 * This stub remains only so the SB_YOUTUBE_ENABLE / SB_YOUTUBE_DISABLE
 * postMessages from content-youtube.js have a listener (no console errors), and
 * to leave one obvious place to re-introduce a *safe, in-place* strip later once
 * playback is confirmed stable. Do NOT reintroduce Response reconstruction here.
 */

(function () {
  'use strict';

  // Absorb enable/disable signals from content-youtube.js. Intentionally inert:
  // there is no InnerTube interception in DOM-only mode, so nothing to toggle.
  window.addEventListener('message', function (e) {
    if (e.source !== window) return;
    // no-op — kept so the messages don't go unhandled
  });
})();
