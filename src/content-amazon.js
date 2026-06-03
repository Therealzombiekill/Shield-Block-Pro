/**
 * ShieldBlock Pro — Amazon Content Script v2.1
 *
 * FIXES:
 * - BUG FIX: MutationObserver had no debounce — Amazon's dynamic page fired
 *   40+ querySelectorAll calls on every mutation. Now debounced to 300ms.
 * - BUG FIX: Duplicate selector '[data-csa-c-type="ad"]' removed.
 * - BUG FIX: '[data-component-type*="sp-"] [data-asin]' was too broad —
 *   could remove legitimate product content. Replaced with safer selectors.
 */

const _AMAZON_CSS = `
  [data-component-type="sp-sponsored-result"],
  [data-cel-widget*="sp-sponsored"],
  [cel_widget_id*="SPONSORED"],
  [cel_widget_id*="SP_DETAIL"],
  [cel_widget_id*="APEX-SPONSORED"],
  .puis-sponsored-label-text, .a-sponsored-label,
  [aria-label*="Sponsored"] > span,
  .AdHolder, .AdComponent, .amAdDiv,
  [data-csa-c-type="ad"],
  [data-csa-c-rtype="sponsored"],
  [data-csa-c-slot-id],
  [data-ad-details],
  #ape_Detail_dp-ads-center-promo_Desktop_placement,
  #dp-ads-center-promo_Desktop_placement,
  #dp-ads-middle-promo_Desktop_placement,
  #dp-ads-bottom-mobile-shoveler_feature_div,
  #centerBanner-sp-ads_feature_div,
  #apex_dp_detail_page_desktop-sp-ad-below-title_Desktop_placement,
  #ad_plus_anchor_desktop, #banner-ads-slot,
  #desktop_qualifiedBuyers_Desktop_placement,
  #desktop_buybox_desktop_sideSheet,
  [id*="sponsored-products-shelf"],
  [id*="sponsored_products"],
  [id*="sp_detail"], [id*="sp_dp"],
  [id*="ad_feature_div"], [id*="ad-feedback-form"],
  .s-sponsored-header-text,
  [class*="s-sponsored-header"],
  [data-csa-c-content-id*="sp-"],
  #videoAds, #videoAd, [id*="video-ads"],
  #amasBottom, #amsDetailRight_feature_div,
  #amsDetailRight, #rhf, .sopp_theme,
  .a-sponsored-label, [data-ad-details]
  { display:none!important; }
`;

function _injectAmazonCss() {
  if (document.getElementById('_sb_amazon_css')) return;
  const _qs = document.createElement('style');
  _qs.id = '_sb_amazon_css';
  _qs.textContent = _AMAZON_CSS;
  (document.head || document.documentElement).appendChild(_qs);
}

function _removeAmazonCss() {
  document.getElementById('_sb_amazon_css')?.remove();
}

