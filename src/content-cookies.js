/**
 * ShieldBlock Pro — Cookie Consent Auto-Rejector v3.0
 *
 * Strategy (in order):
 *   1. Click a named reject selector (fastest, most reliable)
 *   2. Click any button matching REJECT_PATTERNS text (e.g. "Reject All")
 *   3. If only accept options are visible, click them (better than endless banner)
 *   4. Remove the banner element as last resort after MAX_RETRIES attempts
 *
 * Key fix from v2: banners without buttons are retried up to MAX_RETRIES times
 * instead of being immediately removed or permanently ignored. Many CMPs render
 * their "Reject All" button 300–800ms after the banner container appears.
 */

(async () => {
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
  const _ckWl = settings?.whitelist ?? [];
  if (settings?.globalPause) return; // global pause active — skip all processing
  if (!settings?.cookies) return;
  const _host = location.hostname.replace(/^www\./, '');
  // No cookie banners on YouTube — skip entirely
  if (_host.includes('youtube.com') || _host.includes('youtu.be')) return;
  if (_ckWl.some(d => _host === d || _host.endsWith('.' + d))) return;

  // ── Banner container selectors ─────────────────────────────────────────────
  const BANNER_SELECTORS = [
    // OneTrust (most common globally)
    '#onetrust-banner-sdk', '#onetrust-consent-sdk', '#onetrust-pc-sdk',
    '#ot-sdk-container', '[class*="CookiePro"]',
    // Cookiebot
    '#CybotCookiebotDialog', '#CybotCookiebotDialogBody', '#cookiebanner',
    // TrustArc
    '.truste_popframe', '#truste-consent-track', '.truste_overlay',
    '.truste_box_overlay', '#teconsent', '.trustarc-consent-track',
    // Didomi
    '#didomi-host', '.didomi-popup-container', '#didomi-consent-popup',
    // Quantcast Choice
    '#qc-cmp2-container', '#qc-cmp2-ui', '.qc-cmp-ui-container',
    // Funding Choices (Google) — very common on news/media sites
    '.fc-dialog-container', '.fc-consent-root', '.fc-cta-do-not-consent',
    // Sourcepoint / CMP by Sourcepoint
    '#sp_message_container', '.sp-message-container', '.sp-consent-ui',
    // CookieFirst
    '#cookiefirst-root', '.cookiefirst-root',
    // Evidon / Crownpeak
    '#_evidon-banner', '.evidon-banner',
    // LiveRamp / SafeFrame
    '.liveRamp-consent-banner',
    // Termly
    '#termly-code-snippet-support', '[data-id*="termly"]',
    // Cookiehub
    '.ch2-dialog', '#cookiehub',
    // Klaro
    '.klaro', '#klaro',
    // Iubenda
    '#iubenda-cs-banner', '.iubenda-cs-content', '.iubenda-cs-container',
    // Osano
    '.osano-cm-window', '.osano-cm-dialog',
    // CookieYes / CookieLaw
    '.cky-consent-container', '#cookieyes-root', '#cky-consent', '.cky-modal',
    // Usercentrics
    '#usercentrics-root', '.uc-embedding-container',
    // Borlabs Cookie
    '#borlabs-cookie',
    // CookieScript
    '.cookie-script-consent', '#cookiescript_injected',
    '#cookiescript_injected_wrapper',
    // WP Cookie plugins
    '#cookie-notice', '#gdpr-cookie-consent-bar', '#cookie-law-info-bar',
    '.cli-bar-container', '#cookie_action_close_header',
    // Complianz
    '.cmplz-cookiebanner', '#cmplz-cookiebanner-container',
    // WebToffee GDPR
    '#wt-cli-cookie-bar',
    // Drupal EU Cookie Compliance
    '.eu-cookie-compliance-banner',
    // Admiral
    '.admiral-consent-overlay',
    // Tealium
    '#__tealiumGDPRcpPrefs', '.tealium-consent-banner',
    // Cookie Consent by Insites
    '.cc-window', '.cc-banner',
    // HubSpot
    '#hs-eu-cookie-confirmation', '#hs-eu-cookie-confirmation-inner',
    // Civic Cookie Control
    '#ccc', '#ccc-module', '.ccc-notify',
    // Axeptio (France)
    '#axeptio_overlay', '.axeptio_buttons_wrapper', '#axeptio-cookies',
    '[class*="axeptio"]',
    // Consentmanager.net
    '#cmpbox', '#cmpbox2', '.cmpboxbtn', '#cmp-container',
    '[class*="cmpbox"]',
    // Piwik PRO
    '#ppms_cm_popup_overlay', '.ppms-popup', '#ppms_cm_consent_popup_overlay',
    // Ketch
    '#ketch-consent', '.ketch-consent__banner', '[class*="ketch-"]',
    // Metomic
    '[data-testid="metomic-consent-manager"]', '.metomic-consent',
    '[id*="metomic"]', '[class*="metomic"]',
    // Siteimprove / Privacy Manager
    '.privacy-manager-overlay', '#privacy-manager-modal',
    // Cookieassistant (WP plugin)
    '#cookieassistant-com', '.cookie-assistant-consent',
    // WP Consent API / GDPR Cookie Compliance
    '#gdpr-cookie-compliance-popup', '.moove-gdpr-info-bar',
    '#moove_gdpr_cookie_modal',
    // Generic strong patterns
    '[id*="cookie-banner"]', '[id*="cookiebanner"]', '[id*="cookie-consent"]',
    '[class*="cookie-banner"]', '[class*="cookie-consent"]',
    '[id*="gdpr-banner"]', '[class*="gdpr-banner"]',
    '[id*="consent-manager"]', '[class*="consent-manager"]',
    '[id*="cookie-notice"]', '[class*="cookie-notice"]',
    '[role="dialog"][aria-label*="cookie" i]',
    '[role="dialog"][aria-label*="consent" i]',
    '[role="alertdialog"][aria-label*="cookie" i]',
  ];

  // ── Named reject button selectors (tried first — fastest path) ─────────────
  const REJECT_SELECTORS = [
    // OneTrust
    '#onetrust-reject-all-handler',
    '.ot-pc-refuse-all-handler',
    // Cookiebot
    '#CybotCookiebotDialogBodyButtonDecline',
    '#CybotCookiebotDialogBodyLevelButtonLevelOptinDeclineAll',
    // TrustArc
    '.truste_cursor_pointer[data-role="acknowledge"]',
    // Didomi
    '.didomi-button-refuse', '#didomi-notice-decline-button',
    // Quantcast
    '.qc-cmp2-summary-buttons .qc-cmp2-secondary-button',
    // Funding Choices (Google)
    '.fc-cta-do-not-consent',
    // CookieFirst
    '[data-cky-tag="reject-button"]', '.cky-btn-reject',
    // Sourcepoint
    '.sp-dsr-button', '[data-sp-reject-all]',
    // OneTrust again (various implementations)
    '.js-accept-necessary', '.js-deny',
    // Complianz
    '.cmplz-deny', '[data-role="cmplz-deny"]',
    // CookieYes
    '[data-cky-tag="reject-button"]',
    // Generic
    '#cm-acceptNecessary', '#declineButton', '#decline-button',
    '[data-action="reject"]', '[data-action="decline"]',
    '[data-action="rejectAll"]', '[data-action="decline_all"]',
    '.reject-all', '.decline-all', '.cookie-decline',
    '[aria-label*="Reject all" i]', '[aria-label*="Decline all" i]',
    '[data-tid="banner-decline"]',
    // Borlabs
    '[data-purpose="necessary-accept"]',
    // Cookiehub
    '.ch2-btn.ch2-deny', '.ch2-deny-all-btn',
    // Klaro
    '.cm-btn-decline', '.cm-btn-decline-all',
    // Usercentrics
    '[data-testid="uc-deny-all-button"]',
    // Cookie Consent by Insites
    '.cc-deny',
    // Civic Cookie Control
    '#ccc-reject-settings', '.ccc-notify-decline',
    // HubSpot
    '#hs-eu-decline-button',
    // Axeptio
    '.axeptio_btn_dismiss', '[class*="axeptio"][class*="decline"]',
    '[class*="axeptio"][class*="refuse"]',
    // Consentmanager.net
    '.cmpboxbtnno', '[class*="cmpboxbtn"][class*="no"]',
    '#cmpwelcomebtndisagree', '.cmptxt_btn_no',
    // Piwik PRO
    '#ppms_cm_reject-all', '[data-testid="ppms-cm-reject-all"]',
    // Ketch
    '[class*="ketch"][class*="decline"]', '[class*="ketch"][class*="reject"]',
    // Metomic
    '[data-testid="metomic-reject-all"]', '[class*="metomic"][class*="decline"]',
    // Moove GDPR
    '#moove_gdpr_decline_cookies',
  ];

  // ── Text patterns for reject buttons ──────────────────────────────────────
  const REJECT_PATTERNS = [
    // ── English ────────────────────────────────────────────────────────────
    /reject\s+all/i, /decline\s+all/i, /refuse\s+all/i, /deny\s+all/i,
    /necessary\s+only/i, /essential\s+only/i, /only\s+necessary/i,
    /only\s+essential/i, /strictly\s+necessary/i,
    /no[,\s]+thanks/i, /no\s+thank/i,
    /^decline$/i, /^reject$/i, /^refuse$/i, /^deny$/i,
    /manage\s+prefer/i, /save\s+prefer/i, /save\s+settings/i,
    /continue\s+without/i, /proceed\s+without/i,
    /use\s+necessary/i, /keep\s+necessary/i,
    // ── German (de) ────────────────────────────────────────────────────────
    /^ablehnen$/i,
    /alle?\s+ablehnen/i,                      // "Alle ablehnen"
    /alles\s+ablehnen/i,
    /^nicht\s+zustimmen$/i,
    /^nicht\s+akzeptieren$/i,
    /nur\s+(notwendige|erforderliche|wesentliche)/i,
    /ohne\s+zustimmung/i,                     // "Ohne Zustimmung fortfahren"
    /^nein[,\s]+danke/i,
    /auswahl\s+ablehnen/i,
    /einstellungen\s+speichern/i,             // necessary-only save on some CMPs
    // ── French (fr) ────────────────────────────────────────────────────────
    /tout\s+refuser/i, /refuser\s+tout/i,
    /tout\s+rejeter/i, /rejeter\s+tout/i,
    /continuer\s+sans\s+accepter/i,
    /^non[,\s]+merci/i,
    /uniquement\s+n.cessaire/i,               // accent-optional
    /^refuser$/i,
    /^rejeter$/i,
    // ── Spanish (es) ───────────────────────────────────────────────────────
    /rechazar\s+todo/i, /rechazar\s+todas/i,
    /solo\s+(necesarias?|esenciales?)/i,
    /solo\s+lo\s+esencial/i,
    /^no[,\s]+gracias/i,
    /continuar\s+sin\s+aceptar/i,
    /^rechazar$/i,
    // ── Italian (it) ───────────────────────────────────────────────────────
    /rifiuta\s+tutt[io]/i,                    // "tutto" / "tutti"
    /solo\s+(necessari|essenziali)/i,
    /^no[,\s]+grazie/i,
    /continua\s+senza\s+accettare/i,
    /^rifiuta$/i,
    // ── Portuguese (pt) ────────────────────────────────────────────────────
    /rejeitar\s+tudo/i, /recusar\s+tudo/i,
    /rejeitar\s+todos/i,
    /apenas\s+necess.rios/i,
    /n.o[,\s]+obrigad/i,                      // "Não, obrigado/a"
    /continuar\s+sem\s+aceitar/i,
    /^rejeitar$/i, /^recusar$/i,
    // ── Dutch (nl) ─────────────────────────────────────────────────────────
    /alles\s+(weigeren|afwijzen)/i,
    /alle\s+cookies\s+weigeren/i,
    /alleen\s+(noodzakelijke|essenti.le)/i,
    /^nee[,\s]+bedankt/i,
    /^weigeren$/i, /^afwijzen$/i,
    // ── Polish (pl) ────────────────────────────────────────────────────────
    /odrzuć\s+wszystko/i, /odmów\s+wszystkiego/i,
    /tylko\s+niezbędne/i,
    /^nie[,\s]+dziękuję/i,
    /^odrzuć$/i,
    // ── Swedish (sv) ───────────────────────────────────────────────────────
    /avvisa\s+alla/i, /neka\s+alla/i, /avböj\s+alla/i,
    /endast\s+nödvändiga/i,
    /^nej\s+tack/i,
    /^avvisa$/i, /^avböj$/i,
    // ── Norwegian (no) ─────────────────────────────────────────────────────
    /avsl[åa]\s+alle/i, /avvis\s+alle/i,
    /kun\s+n.dvendige/i,
    /^nei\s+takk/i,
    /^avsl[åa]$/i, /^avvis$/i,
    // ── Danish (da) ────────────────────────────────────────────────────────
    /afvis\s+alle/i, /afsl[åa]\s+alle/i,
    /kun\s+n.dvendige/i,
    /^nej\s+tak/i,
    /^afvis$/i,
    // ── Finnish (fi) ───────────────────────────────────────────────────────
    /hylk.ä\s+kaikki/i, /kieltäydy\s+kaikesta/i,
    /vain\s+välttämättömät/i,
    /^ei\s+kiitos/i,
    /^hylkää$/i,
    // ── Czech (cs) ─────────────────────────────────────────────────────────
    /odm.tnout\s+v.e/i,                       // "Odmítnout vše"
    /pouze\s+nezbytn/i,
    /^ne[,\s]+d.kuji/i,                       // "Ne, děkuji"
    /^odm.tnout$/i,
    // ── Slovak (sk) ────────────────────────────────────────────────────────
    /odmietnuť\s+vš/i,
    /len\s+nevyhnutné/i,
    /^nie[,\s]+ďakujem/i,
    /^odmietnuť$/i,
    // ── Romanian (ro) ──────────────────────────────────────────────────────
    /respinge\s+tot/i, /refuza\s+tot/i,
    /doar\s+necesare/i,
    /^nu[,\s]+mul.umesc/i,                    // "Nu, mulțumesc"
    /^respinge$/i,
    // ── Hungarian (hu) ─────────────────────────────────────────────────────
    /mindent\s+elutas.t/i, /összes\s+elutas.t/i,
    /csak\s+szükséges/i,
    /^nem[,\s]+köszönöm/i,
    /^elutas.t$/i,
    // ── Greek (el) ─────────────────────────────────────────────────────────
    /απόρριψη\s+όλων/,
    /απορρίπτω\s+όλα/,
    /μόνο\s+απαραίτητα/,
    /^όχι[,\s]+ευχαριστώ/,
    /^απόρριψη$/,
    // ── Bulgarian (bg) ─────────────────────────────────────────────────────
    /откажи\s+всички/,
    /само\s+задължителни/,
    /^не[,\s]+благодаря/,
    /^откажи$/,
    // ── Croatian / Serbian (hr/sr) ──────────────────────────────────────────
    /odbij\s+sve/i,
    /samo\s+(neophodno|nužno)/i,
    /^ne[,\s]+hvala/i,
    /^odbij$/i,
    // ── Turkish (tr) ───────────────────────────────────────────────────────
    /hepsini\s+reddet/i, /tümünü\s+reddet/i,
    /yalnızca\s+gerekli/i,
    /^hayır[,\s]+teşekkürler/i,
    /^reddet$/i,
    // ── Russian (ru) ───────────────────────────────────────────────────────
    /отклонить\s+всё/,
    /отказаться\s+от\s+всего/,
    /только\s+необходимые/,
    /^нет[,\s]+спасибо/,
    /^отклонить$/,
    // ── Ukrainian (uk) ─────────────────────────────────────────────────────
    /відхилити\s+всі/,
    /лише\s+необхідні/,
    /^ні[,\s]+дякую/,
    /^відхилити$/,
    // ── Japanese (ja) ──────────────────────────────────────────────────────
    /必須のみ/,
    /必要なもののみ/,
    /すべて拒否/,
    /同意しない/,
    /拒否する/,
    // ── Chinese Simplified / Traditional (zh) ──────────────────────────────
    /仅必要/,           // Simplified: only necessary
    /僅必要/,           // Traditional: only necessary
    /拒绝全部/,         // Simplified: reject all
    /拒絕全部/,         // Traditional: reject all
    /只接受必要/,       // only accept necessary (both scripts)
    /不接受/,           // "don't accept"
    // ── Korean (ko) ────────────────────────────────────────────────────────
    /전체\s*거부/,
    /필수만\s*동의/,
    /거부하기/,
  ];

  // ── Accept selectors (fallback — better than an endless banner) ───────────
  const ACCEPT_SELECTORS = [
    '#onetrust-accept-btn-handler',
    '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
    '.didomi-button-agree', '[data-cky-tag="accept-button"]',
    '#cm-acceptAll', '.cky-btn-accept-all',
    '.fc-cta-consent', '[data-action="acceptAll"]',
    '[data-testid="uc-accept-all-button"]',
    '.cc-accept', '.cc-allow',
  ];

  const ACCEPT_PATTERNS = [
    // ── English ────────────────────────────────────────────────────────────
    /accept\s+all/i, /allow\s+all/i, /agree\s+all/i,
    /i\s+agree/i, /got\s+it/i, /^ok$/i, /^okay$/i,
    /^accept$/i, /^allow$/i, /^agree$/i,
    // ── German (de) ────────────────────────────────────────────────────────
    /alle\s+akzeptieren/i, /alle\s+zustimmen/i,
    /alles\s+akzeptieren/i,
    /^zustimmen$/i, /^akzeptieren$/i, /^einverstanden$/i,
    // ── French (fr) ────────────────────────────────────────────────────────
    /tout\s+accepter/i, /accepter\s+tout/i,
    /^j.accepte/i,                            // "J'accepte"
    /^accepter$/i,
    // ── Spanish (es) ───────────────────────────────────────────────────────
    /aceptar\s+todo/i, /aceptar\s+todas/i,
    /^aceptar$/i, /^acepto$/i,
    // ── Italian (it) ───────────────────────────────────────────────────────
    /accetta\s+tutt[io]/i,
    /^accetta$/i, /^accetto$/i,
    // ── Portuguese (pt) ────────────────────────────────────────────────────
    /aceitar\s+tudo/i, /aceitar\s+todos/i,
    /^aceitar$/i, /^aceito$/i,
    // ── Dutch (nl) ─────────────────────────────────────────────────────────
    /alles\s+accepteren/i,
    /alle\s+cookies\s+accepteren/i,
    /^accepteren$/i, /^akkoord$/i,
    // ── Polish (pl) ────────────────────────────────────────────────────────
    /zaakceptuj\s+wszystko/i,
    /^akceptuję$/i, /^zaakceptuj$/i,
    // ── Swedish (sv) ───────────────────────────────────────────────────────
    /acceptera\s+alla/i, /godkänn\s+alla/i,
    /^acceptera$/i, /^godkänn$/i,
    // ── Norwegian (no) ─────────────────────────────────────────────────────
    /godta\s+alle/i, /godkjenn\s+alle/i,
    /^godta$/i, /^godkjenn$/i,
    // ── Danish (da) ────────────────────────────────────────────────────────
    /accepter\s+alle/i,
    /^accepter$/i, /^godkend$/i,
    // ── Finnish (fi) ───────────────────────────────────────────────────────
    /hyväksy\s+kaikki/i,
    /^hyväksy$/i,
    // ── Czech (cs) ─────────────────────────────────────────────────────────
    /p.ijmout\s+v.e/i,                        // "Přijmout vše"
    /^p.ijmout$/i,
    // ── Slovak (sk) ────────────────────────────────────────────────────────
    /prijať\s+všetko/i,
    /^prijať$/i,
    // ── Romanian (ro) ──────────────────────────────────────────────────────
    /accepta\s+tot/i,
    /^accept$/i, /^accepta$/i,
    // ── Hungarian (hu) ─────────────────────────────────────────────────────
    /mindet\s+elfogad/i,
    /^elfogadom$/i, /^elfogad$/i,
    // ── Greek (el) ─────────────────────────────────────────────────────────
    /αποδοχή\s+όλων/,
    /^αποδέχομαι$/,
    // ── Bulgarian (bg) ─────────────────────────────────────────────────────
    /приемам\s+всички/,
    /^приемам$/,
    // ── Croatian / Serbian (hr/sr) ──────────────────────────────────────────
    /prihvati\s+sve/i,
    /^prihvati$/i, /^slažem\s+se$/i,
    // ── Turkish (tr) ───────────────────────────────────────────────────────
    /hepsini\s+kabul\s+et/i, /tümünü\s+kabul\s+et/i,
    /^kabul\s+et$/i,
    // ── Russian (ru) ───────────────────────────────────────────────────────
    /принять\s+все/,
    /^принять$/, /^согласен$/,
    // ── Ukrainian (uk) ─────────────────────────────────────────────────────
    /прийняти\s+всі/,
    /^прийняти$/, /^погоджуюсь$/,
    // ── Japanese (ja) ──────────────────────────────────────────────────────
    /すべて同意/,
    /同意する/,
    // ── Chinese Simplified / Traditional (zh) ──────────────────────────────
    /全部接受/, /接受全部/, /接受所有/,
    // ── Korean (ko) ────────────────────────────────────────────────────────
    /전체\s*동의/,
    /동의하기/,
  ];

  // ── Button finder ──────────────────────────────────────────────────────────
  function findButton(container, patterns, selectors, doc = document) {
    // Named selectors first (fastest, most reliable)
    for (const sel of selectors) {
      try {
        // Check inside the banner
        let btn = container.querySelector(sel);
        // Also check in the wider document for CMPs that render buttons outside the container
        if (!btn) btn = doc.querySelector(sel);
        if (btn && !btn.disabled) return btn;
      } catch (_e) { console.warn('[SB:cookies]', _e?.message ?? _e); }
    }
    // Text pattern matching — walk all clickable elements inside the banner
    const clickable = container.querySelectorAll(
      'button, [role="button"], [type="button"], [type="submit"], a.btn, a.button'
    );
    for (const btn of clickable) {
      if (btn.disabled) continue;
      const text = (
        btn.textContent.trim() ||
        btn.getAttribute('aria-label') ||
        btn.getAttribute('title') ||
        btn.getAttribute('value') ||
        ''
      );
      if (patterns.some(p => p.test(text))) return btn;
    }
    return null;
  }

  // ── State tracking ─────────────────────────────────────────────────────────
  // handled  — banners we've clicked or explicitly removed (never touch again)
  // retries  — how many times we've tried a banner without finding a button
  const handled = new WeakSet();
  const retries = new WeakMap(); // banner → count
  const MAX_RETRIES = 6; // ~6 × 200ms debounce = up to ~2s of retrying

  // ── Shadow DOM support ─────────────────────────────────────────────────────
  const knownRoots = new Set([document]);

  function _walkShadow(el, depth) {
    if (depth <= 0 || !el || el.nodeType !== 1) return;
    if (el.shadowRoot) knownRoots.add(el.shadowRoot);
    for (let i = 0; i < el.children.length; i++) _walkShadow(el.children[i], depth - 1);
  }

  function collectShadowRoots(nodes) {
    for (const node of nodes) {
      if (node.nodeType !== 1) continue;
      _walkShadow(node, 6);
    }
  }

  // ── Page unlock ───────────────────────────────────────────────────────────
  function unlockPage() {
    // Some CMPs lock html AND body overflow, add padding-right to avoid scrollbar jump
    for (const el of [document.documentElement, document.body]) {
      if (!el) continue;
      const s = el.style;
      if (s.overflow === 'hidden' || s.overflow === 'clip') s.overflow = '';
      if (s.overflowY === 'hidden' || s.overflowY === 'clip') s.overflowY = '';
      if (s.paddingRight) s.paddingRight = '';
      if (s.marginRight)  s.marginRight  = '';
      if (s.position === 'fixed') s.position = '';
    }

    // Hide overlay backdrop elements (z-index blockers, not the banner itself)
    document.querySelectorAll([
      '.cky-overlay', '.sp_overlay', '.didomi-popup-overlay',
      '[class*="cookie"][class*="overlay"]', '[class*="consent"][class*="overlay"]',
      '[class*="gdpr"][class*="overlay"]', '.modal-backdrop.show',
    ].join(',')).forEach(el => { el.style.display = 'none'; });
  }

  // ── Main handler ──────────────────────────────────────────────────────────
  function handleBanners() {
    let anyAction = false;

    for (const root of knownRoots) {
      const doc = root === document ? document : root.ownerDocument ?? document;

      for (const sel of BANNER_SELECTORS) {
        let matches;
        try { matches = root.querySelectorAll(sel); } catch (_) { continue; }

        for (const banner of matches) {
          if (handled.has(banner)) continue;

          const attemptCount = retries.get(banner) ?? 0;

          // After MAX_RETRIES failed attempts — remove as last resort
          if (attemptCount >= MAX_RETRIES) {
            banner.remove();
            handled.add(banner);
            anyAction = true;
            continue;
          }

          retries.set(banner, attemptCount + 1);

          // Try reject first (preferred — privacy-respecting)
          const rejectBtn = findButton(banner, REJECT_PATTERNS, REJECT_SELECTORS, doc);
          if (rejectBtn) {
            rejectBtn.click();
            handled.add(banner);
            anyAction = true;
            chrome.runtime.sendMessage({ type: 'INCREMENT_STAT', statType: 'cookies' }).catch(()=>{});
            chrome.runtime.sendMessage({ type: 'LOG_EVENT', source: 'cookies',
              level: 'info', message: `Rejected cookie banner`,
              data: { cmp: banner.tagName + (banner.id ? '#'+banner.id : '') } }).catch(()=>{});
            continue;
          }

          // Fall back to accept (better than blocking the page indefinitely)
          const acceptBtn = findButton(banner, ACCEPT_PATTERNS, ACCEPT_SELECTORS, doc);
          if (acceptBtn) {
            acceptBtn.click();
            handled.add(banner);
            anyAction = true;
            continue;
          }

          // No button found yet — will retry on next debounce tick
          // (button may still be loading asynchronously)
        }
      }
    }

    unlockPage();
  }

  // ── TCF API auto-reject (for IAB TCF-compliant CMPs) ─────────────────────
  // Some CMPs expose window.__tcfapi. We can't call setConsent directly (not
  // a standard command), but we can use it to detect the CMP is loaded and
  // trigger our button-click approach on the right timing.
  function tryTCFDetect() {
    if (!window.__tcfapi) return;
    try {
      window.__tcfapi('ping', 2, (ping) => {
        if (ping?.cmpLoaded && ping?.cmpStatus === 'loaded') {
          // CMP is fully loaded — run banner handler with short delay
          setTimeout(handleBanners, 100);
        }
      });
    } catch (_e) { console.warn('[SB:cookies]', _e?.message ?? _e); }
  }

  // ── Pre-emptive cookie/localStorage consent bypass ─────────────────────────
  // Pre-set common CMP consent cookies and localStorage keys so the banner
  // never appears on repeat visits. These are the keys CMPs check at init.
  function tryPreemptiveConsent() {
    try {
      // Generic consent localStorage keys (many CMPs check these)
      const keys = {
        'cookieconsent_status': 'dismiss',
        'cookie_consent': 'accepted',
        'consentStatus': 'accepted',
        'gdprConsent': '1',
        'privacyConsent': 'true',
        'cookie-agreed': '2',
        'cookie-agreed-version': '2',
        'rcl_consent_given': 'true',
        'cmplz_marketing': 'false',
        'cmplz_statistics': 'false',
        'cmplz_functional': 'true',
        'cmplz_policy_id': '1',
        'wp-wpml_current_language': document.documentElement.lang || 'en',
        'borlabs-cookie': JSON.stringify({version:'3.0',expiry:'+1year',uid:'sbpro',
          categories:{essential:true,marketing:false,statistics:false}}),
      };
      for (const [k, v] of Object.entries(keys)) {
        try { if (!localStorage.getItem(k)) localStorage.setItem(k, v); } catch(_) {}
      }

      // Generic consent cookies
      const expire = new Date(Date.now() + 365 * 864e5).toUTCString();
      const cookiePairs = [
        ['cookieconsent_status','dismiss'],
        ['cookie_consent','accepted'],
        ['CookieConsent','true'],
        ['cookie-agreed','2'],
        ['gdpr','1'],
        // NOTE: euconsent-v2 intentionally omitted — setting it to '' causes TCF-compliant
        // CMPs (OneTrust, Cookiebot, etc.) to find the key, fail to parse the empty string
        // as a valid consent string, and show the banner anyway.
      ];
      for (const [n, v] of cookiePairs) {
        if (!document.cookie.includes(n + '=')) {
          document.cookie = `${n}=${v};expires=${expire};path=/;SameSite=Lax`;
        }
      }
    } catch (_e) { console.warn('[SB:cookies]', _e?.message ?? _e); }
  }

  // ── CookieConsent by Insites — localStorage approach ─────────────────────
  // This CMP reads localStorage on init. Pre-setting the dismiss value
  // prevents the banner from ever appearing on subsequent page loads.
  function tryLocalStorageConsent() {
    try {
      if (!localStorage.getItem('cookieconsent_status')) {
        localStorage.setItem('cookieconsent_status', 'dismiss');
      }
      // Some Cookiebot sites check this key
      if (!localStorage.getItem('CookieConsent')) {
        localStorage.setItem('CookieConsent', JSON.stringify({
          stamp: '', necessary: true, preferences: false,
          statistics: false, marketing: false, method: 'explicit', ver: 1,
          utc: Date.now(), region: 'gb',
        }));
      }
    } catch (_e) { console.warn('[SB:cookies]', _e?.message ?? _e); }
  }

  // ── MutationObserver ───────────────────────────────────────────────────────
  let _debounce = null;
  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) collectShadowRoots(m.addedNodes);
    clearTimeout(_debounce);
    _debounce = setTimeout(handleBanners, 200);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  // ── Timed retries ─────────────────────────────────────────────────────────
  // Staggered across 10 seconds — covers slow-loading CMPs and SPAs that inject
  // banners well after DOMContentLoaded
  tryPreemptiveConsent();
  tryLocalStorageConsent();
  tryTCFDetect();
  for (const delay of [300, 800, 1800, 3500, 6000, 10000]) {
    setTimeout(handleBanners, delay);
  }

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.settings?.newValue?.cookies === false) {
      observer.disconnect();
      clearTimeout(_debounce);
    }
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'GLOBAL_PAUSE') { observer.disconnect(); clearTimeout(_debounce); }
    if (msg.type === 'GLOBAL_RESUME') { observer.observe(document.documentElement, { childList: true, subtree: true }); handleBanners(); }
  });

  window.addEventListener('beforeunload', () => {
    observer.disconnect(); clearTimeout(_debounce);
  }, { once: true });

})().catch(e => console.warn('[SB:cookies] script error:', e?.message ?? e));
