/**
 * ShieldBlock Pro — Spotify Web Player v1.1
 *
 * FIX: isAdPlayingByAudio() was checking audio.src which is ALWAYS a blob: URL
 * in Spotify's MSE player. Fixed to detect ads purely through DOM + state.
 * FIX: MutationObserver had attributes:true which fired on EVERY attribute
 * change on ALL elements — extremely noisy. Now only watches childList.
 * FIX: Debounce the tick function.
 */

(async () => {
  // ── Log helper ────────────────────────────────────────────────────────────────
  function _sbLog(level, message, data) {
    chrome.runtime.sendMessage({ type: 'LOG_EVENT', source: 'spotify', level, message, data: data ?? {} }).catch(() => {});
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
  if (!settings?.spotify) return;
  const _hostname = location.hostname.replace(/^www\./, '');
  if (_wl.some(d => _hostname === d || _hostname.endsWith('.' + d))) return;

  _sbLog('info', 'Init — open.spotify.com');


  // ── Ad detection ─────────────────────────────────────────────────────────────
  // Spotify web player ad indicators (DOM-only, MSE means audio.src is always blob:)

  function isAdPlaying() {
    // Method 1: explicit ad label elements
    const AD_SELECTORS = [
      '[data-testid="ad-label"]',
      '[data-testid="advertisement"]',
      '[data-testid="ad-slot"]',
      '[data-testid="ad-view"]',
      '[data-testid="sponsored-playlist"]',
      '[data-testid="ad-break"]',
      '[aria-label*="Advertisement"]',
      '[aria-label*="Sponsored"]',
    ];
    for (const sel of AD_SELECTORS) {
      if (document.querySelector(sel)) return true;
    }

    // Method 2: "Spotify" as artist in now-playing bar (generic audio ad marker)
    const subtitles = document.querySelector('[data-testid="context-item-info-subtitles"]');
    if (subtitles) {
      const links = subtitles.querySelectorAll('a');
      for (const a of links) {
        if (a.textContent.trim() === 'Spotify') return true;
      }
    }

    // Method 3: now-playing title contains "Advertisement"
    const title = document.querySelector('[data-testid="context-item-info-title"]');
    if (title && /advertisement/i.test(title.textContent)) return true;

    // Method 4: Spotify wraps progress bar in an ad-specific container
    // Use data-testid which is more stable than class names
    if (document.querySelector('[data-testid="ad-slot"], [data-testid="ad-view"]')) return true;

    return false;
  }

  // ── Controls ─────────────────────────────────────────────────────────────────

  // Cache audio element — Spotify's audio element persists for the session
  function getAudio() {
    return document.querySelector('audio');
  }

  function muteAudio(muted) {
    const audio = getAudio();
    if (audio) audio.muted = muted;
  }

  function skipToNext() {
    const skipBtn = document.querySelector(
      '[data-testid="control-button-skip-forward"],' +
      'button[aria-label="Next"],button[title="Next"]'
    );
    if (skipBtn && !skipBtn.disabled) { skipBtn.click(); return true; }
    const audio = getAudio();
    if (audio && isFinite(audio.duration) && audio.duration > 0) {
      audio.currentTime = audio.duration - 0.1;
      return true;
    }
    return false;
  }

  function removeSpotifyAdUI() {
    const REMOVE_SELECTORS = [
      '[data-testid="browse-ad-slot"]',
      '[class*="upgrade-button"]:not([style*="display:none"])',
    ];
    for (const sel of REMOVE_SELECTORS) {
      try { document.querySelectorAll(sel).forEach(el => el.remove()); } catch (_) {}
    }
  }

  // ── Overlay ───────────────────────────────────────────────────────────────────

  let overlay = null;

  function showOverlay() {
    if (overlay || !document.body) return;
    overlay = document.createElement('div');
    overlay.id = '_sb_spotify_overlay';
    overlay.style.cssText = 'position:fixed;bottom:90px;left:50%;transform:translateX(-50%);background:rgba(18,18,18,0.95);border:1px solid #282828;border-radius:8px;padding:9px 18px;z-index:999999;display:flex;align-items:center;gap:8px;font-family:CircularSp,Helvetica,Arial,sans-serif;pointer-events:none;box-shadow:0 4px 20px rgba(0,0,0,0.5)';
    const svgNS = 'http://www.w3.org/2000/svg';
    const svgEl = document.createElementNS(svgNS, 'svg');
    svgEl.setAttribute('width', '14'); svgEl.setAttribute('height', '14');
    svgEl.setAttribute('viewBox', '0 0 24 24'); svgEl.setAttribute('fill', '#1db954');
    const pathEl = document.createElementNS(svgNS, 'path');
    pathEl.setAttribute('d', 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z');
    svgEl.appendChild(pathEl);
    const textEl = document.createElement('span');
    textEl.style.cssText = 'color:#fff;font-size:12px';
    textEl.textContent = 'Ad muted';
    overlay.appendChild(svgEl);
    overlay.appendChild(textEl);
    document.body.appendChild(overlay);
  }

  function hideOverlay() {
    overlay?.remove();
    overlay = null;
  }

  // ── Main loop ─────────────────────────────────────────────────────────────────

  let adActive = false;
  let skipAttempts = 0;
  let wasMuted = false;

  function tick() {
    const hasAd = isAdPlaying();
    removeSpotifyAdUI();

    if (hasAd && !adActive) {
      adActive = true;
      skipAttempts = 0;
      const audio = getAudio();
      wasMuted = audio?.muted ?? false;
      muteAudio(true);
      const skipped = skipToNext();
      if (!skipped) showOverlay();
      chrome.runtime.sendMessage({ type: 'INCREMENT_STAT', statType: 'spotify' }).catch(() => {});
      _sbLog('info', skipped ? 'Ad detected — skipped to next track' : 'Ad detected — audio muted (skip unavailable)');

    } else if (hasAd && adActive) {
      muteAudio(true);
      if (skipAttempts < 4) {
        skipAttempts++;
        if (skipToNext()) _sbLog('info', `Ad: skip attempt ${skipAttempts} succeeded`);
      }

    } else if (!hasAd && adActive) {
      adActive = false;
      skipAttempts = 0;
      muteAudio(wasMuted);
      hideOverlay();
      _sbLog('info', 'Ad ended — audio restored');
    }
  }

  // FIX: Only watch childList (not attributes) — much less noisy
  let debounce = null;
  const _spotObserver = new MutationObserver(() => {
    clearTimeout(debounce);
    debounce = setTimeout(tick, 150);
  });
  _spotObserver.observe(document.body || document.documentElement, { childList: true, subtree: true });

  let _spotInterval = setInterval(tick, 1000);
  tick();

  // Cleanup on navigation — prevents observer accumulation on SPA route changes
  window.addEventListener('beforeunload', () => {
    _spotObserver.disconnect();
    clearInterval(_spotInterval);
    clearTimeout(debounce);
  }, { once: true });

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.settings?.newValue?.spotify === false) {
      _spotObserver.disconnect();
      clearInterval(_spotInterval);
      clearTimeout(debounce);
      if (adActive) { muteAudio(wasMuted); hideOverlay(); adActive = false; }
    } else if (changes.settings?.newValue?.spotify === true &&
               changes.settings?.oldValue?.spotify === false) {
      _spotObserver.observe(document.body || document.documentElement, { childList: true, subtree: true });
      _spotInterval = setInterval(tick, 1000);
      tick();
    }
  });

})().catch(e => {
  try { chrome.runtime.sendMessage({ type: 'LOG_EVENT', source: 'spotify', level: 'error', message: `Script error: ${e?.message ?? e}`, data: {} }).catch(() => {}); } catch (_) {}
  console.warn('[SB:spotify] script error:', e?.message ?? e);
});
