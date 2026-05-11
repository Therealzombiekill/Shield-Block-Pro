/**
 * ShieldBlock Pro — Soft Paywall Bypass v1.0
 * Opt-in (disabled by default — users may have paid subscriptions).
 *
 * Targets CSS-overlay paywalls that blur/restrict article content.
 * Does NOT affect server-side paywalls (content simply isn't served).
 *
 * Strategy:
 *   1. Remove known paywall overlay elements
 *   2. Remove blur/mask/height CSS from article content
 *   3. Restore scroll locks
 *   4. MutationObserver for dynamic injection
 */

(async () => {
  if (!location.href.startsWith('http')) return;

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
  if (!settings?.paywall) return; // opt-in only
  if (settings?.globalPause) return;

  const host = location.hostname.replace(/^www\./, '');
  const _wl  = settings?.whitelist ?? [];
  if (_wl.some(d => host === d || host.endsWith('.' + d))) return;

  // ── Known paywall overlay selectors ───────────────────────────────────────
  const PAYWALL_SELECTORS = [
    // Piano Media (used by hundreds of publishers)
    '.tp-container-inner', '.tp-backdrop', '.tpd-content-lockup',
    '.tp-modal', '[class*="tp-container"]', '[id*="piano-"]',
    // Zuora / MPP Global
    '#paywall', '.paywall-container', '.paywall-overlay',
    // Leaky Paywall (WordPress)
    '.leaky_paywall_message', '#leaky_paywall_message',
    // Pico
    '.pico-overlay', '.pico-dialog',
    // Poool
    '.poool-widget', '#poool-widget',
    // Pelcro
    '.pelcro-ui-overlay',
    // Accesstype
    '.access-type-paywall', '.at-paywall',
    // Scroll platform
    '[class*="scroll-paywall"]', '[id*="scroll-paywall"]',
    // Generic patterns (broad but targeted)
    '[class*="paywall"]', '[id*="paywall"]',
    '[class*="subscription-wall"]', '[id*="subscription-wall"]',
    '[class*="premium-wall"]', '[id*="premium-wall"]',
    '[class*="paid-wall"]', '[id*="paid-wall"]',
    '[class*="content-gate"]', '[id*="content-gate"]',
    '[class*="meter-wall"]', '[id*="meter-wall"]',
    '[class*="regwall"]', '[id*="regwall"]',
    '[class*="article-gate"]', '[id*="article-gate"]',
    // Blur-based overlays on article containers
    '[class*="article-blur"]', '[class*="content-blur"]',
    '[class*="fade-out"]', '[class*="article-fade"]',
  ].join(',');

  // Selectors for the actual article content that gets blurred/restricted
  const CONTENT_SELECTORS = [
    'article', '[class*="article-body"]', '[class*="article-content"]',
    '[class*="story-body"]', '[class*="story-content"]',
    '[class*="post-body"]', '[class*="post-content"]',
    '[class*="entry-content"]', '[class*="entry-body"]',
    '[itemprop="articleBody"]', '[data-testid*="article"]',
    '.article__body', '.article-text', '.article-detail',
    '.story__body', '.content__article-body',
    '.paywall-content', '.subscriber-only',
  ].join(',');

  function unlockContent() {
    // 1. Remove overlay elements
    try {
      document.querySelectorAll(PAYWALL_SELECTORS).forEach(el => {
        // Safety: only remove elements that look like overlays, not actual content
        if (el.childElementCount > 50) return; // too much content — likely a false positive
        const cs = window.getComputedStyle(el);
        const isOverlay = cs.position === 'fixed' || cs.position === 'absolute' ||
                          el.className?.toString().includes('overlay') ||
                          el.className?.toString().includes('gate') ||
                          el.className?.toString().includes('wall');
        if (isOverlay || !el.textContent?.trim() || el.textContent.trim().length < 200) {
          el.remove();
        }
      });
    } catch (_) {}

    // 2. Remove blur, mask, and height restrictions from article content
    try {
      document.querySelectorAll(CONTENT_SELECTORS).forEach(el => {
        const cs = window.getComputedStyle(el);
        const hasBlur   = cs.filter?.includes('blur') || cs.webkitFilter?.includes('blur');
        const hasMask   = cs.webkitMaskImage && cs.webkitMaskImage !== 'none';
        const hasMaxH   = cs.maxHeight && cs.maxHeight !== 'none' && parseInt(cs.maxHeight) < 1200;
        const hasOverH  = cs.overflow === 'hidden' && parseInt(cs.maxHeight) < 1200;

        if (hasBlur)  { el.style.filter = 'none'; el.style.webkitFilter = 'none'; }
        if (hasMask)  { el.style.webkitMaskImage = 'none'; el.style.maskImage = 'none'; }
        if (hasMaxH)  { el.style.maxHeight = 'none'; }
        if (hasOverH) { el.style.overflow = 'visible'; }
      });
    } catch (_) {}

    // 3. Restore scroll locks
    try {
      if (document.fullscreenElement) return;
      const activeDialog = document.querySelector('[role="dialog"]:not([aria-hidden="true"])');
      if (activeDialog) return; // real modal open — don't unlock scroll
      for (const el of [document.documentElement, document.body]) {
        if (!el) continue;
        const cs = window.getComputedStyle(el);
        if (cs.overflow === 'hidden' || cs.overflowY === 'hidden') {
          el.style.overflow = ''; el.style.overflowY = '';
        }
        if (cs.position === 'fixed' && parseFloat(cs.top) < 0) {
          const top = Math.abs(parseFloat(cs.top));
          el.style.position = ''; el.style.top = '';
          window.scrollTo(0, top);
        }
      }
    } catch (_) {}
  }

  // Run immediately and after DOM loads
  unlockContent();
  document.addEventListener('DOMContentLoaded', unlockContent);
  window.addEventListener('load', unlockContent);

  // Watch for dynamically injected paywalls
  let _pwDeb = null;
  new MutationObserver((muts) => {
    if (muts.every(m => m.type === 'characterData')) return;
    clearTimeout(_pwDeb);
    _pwDeb = setTimeout(unlockContent, 400);
  }).observe(document.documentElement, { childList: true, subtree: true });

})().catch(e => console.warn('[SB:paywall] script error:', e?.message ?? e));
