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
        if (el.children.length === 0 && /^\s*(ad\s+\d|\d+\s*s(ec)?)\s*$/i.test(el.textContent)) return true;
      }
    }
    return false;
  }

  function removeAdUI() {
    for (const sel of AD_SELECTORS) {
      try { document.querySelectorAll(sel).forEach(el => el.remove()); } catch (_) {}
    }
  }

  let adActive = false;
  let wasMuted = false;
  let _adStartTime = 0;

  function tick() {
    const hasAd = isAdPlaying();
    removeAdUI();

    if (hasAd && !adActive) {
      adActive = true;
      _adStartTime = Date.now();
      const video = document.querySelector('video');
      if (video) { wasMuted = video.muted; video.muted = true; }
      chrome.runtime.sendMessage({ type: 'INCREMENT_STAT', statType: 'kick' }).catch(() => {});
      _sbLog('info', 'Ad start — video muted (SSAI stream)', { channel: location.pathname.replace('/', '') });
    } else if (hasAd && adActive) {
      // Ad still playing — re-enforce mute in case the player unmuted itself
      const video = document.querySelector('video');
      if (video && !video.muted) video.muted = true;
    } else if (!hasAd && adActive) {
      const dur = `${((Date.now() - _adStartTime) / 1000).toFixed(1)}s`;
      adActive = false;
      const video = document.querySelector('video');
      if (video) video.muted = wasMuted;
      _sbLog('info', `Ad end — audio restored, duration ${dur}`);
    }
  }

  // ── Safety timeout: force-recover if muted for > 90s ─────────────────────────
  let _safetyInt = setInterval(() => {
    if (adActive && Date.now() - _adStartTime > 90000) {
      adActive = false;
      const video = document.querySelector('video');
      if (video) video.muted = wasMuted;
      _sbLog('warn', 'Safety timeout: forced ad recovery after 90s');
    }
  }, 5000);

  let _kickDeb = null;
  const _kickObs = new MutationObserver(() => { clearTimeout(_kickDeb); _kickDeb = setTimeout(tick, 300); });
  _kickObs.observe(document.body || document.documentElement, { childList: true, subtree: true });
  let _kickInt = setInterval(tick, 1000);

  window.addEventListener('beforeunload', () => {
    _kickObs.disconnect(); clearInterval(_kickInt); clearInterval(_safetyInt); clearTimeout(_kickDeb);
  }, { once: true });

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.settings?.newValue?.kick === false) {
      _kickObs.disconnect();
      clearInterval(_kickInt);
      clearInterval(_safetyInt);
      clearTimeout(_kickDeb);
      if (adActive) {
        const video = document.querySelector('video');
        if (video) video.muted = wasMuted;
        adActive = false;
      }
      removeAdUI();
    } else if (changes.settings?.newValue?.kick === true &&
               changes.settings?.oldValue?.kick === false) {
      _kickObs.observe(document.body || document.documentElement, { childList: true, subtree: true });
      _kickInt   = setInterval(tick, 1000);
      _safetyInt = setInterval(() => {
        if (adActive && Date.now() - _adStartTime > 90000) {
          adActive = false;
          const video = document.querySelector('video');
          if (video) video.muted = wasMuted;
          _sbLog('warn', 'Safety timeout: forced ad recovery after 90s');
        }
      }, 5000);
      tick();
    }
  });

  tick();
})().catch(e => {
  try { chrome.runtime.sendMessage({ type: 'LOG_EVENT', source: 'kick', level: 'error', message: `Script error: ${e?.message ?? e}`, data: {} }).catch(() => {}); } catch (_) {}
  console.warn('[SB:kick] script error:', e?.message ?? e);
});
