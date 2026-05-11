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
  const _int = setInterval(tick, 1000);

  window.addEventListener('beforeunload', () => {
    _obs.disconnect(); clearInterval(_int); clearTimeout(_deb);
  }, { once: true });

  tick();
})().catch(e => {
  try { chrome.runtime.sendMessage({ type: 'LOG_EVENT', source: 'kick', level: 'error', message: `Script error: ${e?.message ?? e}`, data: {} }).catch(() => {}); } catch (_) {}
  console.warn('[SB:kick] script error:', e?.message ?? e);
});
