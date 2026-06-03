/**
 * ShieldBlock Pro — YouTube Content Script
 *
 * Play-first: nothing touches the player until video/audio is actually playing,
 * then DOM skip/mute/overlay removal runs. inject-youtube.js only prunes
 * ytInitial after the same signal (SB_YT_PLAYBACK_READY).
 */

(async () => {
  const SB_YT_BUILD = '2.11.1-playfirst';
  const YT_PLAYER_ERR = '282054944';
  const PLAYBACK_GRACE_MS = 2000;
  const NO_VIDEO_FALLBACK_MS = 12000;

  function _sbLog(level, message, data) {
    chrome.runtime.sendMessage({ type: 'LOG_EVENT', source: 'youtube', level, message, data: data ?? {} }).catch(() => {});
  }

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

  let _shouldDisable = !settings || !settings.youtube || !!settings.globalPause || _whitelisted;

  if (settings) {
    try {
      localStorage.setItem('__sbYtOff', _shouldDisable ? '1' : '0');
      if (!_shouldDisable) sessionStorage.removeItem('__sbYtRecovery');
    } catch (_) {}
  }
  try {
    if (sessionStorage.getItem('__sbYtRecovery') === '1' && !_shouldDisable) {
      _sbLog('warn', `Prior ${YT_PLAYER_ERR} on this tab — staying in playback-safe mode until refresh`);
      _shouldDisable = true;
    }
  } catch (_) {}

  window.postMessage({ type: _shouldDisable ? 'SB_YOUTUBE_DISABLE' : 'SB_YOUTUBE_ENABLE' }, '*');
  if (_shouldDisable) return;

  _sbLog('info', `Init — ${_host} [${SB_YT_BUILD}] (play-first)`, { build: SB_YT_BUILD });

  window.addEventListener('message', e => {
    if (e.source !== window || e.data?.type !== 'SB_YT_LOG') return;
    _sbLog(e.data.level ?? 'info', e.data.message, e.data.data);
  });

  let _blockingActive = false;
  let _feedOnly = false;
  let _armTimer = null;

  function armBlocking(feedOnly = false) {
    if (_blockingActive) return;
    _blockingActive = true;
    _feedOnly = feedOnly;
    window.postMessage({ type: 'SB_YT_PLAYBACK_READY' }, '*');
    _sbLog('info', feedOnly
      ? 'Feed/browse mode — non-player ad blocking active'
      : 'Playback started — ad blocking active');
  }

  function scheduleArm(feedOnly = false) {
    if (_blockingActive || _armTimer) return;
    _armTimer = setTimeout(() => {
      _armTimer = null;
      armBlocking(feedOnly);
    }, feedOnly ? 0 : PLAYBACK_GRACE_MS);
  }

  function watchForPlayback() {
    const isMusic = location.hostname.includes('music.youtube.com');

    const tryMedia = () => {
      if (_blockingActive) return true;
      const media = document.querySelector(isMusic ? 'audio' : 'video');
      if (!media) return false;

      const playing = !media.paused && media.readyState >= 2 &&
        (media.currentTime > 0.15 || media.readyState >= 3);
      if (playing) {
        scheduleArm(false);
        return true;
      }

      const onReady = () => scheduleArm(false);
      media.addEventListener('playing', onReady, { once: true });
      media.addEventListener('timeupdate', function onTU() {
        if (media.currentTime > 0.2) {
          media.removeEventListener('timeupdate', onTU);
          scheduleArm(false);
        }
      });
      return true;
    };

    if (tryMedia()) return;

    const mo = new MutationObserver(() => {
      if (tryMedia()) mo.disconnect();
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });

    setTimeout(() => {
      mo.disconnect();
      if (!_blockingActive) {
        const hasPlayer = !!document.querySelector('video, audio');
        scheduleArm(!hasPlayer);
      }
    }, NO_VIDEO_FALLBACK_MS);
  }

  watchForPlayback();

  function isAdPlaying() {
    return !!(
      document.querySelector('.ad-showing') ||
      document.querySelector('.ytp-ad-text') ||
      document.querySelector('.ytp-ad-skip-button') ||
      document.querySelector('.ytp-skip-ad-button') ||
      document.querySelector('.ytp-ad-skip-button-modern')
    );
  }

  let _muted = false;
  let _origVol = null;

  function handleAd() {
    if (!isAdPlaying()) {
      if (_muted) {
        const vid = document.querySelector('video');
        if (vid && _origVol !== null) { vid.muted = false; vid.volume = _origVol; }
        _sbLog('info', 'Ad cleared — audio restored');
        _muted = false;
        _origVol = null;
      }
      return;
    }

    const skip = document.querySelector(
      '.ytp-ad-skip-button, .ytp-skip-ad-button, .ytp-ad-skip-button-modern'
    );
    if (skip) { skip.click(); _sbLog('info', 'Ad: clicked skip button'); return; }

    const vid = document.querySelector('video');
    const playerHasAdClass = !!document.querySelector('.ad-showing');
    const adUiPresent = !!document.querySelector(
      '.ytp-ad-player-overlay, .ytp-ad-player-overlay-layout, .ytp-ad-preview-text, ' +
      '.ytp-ad-text, .ytp-ad-skip-button, .ytp-ad-skip-button-modern'
    );
    if (vid && playerHasAdClass && adUiPresent && isFinite(vid.duration) && vid.duration > 0 && vid.duration < 120) {
      vid.currentTime = vid.duration;
      _sbLog('info', `Ad: seeked past (${vid.duration.toFixed(1)}s)`);
      return;
    }

    if (vid && !_muted) {
      _origVol = vid.volume;
      vid.muted = true;
      _muted = true;
      _sbLog('warn', 'Ad: unskippable — video muted');
    }
  }

  const OVERLAY_SELS = [
    '.ytp-ad-overlay-container', '.ytp-ad-overlay-slot',
    '.ytp-suggested-action',
    '.ytp-ad-image-overlay',
    '#masthead-ad',
    'ytd-display-ad-renderer',
    'ytd-banner-promo-renderer',
    'ytd-statement-banner-renderer',
    '.ytd-banner-promo-renderer',
    '.ytd-promoted-sparkles-web-renderer',
    '.ytd-compact-promoted-item-renderer',
    'ytd-search-pyv-renderer',
    'ytd-promoted-video-renderer',
    'ytd-promoted-sparkles-text-search-renderer',
    'ytd-ad-slot-renderer',
    'ytd-in-feed-ad-layout-renderer',
    'ytd-companion-slot-renderer',
    'ytmusic-mealbar-promo-renderer',
    'ytmusic-statement-banner-renderer',
    'ytmusic-display-ad-renderer',
    '.ytmusic-paid-content-overlay-renderer',
    '[ad-joining-count]',
    '.ytmusic-player-bar[ad-playing]',
  ];

  let _overlayLogThrottle = 0;
  const _overlaySel = OVERLAY_SELS.join(',');
  function removeOverlays() {
    let removed = 0;
    try {
      document.querySelectorAll(_overlaySel).forEach(el => { try { el.remove(); removed++; } catch (_) {} });
    } catch (_) {}
    if (removed > 0 && Date.now() - _overlayLogThrottle > 5000) {
      _overlayLogThrottle = Date.now();
      _sbLog('info', `Removed ${removed} ad overlay element(s)`);
    }
  }

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

  let _popupLogThrottle = 0;
  let _playbackRecovery = false;
  let _recoveryLogged = false;

  function hasPlayerError282() {
    try {
      if (document.body?.innerText?.includes(YT_PLAYER_ERR)) return true;
      const errEl = document.querySelector(
        'ytd-player-error-message-renderer, .ytp-error, #player-error, [class*="error-message"]'
      );
      return errEl && (errEl.textContent || '').includes(YT_PLAYER_ERR);
    } catch (_) { return false; }
  }

  function enterPlaybackRecovery() {
    if (_playbackRecovery) return;
    _playbackRecovery = true;
    _blockingActive = false;
    if (_armTimer) { clearTimeout(_armTimer); _armTimer = null; }
    try { sessionStorage.setItem('__sbYtRecovery', '1'); } catch (_) {}
    try { localStorage.setItem('__sbYtOff', '1'); } catch (_) {}
    window.postMessage({ type: 'SB_YOUTUBE_DISABLE' }, '*');
    _restoreAudio();
    if (!_recoveryLogged) {
      _recoveryLogged = true;
      _sbLog('error',
        `YouTube error ${YT_PLAYER_ERR} — ad blocking paused on this tab. Hard-refresh to retry.`,
        { code: YT_PLAYER_ERR });
    }
    const retry = document.querySelector(
      'ytd-button-renderer button, .ytp-error-retry, button[aria-label*="Retry"], button[aria-label*="retry"]'
    );
    try { retry?.click(); } catch (_) {}
  }

  function dismissAdblockPopup() {
    if (_playbackRecovery || hasPlayerError282()) {
      if (hasPlayerError282()) enterPlaybackRecovery();
      return;
    }
    const enforcement = document.querySelector(
      'ytd-enforcement-message-view-model, .ytd-enforcement-message-view-model'
    );
    if (!enforcement) return;
    const dialog = enforcement.closest('tp-yt-paper-dialog');
    try { (dialog || enforcement).remove(); } catch (_) {}
    try {
      document.documentElement.style.removeProperty('overflow');
      if (document.body) document.body.style.removeProperty('overflow');
    } catch (_) {}
    const vid = document.querySelector('video');
    try { if (vid && vid.paused) vid.play().catch(() => {}); } catch (_) {}
    if (Date.now() - _popupLogThrottle > 5000) {
      _popupLogThrottle = Date.now();
      _sbLog('warn', 'Anti-adblock popup dismissed — playback resumed');
    }
  }

  function tick() {
    if (hasPlayerError282()) { enterPlaybackRecovery(); return; }
    if (_playbackRecovery) return;
    if (!_blockingActive) return;

    if (_feedOnly) {
      removeOverlays();
      handleYTMusicAd();
      return;
    }

    handleAd();
    removeOverlays();
    handleYTMusicAd();
    dismissAdblockPopup();
  }

  const _tickInterval = setInterval(tick, 750);

  let _lastSkipClick = 0;
  const _skipObserver = new MutationObserver(() => {
    if (!_blockingActive || _feedOnly) return;
    if (Date.now() - _lastSkipClick < 1000) return;
    const skip = document.querySelector(
      '.ytp-ad-skip-button, .ytp-skip-ad-button, .ytp-ad-skip-button-modern'
    );
    if (skip) { skip.click(); _lastSkipClick = Date.now(); _sbLog('info', 'Ad: skip button clicked'); }
    if (_blockingActive && !_feedOnly) dismissAdblockPopup();
  });
  _skipObserver.observe(document.documentElement, { childList: true, subtree: true });

  let _wasAd = false;
  const _statInterval = setInterval(() => {
    if (!_blockingActive || _feedOnly) return;
    const ad = isAdPlaying();
    if (ad && !_wasAd) {
      chrome.runtime.sendMessage({ type: 'INCREMENT_STAT', statType: 'youtube' }).catch(() => {});
    }
    _wasAd = ad;
  }, 1000);

  function _cleanup() {
    clearInterval(_tickInterval);
    clearInterval(_statInterval);
    _skipObserver.disconnect();
    if (_armTimer) clearTimeout(_armTimer);
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
    try { localStorage.setItem('__sbYtOff', '1'); } catch (_) {}
    window.postMessage({ type: 'SB_YOUTUBE_DISABLE' }, '*');
  }

  window.addEventListener('beforeunload', _cleanup, { once: true });

  let _liveYtOff = false, _livePaused = false, _liveWl = false;
  chrome.storage.onChanged.addListener((changes) => {
    let relevant = false;
    if (changes.settings)    { _liveYtOff = !changes.settings.newValue?.youtube; relevant = true; }
    if (changes.globalPause) {
      const gp = changes.globalPause.newValue;
      _livePaused = !!(gp && gp.until > Date.now());
      relevant = true;
    }
    if (changes.whitelist) {
      const nwl = changes.whitelist.newValue;
      _liveWl = Array.isArray(nwl) && nwl.some(d => _host === d || _host.endsWith('.' + d));
      relevant = true;
    }
    if (!relevant) return;
    const nowDisabled = _liveYtOff || _livePaused || _liveWl;
    try { localStorage.setItem('__sbYtOff', nowDisabled ? '1' : '0'); } catch (_) {}
    if (!nowDisabled) {
      try { sessionStorage.removeItem('__sbYtRecovery'); } catch (_) {}
      watchForPlayback();
      return;
    }
    _disableNow();
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
