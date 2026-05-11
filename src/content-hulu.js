/**
 * ShieldBlock Pro — Hulu Content Script
 * Basic ad skip for Hulu web player.
 * Hulu uses SSAI like Twitch, so full blocking isn't possible without
 * a proxy. We skip the player forward and mute during ad breaks.
 */

(async () => {
  // If SW is waking up when this fires, sendMessage throws and the IIFE crashes
  // silently — no ad blocking runs at all. Retry once after 300ms.
  let settings;
  try {
    settings = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
  } catch (_) {
    await new Promise(r => setTimeout(r, 300));
    try { settings = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }); }
    catch (_) { settings = null; }
  }
  const _wl = settings?.whitelist ?? [];
  if (settings?.globalPause) return; // global pause active — skip all processing
  if (!settings?.hulu) return;
  const _hostname = location.hostname.replace(/^www\./, '');
  if (_wl.some(d => _hostname === d || _hostname.endsWith('.' + d))) return;


  // ── Ad detection ──────────────────────────────────────────────────────────────

  const AD_SELECTORS = [
    // Hulu ad overlay container
    '[class*="AdExperience"]',
    '[class*="ad-experience"]',
    '[class*="ad-overlay"]',
    // Ad countdown timer
    '[class*="AdCountdown"]',
    '[class*="ad-countdown"]',
    // "Your video will resume" text
    '[class*="VideoResume"]',
    // Hulu's ad "badge"
    '[data-automationid="ad-badge"]',
    '[data-automationid="ad-info"]',
  ];

  function isAdPlaying() {
    for (const sel of AD_SELECTORS) {
      if (document.querySelector(sel)) return true;
    }
    // Check for exact "Ad" or timer text in player elements (not broad class match)
    const playerEl = document.querySelector('.site-player, [class*="Player"], video')?.closest('div');
    if (playerEl) {
      const spans = playerEl.querySelectorAll('span, div');
      for (const el of spans) {
        if (el.children.length === 0 && /^\s*(ad|advertisement|\d+\s*s)\s*$/i.test(el.textContent)) {
          return true;
        }
      }
    }
    return false;
  }

  // ── Skip / mute ───────────────────────────────────────────────────────────────
  // Hulu uses Server-Side Ad Insertion (SSAI) — the ad and content are the SAME
  // continuous video stream. Seeking past an ad timestamp is unreliable: it can
  // overshoot into content, hit a segment boundary causing a buffer stall, or
  // trigger Hulu's server-side bookmarking to restart the ad.
  //
  // Safe strategy: MUTE audio during ad, remove ad UI overlays from the DOM.
  // The ad plays silently in the background. Not ideal but it's stable.
  // We increment the stat so the block count is recorded.

  let adActive = false;
  let wasMuted = false;

  function handleAdStart() {
    const video = document.querySelector('video');
    if (video) { wasMuted = video.muted; video.muted = true; }
  }

  function restoreAfterAd() {
    const video = document.querySelector('video');
    if (video) video.muted = wasMuted;
  }

  function removeHuluAdUI() {
    const REMOVE_SELS = [
      '[class*="AdExperience"]',
      '[class*="ad-experience"]',
      '[class*="ad-overlay"]',
      '[class*="AdCountdown"]',
      '[class*="ad-countdown"]',
      '[data-automationid="ad-badge"]',
      '[data-automationid="ad-info"]',
      '[class*="SponsoredContent"]',
      '[class*="AdBanner"]',
      '[data-automationid="hitch-unit"]',
    ];
    for (const sel of REMOVE_SELS) {
      try { document.querySelectorAll(sel).forEach(el => el.remove()); } catch (_) {}
    }
  }

  function tick() {
    const hasAd = isAdPlaying();
    if (hasAd && !adActive) {
      adActive = true;
      handleAdStart();
      chrome.runtime.sendMessage({ type: 'INCREMENT_STAT', statType: 'hulu' }).catch(() => {});
    } else if (!hasAd && adActive) {
      adActive = false;
      restoreAfterAd();
    }
    removeHuluAdUI();
  }

  let _huluDebounce = null;
  const _huluObserver = new MutationObserver(() => {
    clearTimeout(_huluDebounce);
    _huluDebounce = setTimeout(tick, 250);
  });
  _huluObserver.observe(document.body || document.documentElement, {
    childList: true, subtree: true,
  });
  const _huluInterval = setInterval(tick, 1000);

  // Cleanup on page unload — prevents memory leak on SPA navigation
  window.addEventListener('beforeunload', () => {
    _huluObserver.disconnect();
    clearInterval(_huluInterval);
    clearTimeout(_huluDebounce);
  }, { once: true });

  tick(); // run immediately on load

})().catch(e => console.warn('[SB:hulu] script error:', e?.message ?? e));
