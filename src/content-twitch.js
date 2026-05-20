/**
 * ShieldBlock Pro — Twitch Content Script (ISOLATED world)
 *
 * Ad detection is DOM-only (inject-twitch.js worker hook was removed —
 * Twitch player updates broke it and caused streams to not load at all).
 *
 * Strategy:
 *   - Poll player container every 1s + MutationObserver for ad text / badges
 *   - Mute video during ad, restore volume after
 *   - Show small corner toast while muted
 *   - Remove Twitch's native ad UI elements
 *   - Buffering recovery: pause+play if stream freezes
 */

(async () => {
  // ── Log helper ────────────────────────────────────────────────────────────────
  function _sbLog(level, message, data) {
    chrome.runtime.sendMessage({ type: 'LOG_EVENT', source: 'twitch', level, message, data: data ?? {} }).catch(() => {});
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
  if (settings?.globalPause) return;

  if (!settings?.twitch) {
    window.postMessage({ type: 'SB_TWITCH_DISABLE' }, '*');
    return;
  }
  window.postMessage({ type: 'SB_TWITCH_ENABLE' }, '*');

  const _hostname = location.hostname.replace(/^www\./, '');
  if (_wl.some(d => _hostname === d || _hostname.endsWith('.' + d))) return;

  _sbLog('info', `Init — ${_hostname}`);

  let adActive     = false;
  let wasMuted     = false;
  let adStartTime  = 0;
  let toast        = null;
  let toastTimeout = null;

  // ── Small corner toast ────────────────────────────────────────────────────────
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
      'border-radius:6px', 'padding:8px 16px',
      'z-index:9999999', 'display:flex', 'align-items:center', 'gap:8px',
      'font-family:system-ui,sans-serif', 'font-size:12px', 'letter-spacing:.04em',
      'pointer-events:none', 'box-shadow:0 4px 20px rgba(0,0,0,.5)',
      'transition:opacity .2s',
    ].join(';');
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
    if (video) video.muted = true;
  }

  function unmuteVideo() {
    const video = document.querySelector('video');
    if (video) video.muted = wasMuted;
  }

  // ── Stat reporting ────────────────────────────────────────────────────────────
  let _lastStat = 0;
  function sendStat() {
    const now = Date.now();
    if (now - _lastStat < 500) return;
    _lastStat = now;
    chrome.runtime.sendMessage({ type: 'INCREMENT_STAT', statType: 'twitch' }).catch(() => {});
  }

  // ── Remove Twitch native ad UI ────────────────────────────────────────────────
  const REMOVE_SELECTORS = [
    '[data-test-selector="ad-banner-default-wrapper"]',
    '[data-a-target="video-ad-label"]',
    '[data-a-target="player-overlay-ad-badge"]',
    '[data-a-target="ad-card-component"]',
    '[data-a-target="video-ad-countdown"]',
    '[data-a-target="video-ad-button"]',
    '[data-a-target="ad-choice-icon"]',
    '[data-a-target="ad-choice-button"]',
    '[data-test-selector="video-ad-label"]',
    '[data-test-selector="ad-feedback"]',
    '[data-test-selector="ad-overlay"]',
    '[data-test-selector="ad-banner"]',
    '.tw-ad', '.player-ad-overlay',
    '[class*="video-player__ad"]',
    '[class*="AdBanner"]', '[class*="ad-banner"]',
    '[class*="PreRollCTACard"]', '[class*="PlayerAdSkin"]',
    'div[class*="ad-choice"]',
    '[data-test-selector="ChannelRecommendationCard"]',
    'article[data-a-target*="promoted"]',
  ];

  function removeAdUI() {
    let removed = 0;
    for (const sel of REMOVE_SELECTORS) {
      try { document.querySelectorAll(sel).forEach(el => { el.remove(); removed++; }); }
      catch (_) {}
    }
    if (removed > 0) { sendStat(); _sbLog('info', `Removed ${removed} Twitch ad UI element(s)`); }
  }

  // ── DOM ad detection ──────────────────────────────────────────────────────────
  const AD_TEXT = [
    'Commercial break in progress', 'Commercial break', 'Ad playing',
    'Ad 1 of', 'Ad 2 of', 'Ad 3 of', 'Your video will resume',
    'Thanks for watching this ad',
    'Publicité en cours', 'Pause publicitaire',
    'Anuncio', 'Werbung',
  ];

  function detectAdByDOM() {
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

  // ── Main tick ─────────────────────────────────────────────────────────────────
  function domTick() {
    const hasAd = detectAdByDOM();
    removeAdUI();

    if (hasAd && !adActive) {
      const video = document.querySelector('video');
      if (video) wasMuted = video.muted;
      adActive    = true;
      adStartTime = Date.now();
      muteVideo();
      showToast();
      sendStat();
      _sbLog('warn', 'Ad start (DOM detection)', { channel: location.pathname.replace('/', '') });
    } else if (!hasAd && adActive) {
      const dur = adStartTime ? `${((Date.now() - adStartTime) / 1000).toFixed(1)}s` : '?';
      adActive = false;
      unmuteVideo();
      hideToast();
      _sbLog('info', `Ad end — duration ${dur}`);
    }
  }

  // ── Safety timeout: force-recover if muted for > 90s ─────────────────────────
  function _safetyCb() {
    if (adActive && Date.now() - adStartTime > 90000) {
      adActive = false;
      unmuteVideo();
      hideToast();
      _sbLog('warn', 'Safety timeout: forced ad recovery after 90s');
    }
  }
  let safetyInterval = setInterval(_safetyCb, 5000);

  // ── Buffering monitor ─────────────────────────────────────────────────────────
  let _lastPos     = -1;
  let _lastBuf     = -1;
  let _frozenTicks = 0;
  let _lastFixAt   = 0;
  const _FIX_COOLDOWN = 5000;

  function _bufferCb() {
    if (adActive) { _frozenTicks = 0; return; }
    const video = document.querySelector('video');
    if (!video || video.paused || document.hidden) { _frozenTicks = 0; _lastPos = -1; _lastBuf = -1; return; }
    if (video.readyState < 2) return;

    const pos = video.currentTime;
    const buf = video.buffered.length > 0 ? video.buffered.end(video.buffered.length - 1) : 0;

    if (pos === _lastPos && buf === _lastBuf) {
      _frozenTicks++;
      if (_frozenTicks >= 3 && Date.now() - _lastFixAt > _FIX_COOLDOWN) {
        _frozenTicks = 0;
        _lastFixAt   = Date.now();
        _sbLog('warn', `Stream frozen at ${pos.toFixed(2)}s — triggering pause+play recovery`);
        video.pause();
        setTimeout(() => { try { video.play(); } catch (_) {} }, 150);
      }
    } else {
      _lastPos     = pos;
      _lastBuf     = buf;
      _frozenTicks = 0;
    }
  }
  let bufferInterval = setInterval(_bufferCb, 500);

  // ── Observer + polling ────────────────────────────────────────────────────────
  let debounce = null;
  const observer = new MutationObserver(() => {
    clearTimeout(debounce);
    debounce = setTimeout(domTick, 300);
  });
  observer.observe(document.body ?? document.documentElement, { childList: true, subtree: true });
  let interval = setInterval(domTick, 1000);

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.settings?.newValue?.twitch === false) {
      observer.disconnect();
      clearInterval(interval);
      clearInterval(safetyInterval);
      clearInterval(bufferInterval);
      clearTimeout(debounce);
      clearTimeout(toastTimeout);
      hideToast();
      unmuteVideo();
    } else if (changes.settings?.newValue?.twitch === true &&
               changes.settings?.oldValue?.twitch === false) {
      window.postMessage({ type: 'SB_TWITCH_ENABLE' }, '*');
      observer.observe(document.body ?? document.documentElement, { childList: true, subtree: true });
      interval        = setInterval(domTick,    1000);
      safetyInterval  = setInterval(_safetyCb,  5000);
      bufferInterval  = setInterval(_bufferCb,   500);
      domTick();
    }
  });

  domTick();
})().catch(e => {
  try { chrome.runtime.sendMessage({ type: 'LOG_EVENT', source: 'twitch', level: 'error', message: `Script error: ${e?.message ?? e}`, data: {} }).catch(() => {}); } catch (_) {}
  console.warn('[SB:twitch] script error:', e?.message ?? e);
});
