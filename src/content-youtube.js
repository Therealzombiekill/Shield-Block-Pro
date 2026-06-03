/**
 * ShieldBlock Pro — YouTube Content Script
 *
 * DOM-level ad skip and mute. inject-youtube.js handles the primary
 * interception at the InnerTube API level; this script is the fallback
 * for ads that slip through (e.g. live-stream ads, promo cards) and also
 * signals inject-youtube.js to disable itself when the toggle is off.
 */

(async () => {
  // Build marker — surfaces in exported logs so we can confirm exactly which
  // packaged build is running and which YouTube strategy is active. The manifest
  // version alone was ambiguous (old and patched builds both read 2.10.x).
  const SB_YT_BUILD = '2.10.2-ytsafe (dom-only)';

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
  if (settings?.globalPause) {
    window.postMessage({ type: 'SB_YOUTUBE_DISABLE' }, '*');
    return; // global pause active — skip all processing
  }

  if (!settings?.youtube) {
    // Signal MAIN world to stop intercepting
    window.postMessage({ type: 'SB_YOUTUBE_DISABLE' }, '*');
    return;
  }
  if (_wl.some(d => _host === d || _host.endsWith('.' + d))) {
    window.postMessage({ type: 'SB_YOUTUBE_DISABLE' }, '*');
    return;
  }
  // Signal MAIN world to ensure interception is active (handles re-enable after toggle)
  window.postMessage({ type: 'SB_YOUTUBE_ENABLE' }, '*');

  _sbLog('info', `Init — ${_host} [${SB_YT_BUILD}]`, { ytMusic: _host.includes('music.'), build: SB_YT_BUILD });

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
    // NOTE: do NOT remove .ytp-ad-player-overlay-layout here — it is structural
    // in-player markup, and el.remove()'ing it blanks the whole video (black
    // screen). Ads are handled by mute/skip + the InnerTube strip instead.
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
    'ytd-promoted-sparkles-text-search-renderer',
    // Current (2024+) feed / companion ad-slot renderers — home feed, watch-next
    // sidebar, and the companion banner shown alongside in-stream ads.
    'ytd-ad-slot-renderer',
    'ytd-in-feed-ad-layout-renderer',
    'ytd-companion-slot-renderer',
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

  // ── Main loop ─────────────────────────────────────────────────────────────────
  function tick() { handleAd(); removeOverlays(); handleYTMusicAd(); }

  const _tickInterval = setInterval(tick, 750);
  tick();

  // Fast path: click skip button the moment it appears in the DOM.
  // YouTube's player mutates constantly, so debounce to ~1 click/sec — otherwise
  // a single ad triggers dozens of redundant clicks (and log spam) per second,
  // which can disrupt playback (especially on YouTube Music).
  let _lastSkipClick = 0;
  const _skipObserver = new MutationObserver(() => {
    if (Date.now() - _lastSkipClick < 1000) return;
    const skip = document.querySelector(
      '.ytp-ad-skip-button, .ytp-skip-ad-button, .ytp-ad-skip-button-modern'
    );
    if (skip) { skip.click(); _lastSkipClick = Date.now(); _sbLog('info', 'Ad: skip button clicked'); }
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
  function _restoreAudio() {
    if (_muted || _ytmAdActive) {
      const media = document.querySelector('video') || document.querySelector('audio');
      try { if (media) media.muted = false; } catch (_) {}
      _muted = false; _ytmAdActive = false;
    }
  }
  let _stopped = false;
  function _disableNow() {
    if (!_stopped) {
      _cleanup();
      _restoreAudio();
      _stopped = true;
    }
    window.postMessage({ type: 'SB_YOUTUBE_DISABLE' }, '*');
  }
  window.addEventListener('beforeunload', _cleanup, { once: true });
  chrome.storage.onChanged.addListener((changes) => {
    const wl = changes.whitelist?.newValue;
    const isWhitelisted = Array.isArray(wl) && wl.some(d => _host === d || _host.endsWith('.' + d));
    const paused = changes.globalPause?.newValue && changes.globalPause.newValue.until > Date.now();
    if (changes.settings?.newValue?.youtube === false || isWhitelisted || paused) {
      _disableNow();
    }
  });
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'GLOBAL_PAUSE') _disableNow();
    if (message?.type === 'WHITELIST_CHANGED') {
      const wl = message.whitelist ?? [];
      if (wl.some(d => _host === d || _host.endsWith('.' + d))) _disableNow();
    }
  });
})().catch(e => {
  try { chrome.runtime.sendMessage({ type: 'LOG_EVENT', source: 'youtube', level: 'error', message: `Script error: ${e?.message ?? e}`, data: {} }).catch(() => {}); } catch (_) {}
  console.warn('[SB:youtube] script error:', e?.message ?? e);
});
