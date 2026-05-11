/**
 * ShieldBlock Pro — Twitch Content Script v2.3 (ISOLATED world)
 *
 * BEHAVIOUR CHANGE v2.3:
 * No more full-screen black overlay. Just mutes the video + shows a small
 * corner toast. The video area stays visible (frozen last frame or muted ad).
 * Much less jarring. Overlay is removed.
 */

(async () => {
  // ── Log helper ────────────────────────────────────────────────────────────────
  function _sbLog(level, message, data) {
    chrome.runtime.sendMessage({ type: 'LOG_EVENT', source: 'twitch', level, message, data: data ?? {} }).catch(() => {});
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
  if (!settings?.twitch) {
    // Signal inject-twitch.js (MAIN world) to skip Worker hooking.
    // Must postMessage before returning — inject-twitch.js is already listening.
    window.postMessage({ type: 'SB_TWITCH_DISABLE' }, '*');
    return;
  }
  // Signal MAIN world that Twitch blocking is active (handles re-enable after toggle)
  window.postMessage({ type: 'SB_TWITCH_ENABLE' }, '*');

  const _hostname = location.hostname.replace(/^www\./, '');
  if (_wl.some(d => _hostname === d || _hostname.endsWith('.' + d))) return;

  _sbLog('info', `Init — ${_hostname}`);

  let adActive          = false;
  let wasMuted          = false;
  let adStartedByWorker = false; // true if worker fired ad start (vs DOM detection)
  let toast = null;
  let toastTimeout = null;

  // ── Small corner toast (NOT a full-screen overlay) ────────────────────────────
  function showToast() {
    clearTimeout(toastTimeout);
    if (toast) return;
    if (!document.body) return;

    toast = document.createElement('div');
    toast.id = '_sb_twitch_toast';
    toast.style.cssText = [
      'position:fixed', 'bottom:72px', 'left:50%',
      'transform:translateX(-50%)',
      'background:rgba(14,14,16,.92)',
      'border:1px solid rgba(145,71,255,.25)',
      'border-radius:6px',
      'padding:8px 16px',
      'z-index:9999999',
      'display:flex', 'align-items:center', 'gap:8px',
      'font-family:system-ui,sans-serif',
      'font-size:12px', 'letter-spacing:.04em',
      'pointer-events:none',
      'box-shadow:0 4px 20px rgba(0,0,0,.5)',
      'transition:opacity .2s',
    ].join(';');
    // Build toast content with safe DOM construction (no innerHTML)
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('width', '14'); svg.setAttribute('height', '14');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('fill', '#9147ff');
    svg.style.flexShrink = '0';
    const path = document.createElementNS(svgNS, 'path');
    path.setAttribute('d', 'M11.6 4.7h1.7v5.1h-1.7zm4.7 0H18v5.1h-1.7zM6 0L1.7 4.3v15.4h5.1V24l4.3-4.3h3.4l8.2-8.2V0H6zm14.6 11.1l-3.4 3.5H13.8l-3 3v-3H6.9V1.7h13.7v9.4z');
    svg.appendChild(path);
    const label = document.createElement('span');
    label.style.color = '#9b9bb0';
    label.textContent = 'Ad muted by ShieldBlock';
    toast.appendChild(svg);
    toast.appendChild(label);
    document.body.appendChild(toast);
  }

  function hideToast() {
    clearTimeout(toastTimeout);
    if (!toast) return;
    toast.style.opacity = '0';
    toastTimeout = setTimeout(() => { toast?.remove(); toast = null; }, 220);
  }

  // ── Video mute/unmute ─────────────────────────────────────────────────────────
  function muteVideo() {
    const video = document.querySelector('video');
    if (!video) return;
    // wasMuted is saved by the caller before adActive is set — don't save here
    // (adActive is already true by the time muteVideo() is called)
    video.muted = true;
  }

  function unmuteVideo() {
    const video = document.querySelector('video');
    if (video) video.muted = wasMuted; // restore to whatever user had before
  }

  // ── Worker events from inject-twitch.js ───────────────────────────────────────
  let adStartTime = 0;

  document.addEventListener('_sb_twitch_ad_start', () => {
    adStartTime = Date.now();
    if (adActive) return;
    // Save muted state BEFORE setting adActive — muteVideo() guards on !adActive
    // to decide whether to save. If adActive is already true, it skips the save.
    const video = document.querySelector('video');
    if (video) wasMuted = video.muted;
    adActive = true;
    adStartedByWorker = true;
    muteVideo();
    showToast();
    sendTwitchStat();
    _sbLog('info', 'Ad start (source: HLS worker)', { channel: location.pathname.replace('/', '') });
  });

  document.addEventListener('_sb_twitch_ad_end', () => {
    if (!adActive) return;
    const dur = adStartTime ? `${((Date.now() - adStartTime) / 1000).toFixed(1)}s` : '?';
    adActive = false;
    adStartedByWorker = false;
    unmuteVideo();
    hideToast();
    _sbLog('info', `Ad end (HLS worker) — duration ${dur}`);
  });

  // ── Remove Twitch's native ad UI elements ─────────────────────────────────────
  const REMOVE_SELECTORS = [
    '[data-test-selector="ad-banner-default-wrapper"]',
    '[data-a-target="video-ad-label"]',
    '[data-a-target="player-overlay-ad-badge"]',
    '[data-a-target="ad-card-component"]',
    '.tw-ad',
    '.player-ad-overlay',
    '[class*="video-player__ad"]',
    // 2025/2026 Twitch ad UI variants
    '[data-test-selector="ad-feedback"]',
    '[data-test-selector="ad-overlay"]',
    '[class*="AdBanner"]',
    '[class*="ad-banner"]',
    '[class*="PreRollCTACard"]',
    '[class*="PlayerAdSkin"]',
    'div[class*="ad-choice"]',
    // Sidebar / home feed promoted items
    '[data-test-selector="ChannelRecommendationCard"]',
    'article[data-a-target*="promoted"]',
  ];

  let _lastTwitchStat = 0;
  function sendTwitchStat() {
    const now = Date.now();
    if (now - _lastTwitchStat < 500) return;
    _lastTwitchStat = now;
    chrome.runtime.sendMessage({ type: 'INCREMENT_STAT', statType: 'twitch' }).catch(() => {});
  }

  function removeAdUI() {
    let removed = 0;
    for (const sel of REMOVE_SELECTORS) {
      try {
        document.querySelectorAll(sel).forEach(el => { el.remove(); removed++; });
      } catch (_e) { _sbLog('warn', `removeAdUI selector error: ${_e?.message ?? _e}`); }
    }
    if (removed > 0) { sendTwitchStat(); _sbLog('info', `Removed ${removed} Twitch ad UI element(s)`); }
  }

  // ── DOM-level ad detection (fallback when worker injection fails) ─────────────
  const AD_TEXT = [
    'Commercial break in progress', 'Commercial break', 'Ad playing',
    'Ad 1 of', 'Ad 2 of', 'Ad 3 of', 'Your video will resume',
    'Thanks for watching this ad',
    'Publicité en cours', 'Pause publicitaire',
    'Anuncio', 'Werbung',
  ];

  function detectAdByDOM() {
    // Only check the player container — not the full page
    const player = document.querySelector(
      '[data-a-target="video-player"], .video-player__container, [data-test-selector="video-player"]'
    );
    if (!player) return false;
    const text = player.textContent || '';
    if (AD_TEXT.some(t => text.includes(t))) return true;
    if (player.querySelector('[data-test-selector="ad-banner-default-wrapper"]')) return true;
    if (player.querySelector('[data-a-target="video-ad-label"]')) return true;
    return false;
  }

  // Track when we last saw the ad via DOM vs worker events
  function domTick() {
    const hasAd = detectAdByDOM();
    removeAdUI();

    if (hasAd && !adActive) {
      const video = document.querySelector('video');
      if (video) wasMuted = video.muted; // save BEFORE adActive = true
      adActive = true;
      adStartedByWorker = false;
      adStartTime = Date.now(); // fix: adStartTime was never set for DOM-detected ads,
      // causing (Date.now() - 0 > 90000) to always be true → safety timeout fired instantly
      muteVideo();
      showToast();
      _sbLog('warn', 'Ad start (source: DOM fallback — HLS worker may not have injected)', { channel: location.pathname.replace('/', '') });
    } else if (!hasAd && adActive && !adStartedByWorker) {
      // DOM says ad is gone AND this wasn't started by a worker event
      // (worker events use _sb_twitch_ad_end to recover, DOM-detected ones recover here)
      const dur = adStartTime ? `${((Date.now() - adStartTime) / 1000).toFixed(1)}s` : '?';
      adActive = false;
      unmuteVideo();
      hideToast();
      _sbLog('info', `Ad end (DOM fallback) — duration ${dur}`);
    }
  }

  // ── Safety timeout: if ad active for > 90s, force-recover ────────────────────
  setInterval(() => {
    if (adActive && Date.now() - adStartTime > 90000) {
      // Ad has been "active" for 90 seconds — something went wrong, recover
      adActive = false;
      unmuteVideo();
      hideToast();
      _sbLog('warn', 'Safety timeout: forced ad recovery after 90s (ad state may be stuck)');
    }
  }, 5000);

  // ── Buffering monitor (vaft-style) ───────────────────────────────────────────
  // Detects frozen/black stream and does a pause+play reset.
  // Checks every 500ms; if position/buffer unchanged for 3 checks (1.5s) → fix.
  // Only runs when NOT in an ad (ad muting already handles that state).
  let _lastPos       = -1;
  let _lastBuf       = -1;
  let _frozenTicks   = 0;
  let _lastFixAt     = 0;
  const _FIX_COOLDOWN = 5000; // minimum ms between successive fixes

  setInterval(() => {
    if (adActive) { _frozenTicks = 0; return; } // ad in progress — skip
    const video = document.querySelector('video');
    if (!video || video.paused || document.hidden) { _frozenTicks = 0; return; }
    // Live streams have Infinity duration — don't bail on that.
    // Bail only if video hasn't started at all (readyState < HAVE_FUTURE_DATA).
    if (video.readyState < 2) return;

    const pos = video.currentTime;
    const buf = video.buffered.length > 0 ? video.buffered.end(video.buffered.length - 1) : 0;

    if (pos === _lastPos && buf === _lastBuf) {
      _frozenTicks++;
      if (_frozenTicks >= 3 && Date.now() - _lastFixAt > _FIX_COOLDOWN) {
        _frozenTicks = 0;
        _lastFixAt   = Date.now();
        // Pause + play — resets the HLS segment fetch loop
        _sbLog('warn', `Stream frozen at ${pos.toFixed(2)}s — triggering pause+play recovery`);
        video.pause();
        setTimeout(() => { try { video.play(); } catch(_) {} }, 150);
      }
    } else {
      _lastPos     = pos;
      _lastBuf     = buf;
      _frozenTicks = 0;
    }
  }, 500);

  // ── Observer + polling ────────────────────────────────────────────────────────
  let debounce = null;
  const observer = new MutationObserver(() => {
    clearTimeout(debounce);
    debounce = setTimeout(domTick, 400);
  });
  observer.observe(document.body ?? document.documentElement, { childList: true, subtree: true });
  const interval = setInterval(domTick, 2000);

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.settings?.newValue?.twitch === false) {
      observer.disconnect();
      clearInterval(interval);
      clearTimeout(debounce);
      clearTimeout(toastTimeout);
      hideToast();
      unmuteVideo();
    }
  });

  domTick();
})().catch(e => {
  try { chrome.runtime.sendMessage({ type: 'LOG_EVENT', source: 'twitch', level: 'error', message: `Script error: ${e?.message ?? e}`, data: {} }).catch(() => {}); } catch (_) {}
  console.warn('[SB:twitch] script error:', e?.message ?? e);
});
