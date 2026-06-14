/**
 * ShieldBlock Pro — Hulu Content Script
 * Basic ad skip for Hulu web player.
 * Hulu uses SSAI like Twitch, so full blocking isn't possible without
 * a proxy. We skip the player forward and mute during ad breaks.
 */

(async () => {
  // ── Log helper ────────────────────────────────────────────────────────────────
  function _sbLog(level, message, data) {
    chrome.runtime.sendMessage({ type: 'LOG_EVENT', source: 'hulu', level, message, data: data ?? {} }).catch(() => {});
  }

  // If SW is waking up when this fires, sendMessage throws and the IIFE crashes
  // silently — no ad blocking runs at all. Retry once after 300ms.
  let settings;
  try {
    settings = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
  } catch (_) {
    await new Promise(r => setTimeout(r, 300));
    try { settings = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }); }
    catch (e) { _sbLog('error', `GET_SETTINGS failed after retry: ${e?.message ?? e}`); settings = null; }
  }
  const _wl = settings?.whitelist ?? [];
  if (settings?.globalPause) return; // global pause active — skip all processing
  if (!settings?.hulu) return;
  const _hostname = location.hostname.replace(/^www\./, '');
  if (_wl.some(d => _hostname === d || _hostname.endsWith('.' + d))) return;

  _sbLog('info', 'Init — hulu.com');


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
  let _stopped = false;

  function handleAdStart() {
    const video = document.querySelector('video');
    if (video) { wasMuted = video.muted; video.muted = true; }
  }

  function restoreAfterAd() {
    const video = document.querySelector('video');
    if (video) video.muted = wasMuted;
  }

  function removeHuluAdUI() {
    // IMPORTANT: never remove the elements isAdPlaying() relies on (the AD_SELECTORS
    // above). Removing them makes the next tick believe the ad ended and unmute while
    // the SSAI ad is still playing in the same stream (mute flaps on/off). Only strip
    // standalone banner/sponsored units, which are NOT used for ad-break detection.
    const REMOVE_SELS = [
      '[class*="SponsoredContent"]',
      '[class*="AdBanner"]',
      '[data-automationid="hitch-unit"]',
    ];
    for (const sel of REMOVE_SELS) {
      try { document.querySelectorAll(sel).forEach(el => el.remove()); } catch (_) {}
    }
  }

  let _adStartTime = 0;
  function tick() {
    if (_stopped) return;
    const hasAd = isAdPlaying();
    if (hasAd && !adActive) {
      adActive = true;
      _adStartTime = Date.now();
      handleAdStart();
      chrome.runtime.sendMessage({ type: 'INCREMENT_STAT', statType: 'hulu' }).catch(() => {});
      _sbLog('info', 'Ad start — video muted (SSAI stream)');
    } else if (!hasAd && adActive) {
      const dur = `${((Date.now() - _adStartTime) / 1000).toFixed(1)}s`;
      adActive = false;
      restoreAfterAd();
      _sbLog('info', `Ad end — audio restored, duration ${dur}`);
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
  let _huluInterval = setInterval(tick, 1000);

  // Safety net: if ad-end detection is missed (the <video> element is swapped or an
  // ad-marker element lingers), audio would stay muted indefinitely. Force-restore
  // after 90s of continuous "ad active" state.
  function _safetyTick() {
    if (adActive && Date.now() - _adStartTime > 90000) {
      adActive = false;
      restoreAfterAd();
      _sbLog('warn', 'Safety timeout: forced ad recovery after 90s');
    }
  }
  let _huluSafety = setInterval(_safetyTick, 5000);

  // Cleanup on page unload — prevents memory leak on SPA navigation
  window.addEventListener('beforeunload', () => {
    _huluObserver.disconnect();
    clearInterval(_huluInterval);
    clearInterval(_huluSafety);
    clearTimeout(_huluDebounce);
  }, { once: true });

  function stopHuluBlocking() {
    if (_stopped) return;
    _stopped = true;
    _huluObserver.disconnect();
    clearInterval(_huluInterval);
    clearInterval(_huluSafety);
    clearTimeout(_huluDebounce);
    if (adActive) { restoreAfterAd(); adActive = false; }
  }

  function startHuluBlocking() {
    if (!_stopped) return; // already running — idempotent
    _stopped = false;
    _huluObserver.disconnect();
    _huluObserver.observe(document.body || document.documentElement, {
      childList: true, subtree: true,
    });
    clearInterval(_huluInterval);
    _huluInterval = setInterval(tick, 1000);
    clearInterval(_huluSafety);
    _huluSafety = setInterval(_safetyTick, 5000);
    tick();
  }

  // Single source of truth for whether blocking should be active. Re-evaluated on
  // every relevant settings / whitelist / pause change so toggling the feature back
  // on, removing the site from the whitelist, or a pause expiring all RE-ARM blocking
  // without a page reload — previously these paths only ever stopped, never restarted.
  let _featureOn = true, _whitelisted = false, _paused = false;
  function _applyState() {
    if (_featureOn && !_whitelisted && !_paused) startHuluBlocking();
    else stopHuluBlocking();
  }
  chrome.storage.onChanged.addListener((changes) => {
    let touched = false;
    if (changes.settings)    { _featureOn = changes.settings.newValue?.hulu !== false; touched = true; }
    if (changes.whitelist)   {
      const wl = changes.whitelist.newValue ?? [];
      _whitelisted = Array.isArray(wl) && wl.some(d => _hostname === d || _hostname.endsWith('.' + d));
      touched = true;
    }
    if (changes.globalPause) {
      const gp = changes.globalPause.newValue;
      _paused = !!(gp && gp.until > Date.now());
      touched = true;
    }
    if (touched) _applyState();
  });
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'GLOBAL_PAUSE')  { _paused = true;  _applyState(); }
    if (message?.type === 'GLOBAL_RESUME') { _paused = false; _applyState(); }
    if (message?.type === 'WHITELIST_CHANGED') {
      const wl = message.whitelist ?? [];
      _whitelisted = wl.some(d => _hostname === d || _hostname.endsWith('.' + d));
      _applyState();
    }
  });

  tick(); // run immediately on load

})().catch(e => {
  try { chrome.runtime.sendMessage({ type: 'LOG_EVENT', source: 'hulu', level: 'error', message: `Script error: ${e?.message ?? e}`, data: {} }).catch(() => {}); } catch (_) {}
  console.warn('[SB:hulu] script error:', e?.message ?? e);
});
