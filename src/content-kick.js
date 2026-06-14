/**
 * ShieldBlock Pro — Kick.com Content Script
 * Kick uses AWS IVS (same live-video.net HLS infrastructure as Twitch).
 * Ads are SSAI-stitched into the stream — we mute during ad breaks and
 * remove ad UI overlays. Same strategy as content-hulu.js.
 */

(async () => {
  // ── Log helper ────────────────────────────────────────────────────────────────
  function _sbLog(level, message, data) {
    chrome.runtime.sendMessage({ type: 'LOG_EVENT', source: 'kick', level, message, data: data ?? {} }).catch(() => {});
  }

  let settings;
  try {
    settings = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
  } catch (_) {
    await new Promise(r => setTimeout(r, 300));
    try { settings = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }); }
    catch (e) { _sbLog('error', `GET_SETTINGS failed after retry: ${e?.message ?? e}`); settings = null; }
  }
  if (settings?.globalPause) return;
  if (!settings?.kick) return;
  const _wl = settings?.whitelist ?? [];
  const _host = location.hostname.replace(/^www\./, '');
  if (_wl.some(d => _host === d || _host.endsWith('.' + d))) return;

  _sbLog('info', `Init — ${_host}`);

  const AD_SELECTORS = [
    '[data-ad-slot]',
    '[class*="advertisement"]',
    '[class*="ad-container"]',
    '[class*="ad-overlay"]',
    '[class*="AdOverlay"]',
    '[class*="preroll"]',
    '[class*="pre-roll"]',
    '[id*="ad-container"]',
  ];

  function isAdPlaying() {
    for (const sel of AD_SELECTORS) {
      if (document.querySelector(sel)) return true;
    }
    // Kick shows a countdown text like "Ad 1 of 2" in the player
    const player = document.querySelector('video')?.closest('div[class*="player"], div[class*="Player"]');
    if (player) {
      const spans = player.querySelectorAll('span, div');
      for (const el of spans) {
        if (el.children.length === 0 && /^\s*(ad(\s+\d+(\s+of\s+\d+)?)?|\d+\s*s(ec)?)\s*$/i.test(el.textContent)) return true;
      }
    }
    return false;
  }

  // NOTE: mute-only (like the other dedicated SSAI handlers). We must NOT remove AD_SELECTORS
  // elements — isAdPlaying() detects the ad break from them, so removing them would
  // make the next tick think the ad ended and unmute while the SSAI ad still plays.

  let adActive = false;
  let wasMuted = false;
  let _adStartTime = 0;
  let _stopped = false;

  function tick() {
    if (_stopped) return;
    const hasAd = isAdPlaying();

    if (hasAd && !adActive) {
      adActive = true;
      _adStartTime = Date.now();
      const video = document.querySelector('video');
      if (video) { wasMuted = video.muted; video.muted = true; }
      chrome.runtime.sendMessage({ type: 'INCREMENT_STAT', statType: 'kick' }).catch(() => {});
      _sbLog('info', 'Ad start — video muted (SSAI stream)', { channel: location.pathname.replace('/', '') });
    } else if (!hasAd && adActive) {
      const dur = `${((Date.now() - _adStartTime) / 1000).toFixed(1)}s`;
      adActive = false;
      const video = document.querySelector('video');
      if (video) video.muted = wasMuted;
      _sbLog('info', `Ad end — audio restored, duration ${dur}`);
    }
  }

  let _deb = null;
  const _obs = new MutationObserver(() => { clearTimeout(_deb); _deb = setTimeout(tick, 300); });
  _obs.observe(document.body || document.documentElement, { childList: true, subtree: true });
  let _int = setInterval(tick, 1000);

  // Safety net: if ad-end detection is missed (the <video> element is swapped or an
  // ad-marker element lingers), audio would stay muted indefinitely. Force-restore
  // after 90s of continuous "ad active" state.
  function _safetyTick() {
    if (adActive && Date.now() - _adStartTime > 90000) {
      adActive = false;
      const video = document.querySelector('video');
      if (video) video.muted = wasMuted;
      _sbLog('warn', 'Safety timeout: forced ad recovery after 90s');
    }
  }
  let _safety = setInterval(_safetyTick, 5000);

  window.addEventListener('beforeunload', () => {
    _obs.disconnect(); clearInterval(_int); clearInterval(_safety); clearTimeout(_deb);
  }, { once: true });

  function stopKickBlocking() {
    if (_stopped) return;
    _stopped = true;
    _obs.disconnect();
    clearInterval(_int);
    clearInterval(_safety);
    clearTimeout(_deb);
    if (adActive) {
      const video = document.querySelector('video');
      if (video) video.muted = wasMuted;
      adActive = false;
    }
  }

  function startKickBlocking() {
    if (!_stopped) return; // already running — idempotent
    _stopped = false;
    _obs.disconnect();
    _obs.observe(document.body || document.documentElement, { childList: true, subtree: true });
    clearInterval(_int);
    _int = setInterval(tick, 1000);
    clearInterval(_safety);
    _safety = setInterval(_safetyTick, 5000);
    tick();
  }

  // Single source of truth for whether blocking should be active. Re-evaluated on
  // every relevant settings / whitelist / pause change so toggling the feature back
  // on, removing the site from the whitelist, or a pause expiring all RE-ARM blocking
  // without a page reload — previously these paths only ever stopped, never restarted.
  let _featureOn = true, _whitelisted = false, _paused = false;
  function _applyState() {
    if (_featureOn && !_whitelisted && !_paused) startKickBlocking();
    else stopKickBlocking();
  }
  chrome.storage.onChanged.addListener((changes) => {
    let touched = false;
    if (changes.settings)    { _featureOn = changes.settings.newValue?.kick !== false; touched = true; }
    if (changes.whitelist)   {
      const wl = changes.whitelist.newValue ?? [];
      _whitelisted = Array.isArray(wl) && wl.some(d => _host === d || _host.endsWith('.' + d));
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
      _whitelisted = wl.some(d => _host === d || _host.endsWith('.' + d));
      _applyState();
    }
  });

  tick();
})().catch(e => {
  try { chrome.runtime.sendMessage({ type: 'LOG_EVENT', source: 'kick', level: 'error', message: `Script error: ${e?.message ?? e}`, data: {} }).catch(() => {}); } catch (_) {}
  console.warn('[SB:kick] script error:', e?.message ?? e);
});
