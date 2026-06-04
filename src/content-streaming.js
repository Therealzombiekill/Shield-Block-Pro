/**
 * ShieldBlock Pro — Additional Streaming Platforms (SSAI)
 *
 * Max, Disney+, Paramount+, Peacock, Pluto TV and Tubi use Server-Side Ad
 * Insertion: ads are stitched into the same stream as the content, so they can't
 * be dropped at the network layer (see CLAUDE.md → "SSAI streaming platforms").
 * The realistic, playback-safe strategy — like content-hulu.js / content-kick.js —
 * is to MUTE the <video> for the duration of a detected ad break and restore the
 * original mute state afterwards. We intentionally do NOT remove player DOM: these
 * are unfamiliar players we can't test, and muting alone delivers the core win
 * without any risk of breaking the UI or detection.
 *
 * Detection is deliberately conservative — if nothing matches we do NOTHING, so a
 * missed selector never wrongly mutes real content. Toggle: settings.streaming.
 * Stat bucket: 'streaming'.
 */

(async () => {
  function _sbLog(level, message, data) {
    chrome.runtime.sendMessage({ type: 'LOG_EVENT', source: 'streaming', level, message, data: data ?? {} }).catch(() => {});
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
  if (!settings?.streaming) return;
  const _host = location.hostname.replace(/^www\./, '');
  const _wl = settings?.whitelist ?? [];
  if (_wl.some(d => _host === d || _host.endsWith('.' + d))) return;

  // ── Per-platform ad markers ─────────────────────────────────────────────────
  // Best-effort selectors that indicate an ad is active. Vendors rename classes
  // often, so a player-scoped "Ad…" text detector (below) is the durable fallback.
  const PLATFORMS = {
    'max.com':            ['[data-testid*="ad-control" i]', '[class*="AdsControls"]', '[class*="ad-countdown" i]', '[aria-label*="Advertisement" i]'],
    'disneyplus.com':     ['[data-testid="ad-badge"]', '[class*="adBadge"]', '[class*="ad-badge" i]', '[data-gv2containername*="ad_" i]'],
    'paramountplus.com':  ['.ad-ui', '[class*="ad-overlay" i]', '[data-ui-tracking*="ad" i]', '.skin-ad'],
    'peacocktv.com':      ['[data-testid*="ad-" i]', '.ad-marker', '[class*="adCountdown"]', '[class*="ad-indicator" i]'],
    'pluto.tv':           ['[data-testid*="ad-break" i]', '[class*="ad-grace"]', '[class*="adBreak"]', '[class*="ad-indicator" i]'],
    'tubitv.com':         ['[data-testid*="ad-" i]', '[class*="adBadge"]', '[class*="ad-count" i]', '.ad-overlay'],
  };

  let _key = null, _selectors = null;
  for (const key of Object.keys(PLATFORMS)) {
    if (_host === key || _host.endsWith('.' + key)) { _key = key; _selectors = PLATFORMS[key]; break; }
  }
  if (!_key) return; // not one of our platforms (manifest already scopes matches)
  const _adSel = _selectors.join(',');

  // Matches a leaf label that STARTS with the word "ad"/"advertisement" — e.g.
  // "Ad", "Ad 1 of 3", "Advertisement", "Ad · 0:15". The \b after the optional
  // "vertisement" means it never matches "Add…", and it never matches a bare
  // "0:15" timer (which is the normal playback clock — matching that would mute
  // real content).
  const AD_TEXT_RE = /^\s*ad(vertisement)?\b/i;

  function isAdPlaying() {
    try { if (document.querySelector(_adSel)) return true; } catch (_) {}
    const video = document.querySelector('video');
    if (!video) return false;
    const player = video.closest('[class*="player" i], [class*="Player"], [data-testid*="player" i]');
    if (!player) return false; // no player scope → don't risk a page-wide text scan
    let scanned = 0;
    for (const el of player.querySelectorAll('span, div, p')) {
      if (el.children.length !== 0) continue;     // leaf nodes only
      if (++scanned > 300) break;                  // bound the scan on huge DOMs
      if (AD_TEXT_RE.test(el.textContent)) return true;
    }
    return false;
  }

  let adActive = false;
  let wasMuted = false;
  let _adStart = 0;

  function tick() {
    if (globalThis.__sbGlobalPause) return;
    const video = document.querySelector('video');
    const hasAd = isAdPlaying();

    if (hasAd && !adActive) {
      adActive = true;
      _adStart = Date.now();
      if (video) { wasMuted = video.muted; video.muted = true; }
      chrome.runtime.sendMessage({ type: 'INCREMENT_STAT', statType: 'streaming' }).catch(() => {});
      _sbLog('info', `Ad start — muted (SSAI)`, { platform: _key });
    } else if (!hasAd && adActive) {
      const dur = `${((Date.now() - _adStart) / 1000).toFixed(1)}s`;
      adActive = false;
      if (video) video.muted = wasMuted;
      _sbLog('info', `Ad end — audio restored, duration ${dur}`, { platform: _key });
    }
  }

  let _deb = null;
  const _obs = new MutationObserver(() => { clearTimeout(_deb); _deb = setTimeout(tick, 300); });
  _obs.observe(document.body || document.documentElement, { childList: true, subtree: true });
  const _int = setInterval(tick, 1000);

  function stopStreamingBlocking() {
    _obs.disconnect();
    clearInterval(_int);
    clearTimeout(_deb);
    if (adActive) {
      const video = document.querySelector('video');
      if (video) video.muted = wasMuted;
      adActive = false;
    }
  }

  window.addEventListener('beforeunload', stopStreamingBlocking, { once: true });

  chrome.storage.onChanged.addListener((changes) => {
    const wl = changes.whitelist?.newValue;
    const isWhitelisted = Array.isArray(wl) && wl.some(d => _host === d || _host.endsWith('.' + d));
    const paused = changes.globalPause?.newValue && changes.globalPause.newValue.until > Date.now();
    if (changes.settings?.newValue?.streaming === false || isWhitelisted || paused) stopStreamingBlocking();
  });
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'GLOBAL_PAUSE') stopStreamingBlocking();
    if (message?.type === 'WHITELIST_CHANGED') {
      const wl = message.whitelist ?? [];
      if (wl.some(d => _host === d || _host.endsWith('.' + d))) stopStreamingBlocking();
    }
  });

  _sbLog('info', `Init — ${_host}`, { platform: _key });
  tick();
})().catch(e => {
  try { chrome.runtime.sendMessage({ type: 'LOG_EVENT', source: 'streaming', level: 'error', message: `Script error: ${e?.message ?? e}`, data: {} }).catch(() => {}); } catch (_) {}
  console.warn('[SB:streaming] script error:', e?.message ?? e);
});
