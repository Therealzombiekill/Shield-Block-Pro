/**
 * ShieldBlock Pro — General Ad Removal v3.0
 * DOM-level ad removal runs at document_idle. Base cosmetics are injected by the
 * background on navigation when the cosmetic toggle is enabled.
 */

(async () => {
  if (!location.href.startsWith('http://') && !location.href.startsWith('https://')) return;

  // If SW is waking up when this fires, sendMessage throws and the IIFE crashes
  // silently — no ad blocking runs at all. Retry once after 300ms.
  let settings;
  try {
    settings = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
  } catch (_) {
    await new Promise(r => setTimeout(r, 300));
    try { settings = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }); }
    catch (_) { settings = null; }
  }
  const _genWl = settings?.whitelist ?? [];
  if (settings?.globalPause) return; // global pause active — skip all processing

  // Signal inject-privacy.js (MAIN world) to activate timezone spoofing if enabled.
  // Can't read storage in MAIN world, so isolated world posts the signal.
  if (settings?.timezoneSpoof) {
    window.postMessage({ type: 'SB_TIMEZONE_SPOOF', enabled: true }, '*');
  }

  if (!settings?.cosmetic) return;

  const _host = location.hostname.replace(/^www\./, '');
  // Never run on YouTube — our selectors can match player elements and cause black screens
  if (_host.includes('youtube.com') || _host.includes('youtu.be')) return;
  if (_genWl.some(d => _host === d || _host.endsWith('.' + d))) return;

  // ── Ad selectors ────────────────────────────────────────────────────────────
  // Combined into a single string for one querySelectorAll call per tick.
  // safeToRemove() guards against removing legitimate content containers.
  const AD_SELECTORS_LIST = [
    // Google
    '[data-ad-slot]', '[data-ad-client]', '[data-google-query-id]',
    '[id^="div-gpt-ad"]', '[id^="google_ads"]', 'ins.adsbygoogle',
    // Generic
    '#ad-container', '#ad-wrapper', '#ad-banner', '#ad-top',
    '#ad-bottom', '#adbox', '#adFrame', '#adsense', '#dfp-ad',
    '#leaderboard-ad', '#interstitial-ad',
    '.adsbygoogle', '.adsense', '.ad-banner', '.ad-slot', '.ad-unit',
    '.ad-block', '.ad-container', '.ad-wrapper', '.ad-holder',
    '.advertisement', '.advertising', '.advertorial',
    '.banner-ad', '.display-ad', '.native-ad', '.dfp-ad',
    // Taboola / Outbrain
    '#taboola-above', '#taboola-below', '#taboola-stream',
    '.taboola', '.outbrain', '.zergnet', '[id^="taboola-"]',
    // Ad networks
    '.adsbygoogle', '[data-adzerk]', '[class*="adroll"]',
    '[id*="freewheel"]', '.fwplaylist',
    '[id*="teads"]', '[id*="mgid"]',
    '[id*="primis"]', '[class*="primis"]',
    '[id*="revcontent"]', '[class*="revcontent"]',
    '[id*="sharethrough"]', '[class*="sharethrough"]',
    '[class*="mantis-ad"]', '[id*="mantis"]',
    '[class*="setupad"]', '[id*="setupad"]',
    '[class*="adngin"]', '[id*="pw-oas"]',
    '[class*="ezoic-ad"]', '[data-ezoic-ad-id]',
    '[class*="mediavine"]', '[id*="mediavine"]',
    '[class*="adthrive"]', '[class*="raptive"]',
    '#carbonads', '.carbon-wrap', '[id^="carbon-"]',
    '[id*="media_net"]', '[class*="mediaNET"]',
    '[class*="criteo"]', '[id*="criteo"]',
    '[class*="undertone"]', '[class*="bidtellect"]',
    '[class*="triplelift"]', '[class*="nativo"]',
    '[class*="admiral-adblock"]',
    'amp-ad', 'amp-embed', 'amp-sticky-ad',
    // Sticky/anchor ads
    '[class*="sticky-ad"]', '[class*="anchor-ad"]',
    '[class*="floating-ad"]', '[class*="bottom-sticky"]',
    // Sponsored labels
    '.sponsored-content', '.sponsored-post', '.sponsored-link',
    // 2025 ad networks
    '[class*="vidazoo"]', '[id*="vidazoo"]',
    '[class*="connatix"]', '[id*="connatix"]',
    '[id*="adagio-slot"]', '[class*="adagio"]',
    '[class*="outstream-ad"]', '[class*="interstitial-ad"]',
    '.onetrust-pc-dark-filter',
  ];

  // Pre-join for single querySelectorAll — falls back to individual queries on error
  const AD_SEL_COMBINED = AD_SELECTORS_LIST.join(',');

  function safeToRemove(el) {
    if (!el) return false;
    // Never remove semantic content containers
    const tag = (el.tagName || '').toLowerCase();
    if (['article','main','section','p','h1','h2','h3','h4',
         'nav','footer','header','body','html'].includes(tag)) return false;
    // Skip if element has substantial text (likely real content)
    // Use childElementCount first — much faster than textContent
    if (el.childElementCount > 20) return false;
    const text = (el.textContent || '').trim();
    if (text.length > 500) return false;
    return true;
  }

  function cleanAds() {
    let _removed = 0;
    try {
      document.querySelectorAll(AD_SEL_COMBINED).forEach(el => {
        if (safeToRemove(el)) { el.remove(); _removed++; }
      });
      if (_removed > 0) {
        chrome.runtime.sendMessage({ type: 'INCREMENT_STAT', statType: 'general' }).catch(()=>{});
        // Rate-limit logging to once per 5s to avoid flooding background
        const now = Date.now();
        if (!window._sbLastGenLog || now - window._sbLastGenLog > 5000) {
          window._sbLastGenLog = now;
          chrome.runtime.sendMessage({ type: 'LOG_EVENT', source: 'general',
            level: 'info', message: `Removed ${_removed} ad elements`, data: { url: location.hostname } })
            .catch(()=>{});
        }
      }
    } catch (_) {
      // Fallback: one selector at a time if combined throws (malformed entry)
      for (const sel of AD_SELECTORS_LIST) {
        try {
          document.querySelectorAll(sel).forEach(el => {
            if (safeToRemove(el)) el.remove();
          });
        } catch (_e) { console.warn('[SB:general]', _e?.message ?? _e); }
      }
    }
  }

  // ── Newsletter / email popups ────────────────────────────────────────────────
  const NEWSLETTER_SEL = [
    '#klaviyo-popup-dialog', '.klaviyo-close-form', '[data-klaviyo-popup]',
    '.privy-popup', '#privy-container',
    '[class*="optinmonster"]', '[id*="optinmonster"]',
    '#sumo_container', '.sumome-react-wysiwyg',
    '.sleeknote-overlay', '#sleeknote-shadow',
    '[class*="drip-form"]', '[data-convertkit-subscriber-id]',
    '.ju-target-preview', '#justuno-overlay',
    '.pum-overlay', '.pum-container',
    '[class*="newsletter-popup"]', '[id*="newsletter-popup"]',
    '[class*="email-popup"]', '[class*="subscribe-popup"]',
    '[class*="exit-intent"]', '[class*="exit-popup"]',
    '[class*="mailchimp-popup"]', '[id*="mc-embed-popup"]',
  ].join(',');

  function cleanNewsletters() {
    try { document.querySelectorAll(NEWSLETTER_SEL).forEach(el => el.remove()); } catch (_) {}
  }

  // ── Anti-adblock walls ───────────────────────────────────────────────────────
  // Detect "please disable your adblocker" interstitials and remove them.
  // Two strategies: named selectors + text content matching.
  const ANTIBLOCK_SEL = [
    '[class*="adblock-wall"]', '[id*="adblock-wall"]',
    '[class*="adblock-overlay"]', '[id*="adblock-overlay"]',
    '[class*="adblock-notice"]', '[class*="adblock-modal"]',
    '[class*="anti-adblock"]', '[id*="anti-adblock"]',
    '[class*="adblocker-wall"]', '[class*="whitelist-modal"]',
    '#adblock-message', '.adblock-message',
    '.ablock-notification', '#ablock-notification',
  ].join(',');

  const ANTIBLOCK_TEXT = [
    /please\s+(disable|turn\s+off|whitelist)\s+(your\s+)?(ad.?block|advert)/i,
    /ad.?block(er)?\s+(detected|found|enabled)/i,
    /we\s+detected\s+an?\s+ad.?block/i,
    /disable\s+your\s+ad.?block/i,
    /whitelist\s+(our\s+)?site/i,
    /support\s+us\s+by\s+disabling/i,
  ];

  function cleanAntiAdblock() {
    // Named selectors — cheapest, runs first
    try { document.querySelectorAll(ANTIBLOCK_SEL).forEach(el => el.remove()); } catch (_) {}

    // Text matching on fixed/absolute positioned elements.
    // OPTIMISATION: check el.style.position first (reads inline style, no reflow).
    // Only call getComputedStyle() if the inline prefilter passes — this avoids
    // triggering style recalculation for every child of <body>.
    if (!document.body) return;
    for (const el of document.body.children) {
      // Fast prefilter: inline style must mention fixed/absolute/z-index
      const inlineStyle = el.getAttribute('style') || '';
      if (!inlineStyle.includes('fixed') && !inlineStyle.includes('absolute') &&
          !inlineStyle.includes('z-index')) continue;
      // Only now pay for getComputedStyle
      try {
        const pos = window.getComputedStyle(el).position;
        if (pos !== 'fixed' && pos !== 'absolute') continue;
        // Read zIndex separately — avoids constructing the full CSSStyleDeclaration again
        const z = parseInt(el.style.zIndex, 10) || parseInt(window.getComputedStyle(el).zIndex, 10);
        if (!z || z < 1000) continue;
        const text = el.textContent || '';
        if (ANTIBLOCK_TEXT.some(r => r.test(text))) {
          el.remove();
          document.body.style.overflow = '';
          document.documentElement.style.overflow = '';
        }
      } catch (_e) { console.warn('[SB:general]', _e?.message ?? _e); }
    }
  }

  // ── Interstitial / high-z-index ad removal ───────────────────────────────────
  function cleanInterstitials() {
    if (!document.body) return;
    for (const el of document.body.children) {
      // Fast prefilter: inline style must indicate fixed + high z-index
      const inlineStyle = el.getAttribute('style') || '';
      if (!inlineStyle.includes('fixed') && !inlineStyle.includes('z-index')) continue;
      // Quick class/id check before touching computed style
      const cls = ((el.className || '') + ' ' + (el.id || '')).toLowerCase();
      if (!/ad|promo|interstitial|popup|overlay|modal|newsletter|subscribe|sponsor/i.test(cls)) continue;
      try {
        if (window.getComputedStyle(el).position !== 'fixed') continue;
        const z = parseInt(el.style.zIndex, 10) || parseInt(window.getComputedStyle(el).zIndex, 10);
        if (!z || z < 9000) continue;
        el.remove();
      } catch (_e) { console.warn('[SB:general]', _e?.message ?? _e); }
    }
  }

  // ── Scroll unlock ─────────────────────────────────────────────────────────────
  // Some ad scripts lock body scroll. Periodically restore it when no modal is open.
  function unlockScroll() {
    if (document.fullscreenElement) return;
    if (document.querySelector('[role="dialog"]:not([aria-hidden="true"])')) return;
    for (const el of [document.documentElement, document.body]) {
      if (!el) continue;
      if (el.style.overflow === 'hidden' || el.style.overflowY === 'hidden') {
        el.style.overflow = '';
        el.style.overflowY = '';
      }
    }
  }

  // ── Main tick ─────────────────────────────────────────────────────────────────
  // NOTE: Soft paywall bypass is handled by content-paywall.js (separate content
  // script with its own MutationObserver). Do not duplicate it here.
  function tick() {
    cleanAds();
    cleanNewsletters();
    cleanAntiAdblock();
    cleanInterstitials();
    unlockScroll();
  }

  // ── Observer ──────────────────────────────────────────────────────────────────
  let _debounce = null;
  const _target = document.body || document.documentElement;
  const _observer = new MutationObserver((mutations) => {
    // Fast-exit if only text content changed (no new elements to check)
    if (mutations.every(m => m.type === 'characterData')) return;
    clearTimeout(_debounce);
    _debounce = setTimeout(tick, 200);
  });

  if (_target) {
    _observer.observe(_target, { childList: true, subtree: true });
    tick();
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      _observer.observe(document.body, { childList: true, subtree: true });
      tick();
    });
  }

  // Two independent suppression sources — the cosmetic toggle and global pause —
  // tracked separately so re-enabling one doesn't override the other (resuming
  // from pause must not re-arm while cosmetic is still disabled, and vice versa).
  let _cosmeticOff  = false;
  let _globalPaused = false;
  function _startCosmetics() {
    if (_cosmeticOff || _globalPaused) return;
    if (_target) { _observer.observe(_target, { childList: true, subtree: true }); tick(); }
  }
  function _stopCosmetics() {
    _observer.disconnect();
    clearTimeout(_debounce);
  }

  chrome.storage.onChanged.addListener((changes) => {
    if (!changes.settings) return;
    const _v = changes.settings.newValue?.cosmetic;
    if (_v === false)      { _cosmeticOff = true;  _stopCosmetics(); }
    else if (_v === true)  { _cosmeticOff = false; _startCosmetics(); }
  });

  // Handle global pause/resume messages from background
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'GLOBAL_PAUSE')  { _globalPaused = true;  _stopCosmetics(); }
    if (msg.type === 'GLOBAL_RESUME') { _globalPaused = false; _startCosmetics(); }
  });

})().catch(e => console.warn('[SB:general] script error:', e?.message ?? e));
