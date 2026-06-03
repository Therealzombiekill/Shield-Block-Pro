/**
 * ShieldBlock Pro — YouTube Content Script
 *
 * DOM-level ad skip and mute. inject-youtube.js handles the primary
 * interception at the InnerTube API level; this script is the fallback
 * for ads that slip through (e.g. live-stream ads, promo cards) and also
 * signals inject-youtube.js to disable itself when the toggle is off.
 */

(async () => {
  // ── Log helper ────────────────────────────────────────────────────────────────
  function _sbLog(level, message, data) {
    chrome.runtime.sendMessage({ type: 'LOG_EVENT', source: 'youtube', level, message, data: data ?? {} }).catch(() => {});
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
  const _host = location.hostname.replace(/^www\./, '');
  const _whitelisted = _wl.some(d => _host === d || _host.endsWith('.' + d));

  // Single source of truth for whether YouTube interception should run. settings
  // is null only if the SW failed to respond even after the retry above — in that
  // case fail safe to "disabled" (don't block) and leave the cache untouched.
  const _shouldDisable = !settings || !settings.youtube || !!settings.globalPause || _whitelisted;

  // Cache the decision so inject-youtube.js (MAIN world) can read it synchronously
  // at document_start on the next load and handle the initial player response
  // before this script runs. Only write when we have real settings, so a transient
  // SW-wakeup failure can't poison the cache for the next load.
  if (settings) {
    try { localStorage.setItem('__sbYtOff', _shouldDisable ? '1' : '0'); } catch (_) {}
  }

  // One authoritative signal — no enable→disable flip-flop, and globalPause now
  // correctly tells the MAIN world to stop (previously it returned silently).
  window.postMessage({ type: _shouldDisable ? 'SB_YOUTUBE_DISABLE' : 'SB_YOUTUBE_ENABLE' }, '*');
  if (_shouldDisable) return;

  _sbLog('info', `Init — ${_host}`, { ytMusic: _host.includes('music.') });

  // ── Relay log messages from inject-youtube.js (MAIN world) ───────────────────
  // inject-youtube.js cannot call chrome APIs; it postMessages here and we relay.
  window.addEventListener('message', e => {
    if (e.source !== window || e.data?.type !== 'SB_YT_LOG') return;
    _sbLog(e.data.level ?? 'info', e.data.message, e.data.data);
  });

  // ── Ad detection ──────────────────────────────────────────────────────────────
  function isAdPlaying() {
    return !!(
      document.querySelector('.ad-showing') ||
      document.querySelector('.ytp-ad-text') ||
      document.querySelector('.ytp-ad-skip-button') ||
      document.querySelector('.ytp-skip-ad-button') ||
      document.querySelector('.ytp-ad-skip-button-modern')
    );
  }

  // ── Skip / mute ───────────────────────────────────────────────────────────────
  let _muted = false;
  let _origVol = null;

  function handleAd() {
    if (!isAdPlaying()) {
      // Restore volume if we muted for an ad
      if (_muted) {
        const vid = document.querySelector('video');
        if (vid && _origVol !== null) { vid.muted = false; vid.volume = _origVol; }
        _sbLog('info', 'Ad cleared — audio restored');
        _muted = false;
        _origVol = null;
      }
      return;
    }

    // 1. Click skip button if visible
    const skip = document.querySelector(
      '.ytp-ad-skip-button, .ytp-skip-ad-button, .ytp-ad-skip-button-modern'
    );
    if (skip) { skip.click(); _sbLog('info', 'Ad: clicked skip button'); return; }

    // 2. Seek past short ads.
    // Guard: only seek if .ad-showing is on the player — this class is set
    // by YouTube itself and is the most reliable ad signal. The duration < 120
    // guard prevents accidentally seeking a short legitimate video (Shorts, clips).
    const vid = document.querySelector('video');
    const playerHasAdClass = !!document.querySelector('.ad-showing');
    if (vid && playerHasAdClass && isFinite(vid.duration) && vid.duration > 0 && vid.duration < 120) {
      vid.currentTime = vid.duration;
      _sbLog('info', `Ad: seeked past (${vid.duration.toFixed(1)}s)`);
      return;
    }

    // 3. Mute unskippable long ads as last resort
    if (vid && !_muted) {
      _origVol = vid.volume;
      vid.muted = true;
      _muted = true;
      _sbLog('warn', 'Ad: unskippable — video muted');
    }
  }

  // ── Remove ad overlay and promoted elements ────────────────────────────────────
  const OVERLAY_SELS = [
    // In-player overlays
    '.ytp-ad-overlay-container', '.ytp-ad-overlay-slot',
    '.ytp-ce-element',                      // end-cards
    '.ytp-suggested-action',                // "Visit advertiser" CTA
    '.ytp-ad-image-overlay',
    // Page-level ad placements
    '#masthead-ad',
    '#player-ads',
    'ytd-display-ad-renderer',
    'ytd-banner-promo-renderer',
    'ytd-statement-banner-renderer',
    '.ytd-banner-promo-renderer',
    '.ytd-promoted-sparkles-web-renderer',
    '.ytd-compact-promoted-item-renderer',
    // Search page sponsored results
    'ytd-search-pyv-renderer',
    'ytd-promoted-video-renderer',
    // ── YouTube Music ad selectors ───────────────────────────────────────────
    // YTM uses a different component prefix (ytmusic-) and injects ads as
    // interstitial overlays and in-shelf promotions in the song queue.
    'ytmusic-mealbar-promo-renderer',       // "Try YouTube Premium" sticky bar
    'ytmusic-statement-banner-renderer',    // promotional banners
    'ytmusic-display-ad-renderer',          // display ads in shelves
    '.ytmusic-paid-content-overlay-renderer', // paid content gate overlay
    '[ad-joining-count]',                   // ad queue slots
    // Audio ad playing indicator + skip
    '.ytmusic-player-bar[ad-playing]',
  ];

  let _overlayLogThrottle = 0;
  function removeOverlays() {
    let removed = 0;
    for (const sel of OVERLAY_SELS) {
      document.querySelectorAll(sel).forEach(el => { try { el.remove(); removed++; } catch (_) {} });
    }
    if (removed > 0 && Date.now() - _overlayLogThrottle > 5000) {
      _overlayLogThrottle = Date.now();
      _sbLog('info', `Removed ${removed} ad overlay element(s)`);
    }
  }

  // ── YouTube Music audio ad handling ──────────────────────────────────────────
  // YTM audio ads: the `ad-playing` attribute appears on the player bar.
  // We mute the audio element during the ad. Seeking to end was removed —
  // it's unreliable and the YTM audio element duration resets unpredictably.
  let _ytmAdActive = false;
  let _ytmWasMuted = false;
  function handleYTMusicAd() {
    if (!location.hostname.includes('music.youtube.com')) return;
    const playerBar = document.querySelector('ytmusic-player-bar');
    if (!playerBar?.hasAttribute('ad-playing')) {
      if (_ytmAdActive) {
        _ytmAdActive = false;
        const audio = document.querySelector('audio');
        try { if (audio) audio.muted = _ytmWasMuted; } catch (_) {}
        _sbLog('info', 'YT Music audio ad cleared — audio restored');
      }
      return;
    }
    const audio = document.querySelector('audio');
    try {
      if (audio && !_ytmAdActive) {
        _ytmWasMuted = audio.muted;
        audio.muted = true;
        _ytmAdActive = true;
        _sbLog('warn', 'YT Music audio ad — muted');
      }
    } catch (_) {}
  }

  // ── Anti-adblock enforcement popup ─────────────────────────────────────────────
  // When YouTube detects blocking it shows a modal ("Ad blockers are not allowed
  // on YouTube") and pauses the video. The InnerTube stripping in
  // inject-youtube.js prevents this in most cases; this is the fallback that
  // dismisses the modal and resumes playback if it slips through.
  let _popupLogThrottle = 0;
  function dismissAdblockPopup() {
    const enforcement = document.querySelector(
      'ytd-enforcement-message-view-model, .ytd-enforcement-message-view-model'
    );
    if (!enforcement) return;
    // Remove only the specific dialog containing the enforcement message —
    // NOT the shared ytd-popup-container (which also hosts legit menus).
    const dialog = enforcement.closest('tp-yt-paper-dialog');
    try { (dialog || enforcement).remove(); } catch (_) {}
    // Drop the modal backdrop and unlock page scrolling.
    document.querySelectorAll('tp-yt-iron-overlay-backdrop').forEach(el => { try { el.remove(); } catch (_) {} });
    try {
      document.documentElement.style.removeProperty('overflow');
      if (document.body) document.body.style.removeProperty('overflow');
    } catch (_) {}
    // The popup pauses the video — resume it.
    const vid = document.querySelector('video');
    try { if (vid && vid.paused) vid.play().catch(() => {}); } catch (_) {}
    if (Date.now() - _popupLogThrottle > 5000) {
      _popupLogThrottle = Date.now();
      _sbLog('warn', 'Anti-adblock popup dismissed — playback resumed');
    }
  }

  // ── Main loop ─────────────────────────────────────────────────────────────────
  function tick() { handleAd(); removeOverlays(); handleYTMusicAd(); dismissAdblockPopup(); }

  const _tickInterval = setInterval(tick, 750);
  tick();

  // Fast path: click skip button / dismiss enforcement popup the moment either
  // appears in the DOM, without waiting for the next tick.
  const _skipObserver = new MutationObserver(() => {
    const skip = document.querySelector(
      '.ytp-ad-skip-button, .ytp-skip-ad-button, .ytp-ad-skip-button-modern'
    );
    if (skip) { skip.click(); _sbLog('info', 'Ad: MutationObserver skip button clicked'); }
    dismissAdblockPopup();
  });
  _skipObserver.observe(document.documentElement, { childList: true, subtree: true });

  // Stat — count each ad encounter once
  let _wasAd = false;
  const _statInterval = setInterval(() => {
    const ad = isAdPlaying();
    if (ad && !_wasAd) {
      chrome.runtime.sendMessage({ type: 'INCREMENT_STAT', statType: 'youtube' }).catch(() => {});
    }
    _wasAd = ad;
  }, 1000);

  // Cleanup — disconnect observers and clear intervals when YouTube SPA navigates
  // away or the feature toggle is turned off (prevents memory/CPU accumulation).
  function _cleanup() {
    clearInterval(_tickInterval);
    clearInterval(_statInterval);
    _skipObserver.disconnect();
  }
  window.addEventListener('beforeunload', _cleanup, { once: true });
  chrome.storage.onChanged.addListener((changes) => {
    const ns = changes.settings?.newValue;
    if (!ns) return;
    // React to any mid-session change that should stop interception: the youtube
    // toggle, globalPause, or this host being added to the whitelist. (Re-enabling
    // still requires a reload — the intervals/observers are torn down below.)
    const nowDisabled = !ns.youtube || !!ns.globalPause ||
      (Array.isArray(ns.whitelist) && ns.whitelist.some(d => _host === d || _host.endsWith('.' + d)));
    if (!nowDisabled) return;
    // Keep the document_start cache in sync so the next load also starts disabled.
    try { localStorage.setItem('__sbYtOff', '1'); } catch (_) {}
    _cleanup(); // idempotent — safe to call more than once
    // Restore audio if we muted it for an ad
    if (_muted || _ytmAdActive) {
      const media = document.querySelector('video') || document.querySelector('audio');
      try { if (media) media.muted = false; } catch (_) {}
      _muted = false; _ytmAdActive = false;
    }
    window.postMessage({ type: 'SB_YOUTUBE_DISABLE' }, '*');
  });
})().catch(e => {
  try { chrome.runtime.sendMessage({ type: 'LOG_EVENT', source: 'youtube', level: 'error', message: `Script error: ${e?.message ?? e}`, data: {} }).catch(() => {}); } catch (_) {}
  console.warn('[SB:youtube] script error:', e?.message ?? e);
});
