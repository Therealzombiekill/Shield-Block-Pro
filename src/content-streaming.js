/**
 * ShieldBlock Pro — Additional Streaming Platforms (SSAI)
 *
 * Max, Disney+, Paramount+, Peacock, Pluto TV, Tubi, the Roku Channel, Sling,
 * Fubo, Crackle, Discovery+, Plex, Xumo and Vudu use Server-Side Ad Insertion:
 * ads are stitched into the same stream as the content, so they can't be dropped
 * at the network layer (see CLAUDE.md → "SSAI streaming platforms"). The realistic,
 * playback-safe strategy — like content-hulu.js / content-kick.js — is to MUTE the
 * <video> for a detected ad break and restore the original mute state afterwards.
 * Mute-only: no DOM removal, so we can never break the UI on players we can't test.
 *
 * Detection is deliberately CONSERVATIVE because a false positive = muting real
 * content for the whole session. We therefore avoid substring selectors like
 * [class*="ad-"] (which also match "load-more", "thread-…", "upload-…", etc.) and
 * use exact-token class selectors + only-distinctive substrings, plus a tightly
 * anchored player-scoped "Ad" text detector. If nothing matches we do NOTHING.
 *
 * Toggle: settings.streaming. Stat bucket: 'streaming'.
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

  // Friendly platform name (for logging). Manifest already scopes which hosts run.
  const HOSTS = {
    'max.com': 'Max', 'disneyplus.com': 'Disney+', 'paramountplus.com': 'Paramount+',
    'peacocktv.com': 'Peacock', 'pluto.tv': 'Pluto TV', 'tubitv.com': 'Tubi',
    'roku.com': 'Roku Channel', 'sling.com': 'Sling', 'fubo.tv': 'Fubo',
    'crackle.com': 'Crackle', 'discoveryplus.com': 'Discovery+', 'plex.tv': 'Plex',
    'xumo.com': 'Xumo', 'vudu.com': 'Vudu',
  };
  let _name = _host;
  for (const key of Object.keys(HOSTS)) {
    if (_host === key || _host.endsWith('.' + key)) { _name = HOSTS[key]; break; }
  }

  // ── Ad markers (SHARED, safe across all platforms) ──────────────────────────
  // Exact-token class selectors do CSS token matching, so ".ad-badge" matches an
  // element whose class list contains exactly "ad-badge" — it can NOT hide inside
  // "thread-badge"/"load-badge" the way [class*="ad-badge"] would. The substring
  // selectors are limited to "advertisement"/"AdsControls", which appear in no
  // ordinary word, plus exact data-testids.
  const AD_SEL = [
    '.ad-badge', '.ad-marker', '.ad-overlay', '.ad-countdown', '.ad-indicator',
    '.ad-ui', '.ad-grace', '.ad-break', '.ad-banner', '.ad-active', '.skin-ad',
    '.preroll', '.pre-roll', '.ad-slate',
    '[class*="advertisement" i]', '[aria-label*="advertisement" i]',
    '[aria-label*="ad break" i]', '[class*="AdsControls"]',
    '[data-testid="ad-badge"]', '[data-testid="ad-countdown"]', '[data-testid="ad-overlay"]',
  ].join(',');

  // Whole-label match only — anchored with $ so it matches an ad indicator that is
  // the ENTIRE label ("Ad", "Advertisement", "Ad 1 of 3", "Ad · 0:15", "Ad: 15s",
  // "Ad break", plus the localized words below), but NOT "Ad-free", "Ad info",
  // "AdChoices", "Ad feedback" (trailing words) nor a bare "0:15" timer. The
  // localized terms are distinctive whole words, so anchoring keeps false positives
  // near zero while covering non-English ad UIs on these global platforms.
  const AD_WORDS = 'ad|advertisement|werbung|publicité|publicidad|anuncio|anúncio|' +
    'pubblicità|reklama|reklam|реклама|広告|광고|广告|廣告|διαφήμιση|reclame|annons|annonce|mainos';
  const AD_TEXT_RE = new RegExp(
    `^\\s*(${AD_WORDS})(\\s*[·:]?\\s*(\\d+(\\s*of\\s*\\d+)?|\\d+:\\d{2}|\\d+\\s*s(ec)?|break))?\\s*$`, 'i');

  function isAdPlaying() {
    try { if (document.querySelector(AD_SEL)) return true; } catch (_) {}
    const video = document.querySelector('video');
    if (!video) return false;
    const player = video.closest('[class*="player" i], [class*="Player"], [data-testid*="player" i]');
    if (!player) return false; // no player scope → don't risk a page-wide text scan
    let scanned = 0;
    for (const el of player.querySelectorAll('span, div, p')) {
      if (el.children.length !== 0) continue;      // leaf nodes only
      if (++scanned > 300) break;                   // bound the scan on huge DOMs
      if (el.closest('a, button')) continue;        // skip "AdChoices"/"Ad info" disclosure links
      if (AD_TEXT_RE.test(el.textContent)) return true;
    }
    return false;
  }

  let adActive = false;
  let wasMuted = false;
  let _adVideo = null;   // the exact <video> we muted, so SPA element swaps don't strand it
  let _adStart = 0;

  function _restore() {
    // Restore the element we actually muted; the player may have swapped <video>
    if (_adVideo && _adVideo.isConnected) _adVideo.muted = wasMuted;
    else { const v = document.querySelector('video'); if (v) v.muted = wasMuted; }
    _adVideo = null;
  }

  function tick() {
    if (globalThis.__sbGlobalPause) return;
    const hasAd = isAdPlaying();

    if (hasAd && !adActive) {
      adActive = true;
      _adStart = Date.now();
      const video = document.querySelector('video');
      if (video) { wasMuted = video.muted; video.muted = true; _adVideo = video; }
      chrome.runtime.sendMessage({ type: 'INCREMENT_STAT', statType: 'streaming' }).catch(() => {});
      _sbLog('info', `Ad start — muted (SSAI)`, { platform: _name });
    } else if (!hasAd && adActive) {
      const dur = `${((Date.now() - _adStart) / 1000).toFixed(1)}s`;
      adActive = false;
      _restore();
      _sbLog('info', `Ad end — audio restored, duration ${dur}`, { platform: _name });
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
    if (adActive) { _restore(); adActive = false; }
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

  _sbLog('info', `Init — ${_host}`, { platform: _name });
  tick();
})().catch(e => {
  try { chrome.runtime.sendMessage({ type: 'LOG_EVENT', source: 'streaming', level: 'error', message: `Script error: ${e?.message ?? e}`, data: {} }).catch(() => {}); } catch (_) {}
  console.warn('[SB:streaming] script error:', e?.message ?? e);
});