(async () => {
  // Amazon blocking is only for Amazon domains — never run on other sites
  const _hostname = location.hostname.replace(/^www\./, '');
  if (!_hostname.includes('amazon.')) return;

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
  const _wl = settings?.whitelist ?? [];
  if (settings?.globalPause) return; // global pause active — skip all processing
  if (!settings?.amazon) return;
  if (_wl.some(d => _hostname === d || _hostname.endsWith('.' + d))) return;

  _injectAmazonCss();

  const AD_SELECTORS = [
    '[data-component-type="sp-sponsored-result"]',
    '[data-cel-widget*="sp-sponsored"]',
    '.AdHolder', '.puis-sponsored-label-text', '[data-csa-c-type="ad"]',
    '#ape_Detail_dp-ads-center-promo_Desktop_placement',
    '#ad_plus_anchor_desktop', '#banner-ads-slot',
    '#dp-ads-center-promo_Desktop_placement', '#dp-ads-middle-promo_Desktop_placement',
    '#desktop_qualifiedBuyers_Desktop_placement',
    '[id*="sponsored-products-shelf"]', '[id*="sponsored_products"]',
    '[id*="sp_detail"]', '[id*="sp_dp"]',
    '.a-sponsored-label', '#videoAd', '#videoAds', '[id*="video-ads"]',
    '#amsDetailRight_feature_div', '.amAdDiv', '#amasBottom',
    '[data-ad-details]',
    '[data-component-type="s-impression-logger"][data-ad-details]',
    '[class*="s-sponsored-header"]',
    '[data-component-type="s-shopping-adviser-result"]',
    '[id*="sponsored-products-visually"]',
    '[cel_widget_id*="MAIN-SPONSORED_PRODUCTS"]',
    '[cel_widget_id*="MAIN-SP_DETAIL"]',
    '#rhf', '#amsDetailRight',
    '.sopp_theme', '[id*="ad_feature_div"]',
    // 2025 Amazon ad slots
    '[data-csa-c-slot-id]',
    '#centerBanner-sp-ads_feature_div',
    '[class*="s-sponsored-header"]',
    '#sp-cc', '#sp-cc-aboveTheFold',
    // 2025 Amazon ad formats
    '[data-csa-c-rtype="sponsored"]',
    '[cel_widget_id*="BOTTOM_APEX-SPONSORED"]',
    '[data-csa-c-content-id*="sp-"]',
    '#dp-ads-bottom-mobile-shoveler_feature_div',
  ];

  // Pre-join for single querySelectorAll — falls back to individual on error
  const AD_SEL = AD_SELECTORS.join(',');

  // Sponsored label strings across Amazon locales — defined once at module scope
  const AMZN_SPONSORED = new Set([
    'Sponsored', 'Sponsored Brand', 'Sponsored brands',
    'Patrocinado', 'Patrocinada', 'Patrocinados',
    'Gesponsert', 'Gesponserte Marke',
    'Sponsorisé', 'Sponsorisée', 'Marque sponsorisée',
    'Sponsorizzato', 'Sponsorizzata', 'Marca sponsorizzata',
    'Gesponsord', 'Gesponsorde merken',
    'スポンサー', 'スポンサー付き',
    '赞助', '推广', '贊助', '廣告',
    'ممول', 'برعاية',
    'प्रायोजित',
    'Sponsorowane',
    'Sponsrad', 'Sponsrade varumärken',
    'Sponsorlu',
    '광고', '스폰서',
    'Реклама', 'Спонсировано',
    'Patrocinado pela marca',
  ]);

  function clean() {
    let batch = 0;
    // 1. Card-level removal FIRST. These detect a sponsored *card* by a label
    //    element inside it — and the broad AD_SEL sweep below also matches that
    //    same label (.puis-sponsored-label-text). Running the sweep first would
    //    delete the label and leave the sponsored product card behind.
    document.querySelectorAll('[data-component-type="s-search-result"]').forEach(card => {
      if (card.querySelector('.puis-sponsored-label-text, .s-sponsored-label-info-icon')) {
        card.remove();
        batch++;
      }
    });
    // Text-based scan: "Sponsored" labels Amazon injects across locales
    document.querySelectorAll('.s-label-popover-default, .a-color-secondary').forEach(el => {
      const _t = el.textContent.trim();
      if (AMZN_SPONSORED.has(_t)) {
        const card = el.closest('[data-asin]') || el.closest('[data-component-type]')
                  || el.closest('li.s-result-item') || el.closest('.s-result-item');
        if (card && (card.hasAttribute('data-asin') || card.querySelector('[data-asin]') !== null)) {
          card.remove(); batch++;
        }
      }
    });
    // 2. Broad selector sweep for standalone ad slots / banners / labels.
    try {
      document.querySelectorAll(AD_SEL).forEach(el => { el.remove(); batch++; });
    } catch (_) {
      for (const sel of AD_SELECTORS) {
        try { document.querySelectorAll(sel).forEach(el => { el.remove(); batch++; }); } catch (_) {}
      }
    }

    if (batch > 0) {
      chrome.runtime.sendMessage({ type: 'INCREMENT_STAT', statType: 'amazon' }).catch(()=>{});
      chrome.runtime.sendMessage({ type: 'LOG_EVENT', source: 'amazon',
        level: 'info', message: `Removed ${batch} sponsored elements` }).catch(()=>{});
    }
  }

  // FIX: Debounce MutationObserver
  let debounce = null;
  const observer = new MutationObserver(() => {
    clearTimeout(debounce);
    debounce = setTimeout(clean, 200);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  let _armed = true;
  chrome.storage.onChanged.addListener((changes) => {
    if (!changes.settings) return;
    const _v = changes.settings.newValue?.amazon;
    if (_v === false && _armed) {
      _armed = false;
      observer.disconnect();
      clearTimeout(debounce);
      _removeAmazonCss();
    } else if (_v === true && !_armed) {
      // Re-arm after a re-enable — otherwise the script stayed dead until reload.
      _armed = true;
      _injectAmazonCss();
      observer.observe(document.documentElement, { childList: true, subtree: true });
      clean();
    }
  });

  clean();
  window.addEventListener('load', clean);

})().catch(e => console.warn('[SB:amazon] script error:', e?.message ?? e));
