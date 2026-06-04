/**
 * ShieldBlock Pro — Annoyance Blocker
 *
 * Removes intrusive on-page nags that the general cosmetic engine does NOT
 * already cover (newsletter popups, anti-adblock walls and high-z interstitials
 * are handled in content-general.js). This script targets, by named vendor:
 *
 *   1. Live-chat / support widgets (Intercom, Drift, Zendesk, Crisp, …)
 *   2. Web-push permission pre-prompts (OneSignal, PushEngage, WonderPush, …)
 *   3. "Open in app" / smart app-install banners (Branch, smartbanner.js, …)
 *   4. Survey / feedback bubbles (Hotjar, Qualtrics, Usabilla, Survicate, …)
 *   5. Sticky / floating social-share bars (AddThis, ShareThis, AddToAny, …)
 *
 * Selectors are vendor-scoped (specific IDs/classes) to keep false positives
 * near zero. Toggle: settings.annoyances. Stat bucket: 'annoyances'.
 */

(async () => {
  if (!location.href.startsWith('http://') && !location.href.startsWith('https://')) return;

  function _sbLog(level, message, data) {
    chrome.runtime.sendMessage({ type: 'LOG_EVENT', source: 'annoyances', level, message, data: data ?? {} }).catch(() => {});
  }

  // SW wake-up race: retry GET_SETTINGS once after 300ms (same guard as every content script)
  let settings;
  try {
    settings = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
  } catch (_) {
    await new Promise(r => setTimeout(r, 300));
    try { settings = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }); }
    catch (e) { _sbLog('error', `GET_SETTINGS failed after retry: ${e?.message ?? e}`); settings = null; }
  }
  if (settings?.globalPause) return;
  if (!settings?.annoyances) return;

  const _host = location.hostname.replace(/^www\./, '');
  // Never run on YouTube — overlay selectors can hit player chrome and black-screen it
  if (_host.includes('youtube.com') || _host.includes('youtu.be')) return;
  const _wl = settings?.whitelist ?? [];
  if (_wl.some(d => _host === d || _host.endsWith('.' + d))) return;

  // ── Vendor-scoped selectors ─────────────────────────────────────────────────
  // Live-chat / support widgets
  const CHAT_SEL = [
    '#intercom-container', '.intercom-lightweight-app', '#intercom-frame',
    '#drift-widget', '#drift-frame-controller', '.drift-frame-controller', '.drift-frame-chat',
    '#tawkchat-container', '#tawk-bubble-container', 'iframe[title="chat widget"]',
    '#zopim', '.zopim', 'iframe#launcher', 'iframe[title*="Opens a widget" i]',
    '#webWidget', '#launcher-frame',
    '.crisp-client', '#crisp-chatbox',
    '#hubspot-messages-iframe-container',
    '#tidio-chat', '#tidio-chat-iframe',
    '#olark-wrapper', '#habla_window_div', '.olark-launch-button',
    '#freshworks-container', '#freshworks-frame', '.fc_frame', '#fc_frame',
    '#liveperson-window', '.LPMcontainer', '#lpChat',
    '.kustomer-app', '#kustomer-ui-sdk-iframe',
    '.gorgias-chat-container', '#gorgias-chat-container',
    '#beacon-container', '.BeaconFabButtonFrame',
    '.fb-customerchat', '.fb_customer_chat_bounce_in_v2',  // Facebook Customer Chat plugin (3rd-party embed only)
    'jdiv', '.jivo-c', 'jdiv.button',          // JivoChat
    '#smartsupp-widget-container', '.smartsupp-widget',
    '#chatra', '#chatra__iframe',
    '.podium-widget', '#podium-website-widget',
    '#chat-widget-container',                   // LiveChat Inc.
    '.embeddedServiceHelpButton',              // Salesforce
    '#genesys-messenger', '.genesys-mxg-frame',
  ];

  // Web-push permission pre-prompts (the custom overlay shown before the native prompt)
  const PUSH_SEL = [
    '#onesignal-slidedown-container', '.onesignal-slidedown-dialog',
    '#onesignal-bell-container', '.onesignal-bell-launcher',
    '#onesignal-popover-container',
    '.pushengage-optin-modal', '#_pushengage-overlay', '[id^="pushengage"]',
    '.wonderpush-optin', '[class*="wonderpush-subscription"]',
    '.izooto-optin', '#izooto-overlay',
    '.pushly-widget', '[id^="pushly"]',
    '.webpushr-prompt', '#webpushr-prompt-wrapper',
    '.subscribers-prompt', '#aps-prompt',
    '.sendpulse-overlay', '[id^="sp_push"]',
  ];

  // Smart app-install / "open in app" banners
  const APPBANNER_SEL = [
    '.branch-banner-iframe', '#branch-banner-iframe', '.branch-journeys-top',
    '.smartbanner', '.smartbanner-show .smartbanner', '#smartbanner',
    '[class*="smart-app-banner"]', '[id*="smart-app-banner"]',
    '[class*="app-download-banner"]', '[class*="app-install-banner"]',
    '[class*="appBannerWrapper"]', '[data-testid*="app-banner"]',
    '.adn-banner-container',                    // AppsFlyer Smart Banner
    '.bnc-mobile-web-redirect', '.openInAppBanner', '.open-in-app',
  ];

  // Survey / feedback bubbles
  const SURVEY_SEL = [
    '[id^="_hj"]', '.hj-widget-container', '._hj-widget-container', '.__hj-survey',
    '.QSIWebResponsive', '[id^="QSI"]', '[class*="qualtrics"]',
    '#kampyleButtonContainer', '[id^="kampyle"]', '.kampyleButton',
    '#usabilla_live_button_container', '.usabilla_live_button_container',
    '#survicate-box', '[class*="survicate"]', '.smcx-widget',
    '#wootric-modal', '[id^="wootric"]',
    '[id^="delighted-"]', '.delighted-web-survey',
    '#satismeter-container', '[id^="satismeter"]',
    '.feedbackify', '#feedbackify',
    '.medallia-feedback', '[id*="nebula_div_btn"]',
  ];

  // Sticky / floating social-share bars
  const SHARE_SEL = [
    '.at4-share', '.at-share-dock', '#at4-share', '.addthis_floating_style',
    '.addthis-smartlayers', '.at-share-tbx-element.addthis-smartlayers',
    '.st-sticky-share-buttons', '[class*="sharethis-sticky"]',
    '.a2a_floating_style', '.a2a_default_style.a2a_floating_style',
    '.shareaholic-share-buttons-container.shareaholic-dock',
    '[class*="social-share"][class*="float"]', '[class*="floating-share"]',
    '[class*="share-bar"][class*="sticky"]', '[class*="sticky-share"]',
  ];

  // Each group → its stat sub-label, joined into one selector for one query per tick
  const GROUPS = [
    { name: 'chat',    sel: CHAT_SEL.join(',') },
    { name: 'push',    sel: PUSH_SEL.join(',') },
    { name: 'app',     sel: APPBANNER_SEL.join(',') },
    { name: 'survey',  sel: SURVEY_SEL.join(',') },
    { name: 'share',   sel: SHARE_SEL.join(',') },
  ];

  // Don't nuke an element that wraps real content (defensive — vendor selectors are
  // already narrow, but a generic [class*="…"] match could in theory be large).
  function safeToRemove(el) {
    if (!el || !el.isConnected) return false;
    const tag = (el.tagName || '').toLowerCase();
    if (['body', 'html', 'main', 'article'].includes(tag)) return false;
    if (el.childElementCount > 30) return false;
    return true;
  }

  let _logThrottle = 0;
  function tick() {
    if (globalThis.__sbGlobalPause) return;
    let removed = 0;
    const hit = [];
    for (const g of GROUPS) {
      let nodes;
      try { nodes = document.querySelectorAll(g.sel); } catch (_) { continue; }
      for (const el of nodes) {
        if (!safeToRemove(el)) continue;
        try { el.remove(); removed++; if (!hit.includes(g.name)) hit.push(g.name); } catch (_) {}
      }
    }
    if (removed > 0) {
      chrome.runtime.sendMessage({ type: 'INCREMENT_STAT', statType: 'annoyances' }).catch(() => {});
      const now = Date.now();
      if (now - _logThrottle > 5000) {
        _logThrottle = now;
        _sbLog('info', `Removed ${removed} annoyance element(s)`, { types: hit.join(','), host: _host });
      }
    }
  }

  // ── Observer + slow interval ────────────────────────────────────────────────
  // Annoyances aren't time-critical, so a 1.5s interval + debounced observer is plenty.
  let _deb = null;
  const _target = document.body || document.documentElement;
  const _obs = new MutationObserver((mutations) => {
    if (mutations.every(m => m.type === 'characterData')) return;
    clearTimeout(_deb);
    _deb = setTimeout(tick, 400);
  });
  if (_target) { _obs.observe(_target, { childList: true, subtree: true }); }
  const _int = setInterval(tick, 1500);
  tick();

  function stopAnnoyanceBlocking() {
    _obs.disconnect();
    clearInterval(_int);
    clearTimeout(_deb);
  }

  window.addEventListener('beforeunload', stopAnnoyanceBlocking, { once: true });

  chrome.storage.onChanged.addListener((changes) => {
    const wl = changes.whitelist?.newValue;
    const isWhitelisted = Array.isArray(wl) && wl.some(d => _host === d || _host.endsWith('.' + d));
    const paused = changes.globalPause?.newValue && changes.globalPause.newValue.until > Date.now();
    if (changes.settings?.newValue?.annoyances === false || isWhitelisted || paused) stopAnnoyanceBlocking();
  });
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'GLOBAL_PAUSE') stopAnnoyanceBlocking();
    if (message?.type === 'WHITELIST_CHANGED') {
      const wl = message.whitelist ?? [];
      if (wl.some(d => _host === d || _host.endsWith('.' + d))) stopAnnoyanceBlocking();
    }
  });
})().catch(e => {
  try { chrome.runtime.sendMessage({ type: 'LOG_EVENT', source: 'annoyances', level: 'error', message: `Script error: ${e?.message ?? e}`, data: {} }).catch(() => {}); } catch (_) {}
  console.warn('[SB:annoyances] script error:', e?.message ?? e);
});
