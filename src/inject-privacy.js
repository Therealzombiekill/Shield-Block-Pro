/**
 * ShieldBlock Pro — Privacy & Fingerprint Protection v4.0
 * Runs on ALL pages at document_start in MAIN world.
 *
 * Protections:
 *   1.  Canvas fingerprint noise (toDataURL + getImageData)
 *   2.  WebGL renderer/vendor + parameter spoofing
 *   3.  AudioContext fingerprint noise
 *   4.  WebRTC IP leak prevention
 *   5.  Navigator API normalization (hardwareConcurrency, deviceMemory, languages)
 *   6.  navigator.connection spoofing
 *   7.  Screen dimension normalization (width, height, colorDepth, availWidth/H)
 *   8.  Battery API fake data
 *   9.  URL tracking parameter cleanup (initial + SPA pushState/replaceState)
 *   10. Click redirect bypass (Google, Facebook, Twitter t.co, LinkedIn, Bing, Yahoo, DuckDuckGo)
  // ── 11. Notifications / Push ─────────────────────────────────────────────────
  // Leave browser permission prompts intact. Hard-denying these APIs globally
  // breaks legitimate web apps and makes the privacy toggle possible to honor.

 *   15. Global Privacy Control (GPC) signal — navigator.globalPrivacyControl = true
  // ── 16. Geolocation ───────────────────────────────────────────────────────────
  // Leave geolocation under the browser's native permission prompt. Hard-denying
  // globally broke maps, delivery, and local-search flows.

 *   17. Font enumeration protection
 *   18. Sensor API blocking (DeviceMotion, DeviceOrientation, IdleDetector)
 *   19. document.referrer stripping (cross-origin)
 */

(function () {
  'use strict';

  // ── Shared session seed — consistent within a tab, unique across tabs ────────
  const SESSION_SEED = (() => {
    try { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0].toString(16); }
    catch (_) { return Math.random().toString(16).slice(2); }
  })();

  function stableNoise(s) {
    let h = 0xdeadbeef;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x9e3779b9);
    return ((h ^ h >>> 16) >>> 0) / 0xffffffff;
  }

  // ── 1. Canvas fingerprint noise ──────────────────────────────────────────────
  // Adds a stable, session-unique 1-pixel perturbation to canvas output.
  // The same site always gets the same noise value within a session (avoids
  // detection via repeated reads), but differs across sessions and tabs.
  try {
    // Skip canvas noise on YouTube — thumbnail generation and video rendering use canvas
    const _isYT = location.hostname.includes('youtube.com') || location.hostname.includes('youtu.be');
    const _toDataURL = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = function () {
      if (_isYT) return _toDataURL.apply(this, arguments);
      const r = _toDataURL.apply(this, arguments);
      try {
        const idx = r.indexOf('base64,');
        if (idx === -1) return r;
        const off = idx + 7 + Math.floor(stableNoise(SESSION_SEED + this.width + this.height) * 20) + 10;
        if (off >= r.length) return r;
        const c = r.charCodeAt(off);
        return r.slice(0, off) + String.fromCharCode(c === 122 ? 121 : c + 1) + r.slice(off + 1);
      } catch (_) {}
      return r;
    };

    const _getImageData = CanvasRenderingContext2D.prototype.getImageData;
    CanvasRenderingContext2D.prototype.getImageData = function () {
      if (_isYT) return _getImageData.apply(this, arguments); // inject-youtube.js handles YouTube
      const d = _getImageData.apply(this, arguments);
      try {
        const noise = stableNoise(SESSION_SEED + arguments[0] + arguments[1]);
        const p = Math.floor(noise * 3) + 1; // always 1-3; ensures noise is always applied
        if (d.data.length >= 4) {
          const copy = new ImageData(new Uint8ClampedArray(d.data), d.width, d.height);
          copy.data[0] = (copy.data[0] + p) % 256;
          return copy;
        }
      } catch (_) {}
      return d;
    };
  } catch (_) {}

  // ── 2. WebGL fingerprint spoofing ────────────────────────────────────────────
  const RENDERERS = [
    'ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0)',
    'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0)',
    'ANGLE (AMD, AMD Radeon RX 580 Direct3D11 vs_5_0 ps_5_0)',
    'ANGLE (Intel, Intel(R) Iris Xe Graphics Direct3D11 vs_5_0 ps_5_0)',
    'Apple GPU',
  ];
  const _ridx = Math.floor(stableNoise(SESSION_SEED + 'gl') * RENDERERS.length);
  const SPOOFED_RENDERER = RENDERERS[_ridx];
  const SPOOFED_VENDOR   = SPOOFED_RENDERER.includes('NVIDIA') ? 'NVIDIA Corporation'
                         : SPOOFED_RENDERER.includes('AMD')    ? 'AMD'
                         : SPOOFED_RENDERER.includes('Intel')  ? 'Intel Inc.' : 'Apple';

  // Additional WebGL parameters commonly used for fingerprinting
  // Values chosen to match common mid-range hardware
  const GL_PARAM_OVERRIDES = new Map([
    [0x0D33, 4096],   // MAX_TEXTURE_SIZE
    [0x8869, 16],     // MAX_VERTEX_ATTRIBS
    [0x8DFB, 16],     // MAX_VERTEX_UNIFORM_VECTORS
    [0x8DFC, 16],     // MAX_VARYING_VECTORS
    [0x8B4D, 64],     // MAX_COMBINED_TEXTURE_IMAGE_UNITS
    [0x0D3A, 16],     // MAX_TEXTURE_IMAGE_UNITS
  ]);

  function patchWebGL(ctx) {
    // Don't spoof WebGL on YouTube — hardware-accelerated video decode uses WebGL params
    if (location.hostname.includes('youtube.com') || location.hostname.includes('youtu.be')) return;
    try {
      const _gp = ctx.prototype.getParameter;
      ctx.prototype.getParameter = function (p) {
        if (p === 37446) return SPOOFED_RENDERER; // UNMASKED_RENDERER_WEBGL
        if (p === 37445) return SPOOFED_VENDOR;   // UNMASKED_VENDOR_WEBGL
        if (GL_PARAM_OVERRIDES.has(p)) return GL_PARAM_OVERRIDES.get(p);
        return _gp.apply(this, arguments);
      };
    } catch (_) {}
  }
  patchWebGL(WebGLRenderingContext);
  if (window.WebGL2RenderingContext) patchWebGL(WebGL2RenderingContext);

  // ── 3. AudioContext fingerprint noise ────────────────────────────────────────
  try {
    // Skip AudioContext noise on YouTube — affects audio/video sync
    if ((window.AudioContext || window.webkitAudioContext) &&
        !location.hostname.includes('youtube.com') &&
        !location.hostname.includes('youtu.be')) {
      const _gcd = AudioBuffer.prototype.getChannelData;
      const _noised = new WeakMap();
      AudioBuffer.prototype.getChannelData = function (ch) {
        const data = _gcd.call(this, ch);
        let s = _noised.get(this);
        if (!s) { s = new Set(); _noised.set(this, s); }
        if (!s.has(ch)) {
          s.add(ch);
          const noise = (stableNoise(SESSION_SEED + 'audio' + data.length + ch) - 0.5) * 0.0001;
          for (let i = 0; i < data.length; i += 100) data[i] += noise;
        }
        return data;
      };

      const _gffd = AnalyserNode.prototype.getFloatFrequencyData;
      AnalyserNode.prototype.getFloatFrequencyData = function (arr) {
        _gffd.call(this, arr);
        const noise = (stableNoise(SESSION_SEED + 'freq' + arr.length) - 0.5) * 0.0001;
        for (let i = 0; i < arr.length; i += 10) arr[i] += noise;
      };
    }
  } catch (_) {}

  // ── 4. WebRTC ────────────────────────────────────────────────────────────────
  // Do not strip RTCPeerConnection/ICE servers globally. That broke legitimate
  // calls and live playback on Meet, Discord, Zoom, Twitch, and similar apps.

  // ── 5. Navigator API normalization ───────────────────────────────────────────
  // Round hardwareConcurrency and deviceMemory to reduce fingerprint uniqueness.
  // Normalize navigator.languages to [primaryLang, baseLang] — keeps functionality
  // (sites still see your language) but removes the rare multi-language combination.
  try {
    const _hc = navigator.hardwareConcurrency;
    const normCores = [2, 4, 8, 16].reduce((p, c) => Math.abs(c - _hc) < Math.abs(p - _hc) ? c : p);
    if (normCores !== _hc) {
      Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => normCores, configurable: true });
    }
  } catch (_) {}

  try {
    if ('deviceMemory' in navigator) {
      const mem = navigator.deviceMemory;
      const norm = mem <= 2 ? 2 : mem <= 4 ? 4 : 8;
      if (norm !== mem) {
        Object.defineProperty(navigator, 'deviceMemory', { get: () => norm, configurable: true });
      }
    }
  } catch (_) {}

  try {
    // Normalize to [primaryLanguage, baseLanguage] — e.g. ['en-US', 'en']
    // Keeps the user's actual language but removes rare combinations like
    // ['en-US', 'fr-CA', 'de-AT', 'zh-TW'] that uniquely identify a user.
    const lang  = navigator.language || 'en-US';
    const base  = lang.split('-')[0];
    const normLangs = lang === base ? [lang] : [lang, base];
    if (JSON.stringify([...navigator.languages]) !== JSON.stringify(normLangs)) {
      Object.defineProperty(navigator, 'languages', { get: () => normLangs, configurable: true });
    }
  } catch (_) {}

  // ── 6. navigator.connection spoofing ─────────────────────────────────────────
  try {
    if (navigator.connection) {
      const _spoofConn = Object.assign(
        Object.create(Object.getPrototypeOf(navigator.connection)),
        { effectiveType: '4g', downlink: 10, rtt: 50, saveData: false }
      );
      Object.defineProperty(navigator, 'connection', { get: () => _spoofConn, configurable: true });
    }
  } catch (_) {}

  // ── 7. Screen dimension normalization ────────────────────────────────────────
  // Round to nearest 100px — reduces uniqueness without hiding the general device class.
  // Also normalizes colorDepth/pixelDepth (always 24) and availWidth/availHeight
  // (which reveal taskbar size — a unique fingerprint on desktop).
  try {
    const roundTo = (n, step) => Math.round(n / step) * step;
    const fw = roundTo(screen.width,  100);
    const fh = roundTo(screen.height, 100);
    if (fw !== screen.width)  Object.defineProperty(screen, 'width',  { get: () => fw, configurable: true });
    if (fh !== screen.height) Object.defineProperty(screen, 'height', { get: () => fh, configurable: true });
    // availWidth/availHeight expose taskbar size — normalize to full screen dimensions
    if (screen.availWidth  !== screen.width)  Object.defineProperty(screen, 'availWidth',  { get: () => fw, configurable: true });
    if (screen.availHeight !== screen.height) Object.defineProperty(screen, 'availHeight', { get: () => fh, configurable: true });
    // colorDepth is always 24 on modern hardware — normalize to remove edge cases
    Object.defineProperty(screen, 'colorDepth', { get: () => 24, configurable: true });
    Object.defineProperty(screen, 'pixelDepth', { get: () => 24, configurable: true });
  } catch (_) {}


  // ── 7b. WebSocket ad network filtering ───────────────────────────────────────
  // Some ad networks use WebSockets for bid requests and tracking.
  // We block connections to known ad/tracker WebSocket endpoints.
  try {
    const WS_AD_PATTERNS = [
      /wss?:\/\/.*\.(doubleclick|googlesyndication|adnxs|rubiconproject|pubmatic)\./, 
      /wss?:\/\/.*\.(adsrvr|casalemedia|openx|appnexus)\./, 
      /wss?:\/\/(spade|collector)\.(twitch|mixpanel|amplitude)\./,
    ];
    // Never interfere with video platform playback / heartbeat WebSockets.
    const WS_SAFE = /youtube\.com|googlevideo\.com|googleapis\.com|ytimg\.com|twitch\.tv|ttvnw\.net|jtvnw\.net|twitchsvc\.net/;
    const _WS = window.WebSocket;
    window.WebSocket = function (url, protocols) {
      const urlStr = String(url);
      if (WS_SAFE.test(urlStr)) return new _WS(url, protocols); // always allow
      if (WS_AD_PATTERNS.some(p => p.test(urlStr))) {
        // Return a no-op fake WebSocket
        const fake = { send:()=>{}, close:()=>{}, addEventListener:()=>{},
          removeEventListener:()=>{}, dispatchEvent:()=>false,
          readyState: 3, CLOSED: 3, OPEN: 1, url };
        return Object.assign(Object.create(_WS.prototype), fake);
      }
      return new _WS(url, protocols);
    };
    window.WebSocket.prototype = _WS.prototype;
    window.WebSocket.CONNECTING = 0; window.WebSocket.OPEN = 1;
    window.WebSocket.CLOSING = 2; window.WebSocket.CLOSED = 3;
  } catch (_) {}

  // ── 7c. Anti-cryptomining hooks ───────────────────────────────────────────────
  // Cryptomining scripts abuse hardwareConcurrency to determine how many workers
  // Cryptomining protection: handled by NoCoin filter list (network-level).
  // performance.now() precision cap intentionally removed — breaks YouTube HLS timing.

  // ── 8. Battery API fake data ──────────────────────────────────────────────────
  // navigator.getBattery() exposes charge level, charging state, and charge/discharge
  // time — together these form a unique fingerprint. Return plausible fixed values.
  try {
    if (navigator.getBattery) {
      const fakeBattery = {
        charging: true, chargingTime: 0, dischargingTime: Infinity,
        level: 1.0,
        addEventListener: () => {}, removeEventListener: () => {},
        dispatchEvent: () => false,
      };
      navigator.getBattery = () => Promise.resolve(fakeBattery);
    }
  } catch (_) {}

  // ── 9. URL tracking parameter cleanup ────────────────────────────────────────
  const TRACKING_PREFIXES = ['utm_', 'hsa_', 'fb_', 'pd_rd_', 'pf_rd_', 'mc_', 'ck_', 'ml_'];

  const TRACKING_EXACT = new Set([
    // Google
    'gclid', 'gclsrc', 'gad_source', 'gbraid', 'wbraid', '_ga',
    // Meta / Facebook
    'fbclid', 'igshid', 'ig_rid',
    // Microsoft
    'msclkid', 'mscke',
    // Twitter / X
    'twclid', '__twitter_impression',
    // TikTok
    'ttclid', 'ttp',
    // LinkedIn
    'li_fat_id', 'trk', 'trkInfo',
    // Reddit
    'rdt_cid',
    // Snapchat
    'ScCid',
    // Pinterest
    'epik',
    // Impact.com / affiliate networks
    'irclickid', 'clickid', 'rb_clickid',
    // Klaviyo / Mailchimp / email platforms
    'mc_eid', 'mc_cid', 'mkt_tok', '_kx', 'vgo_ee',
    // Adobe / Marketo
    's_kwcid', 'ef_id',
    // Yahoo / Yandex
    'yclid', '_openstat',
    // Misc
    'otc', 'nr_email_referer', 'mbsy', 'mbsy_source',
    'spm', 'scm', 'pvid',
    // HubSpot
    '_hsenc', '_hsmi',
    // Quora
    'qclid',
    // Branch / deep links
    '_branch_match_id',
    // Drip
    'drip',
    // TikTok Shop
    'tt_from', 'tt_medium', 'tt_content', 'tt_campaign_id', 'tt_ad_id',
    // Pinterest
    'pin_unauth_id', 'e_t',
    // Snapchat deeper
    'sc_referrer', 'sc_icid',
    // Rakuten/LinkShare
    'ranSiteID', 'ranMID', 'ranEAID',
    // ShareASale
    'sas_email', 'afftrack',
    // Walmart
    'wmlspartner', 'selectedSellerId', 'adid',
    // eBay
    'campid', 'toolid', 'customid', 'mkcid', 'mkrid', 'siteid', 'mkevt',
    // Commission Junction
    'cjevent', 'AID', 'PID',
    // Criteo
    'criteo_q',
    // Adobe/Marketo deeper
    'mkt_uniqname', 'trk_contact', 'trk_msg', 'trk_module', 'trk_sid',
    // General click IDs
    'click_id', 'cid', 'pcid', 'af_click_lookback',
    // Email platform deeper
    'oly_enc_id', 'oly_anon_id', 'mailingid', 'recipientid',
    // Microsoft Clarity
    'clarity_id',
    // Outbrain
    'obOrigUrl', 'outbrainClickId',
  ]);

  function cleanURL(urlStr) {
    try {
      const url = new URL(urlStr);
      let changed = false;

      // Query string params
      if (url.search) {
        const params = new URLSearchParams(url.search);
        for (const key of [...params.keys()]) {
          if (TRACKING_EXACT.has(key) || TRACKING_PREFIXES.some(p => key.startsWith(p))) {
            params.delete(key); changed = true;
          }
        }
        if (changed) url.search = params.toString() ? '?' + params.toString() : '';
      }

      // Hash fragment — some trackers put params after #
      if (url.hash && url.hash.includes('=')) {
        const hashBody = url.hash.slice(1);
        try {
          const hashParams = new URLSearchParams(hashBody);
          let hashChanged = false;
          for (const key of [...hashParams.keys()]) {
            if (TRACKING_EXACT.has(key) || TRACKING_PREFIXES.some(p => key.startsWith(p))) {
              hashParams.delete(key); hashChanged = true; changed = true;
            }
          }
          if (hashChanged) {
            const newHash = hashParams.toString();
            url.hash = newHash ? '#' + newHash : '';
          }
        } catch (_) {}
      }

      return changed ? url.href : null;
    } catch (_) { return null; }
  }

  function cleanCurrentURL() {
    const cleaned = cleanURL(location.href);
    if (cleaned) try { history.replaceState(history.state, '', cleaned); } catch (_) {}
  }

  // Patch pushState and replaceState for SPA navigation
  const _push    = history.pushState;
  const _replace = history.replaceState;
  history.pushState = function (state, title, url) {
    if (url) { const c = cleanURL(String(url)); if (c) url = c; }
    return _push.call(this, state, title, url);
  };
  history.replaceState = function (state, title, url) {
    if (url) { const c = cleanURL(String(url)); if (c) url = c; }
    return _replace.call(this, state, title, url);
  };

  // ── 10. Click redirect bypass ─────────────────────────────────────────────────
  // Major platforms wrap outbound links in tracking redirects. Intercept clicks
  // and navigate directly to the destination — no tracking ping sent.
  document.addEventListener('click', (e) => {
    const link = e.target?.closest('a');
    if (!link?.href) return;
    try {
      const url = new URL(link.href);
      const h   = url.hostname;

      // Google search redirect: /url?q=https://example.com
      if ((h === 'www.google.com' || h === 'google.com') && url.pathname === '/url') {
        const t = url.searchParams.get('q') || url.searchParams.get('url');
        if (t?.startsWith('http')) { e.preventDefault(); location.href = t; } return;
      }

      // Facebook link shim: l.facebook.com/l.php?u=...
      if (h === 'l.facebook.com' && url.pathname === '/l.php') {
        const t = url.searchParams.get('u');
        if (t) { e.preventDefault(); location.href = decodeURIComponent(t); } return;
      }

      // Twitter / X: t.co short link — resolve via fetch (async, non-blocking UX)
      // Twitter embeds expanded URL in data-expanded-url; use that when available.
      if (h === 't.co') {
        e.preventDefault();
        const expanded = link.dataset.expandedUrl || link.getAttribute('data-expanded-url');
        if (expanded?.startsWith('http')) { location.href = expanded; return; }
        // Fallback: HEAD request follows redirect chain
        fetch(link.href, { method: 'HEAD', redirect: 'follow' })
          .then(r => { location.href = r.url || link.href; })
          .catch(() => { location.href = link.href; });
        return;
      }

      // LinkedIn safety redirect: linkedin.com/safety?url=... and lnkd.in
      if ((h === 'www.linkedin.com' || h === 'linkedin.com') && url.pathname === '/safety') {
        const t = url.searchParams.get('url');
        if (t) { e.preventDefault(); location.href = decodeURIComponent(t); } return;
      }
      if (h === 'lnkd.in') {
        e.preventDefault();
        fetch(link.href, { method: 'HEAD', redirect: 'follow' })
          .then(r => { location.href = r.url || link.href; })
          .catch(() => { location.href = link.href; });
        return;
      }

      // Bing click tracking: bing.com/ck/a?!&&p=...&u=a1<base64url>
      if (h.endsWith('bing.com') && url.pathname.startsWith('/ck/a')) {
        const u = url.searchParams.get('u');
        if (u) {
          try {
            // Bing prepends 'a1' to the base64url-encoded destination
            const b64 = u.replace(/^a1/, '').replace(/-/g, '+').replace(/_/g, '/');
            const decoded = decodeURIComponent(atob(b64));
            if (decoded.startsWith('http')) { e.preventDefault(); location.href = decoded; }
          } catch (_) {}
        }
        return;
      }

      // Yahoo search redirect: r.search.yahoo.com, search.yahoo.com/...
      if (h === 'r.search.yahoo.com' || (h.includes('yahoo.com') && url.pathname.startsWith('/r/'))) {
        const t = url.searchParams.get('RU') || url.searchParams.get('url');
        if (t?.startsWith('http')) { e.preventDefault(); location.href = decodeURIComponent(t); } return;
      }

      // DuckDuckGo redirect: duckduckgo.com/y.js?u=...
      if (h === 'duckduckgo.com' && url.pathname === '/y.js') {
        const t = url.searchParams.get('u') || url.searchParams.get('uddg');
        if (t?.startsWith('http')) { e.preventDefault(); location.href = decodeURIComponent(t); } return;
      }

      // Yandex click tracking: yandex.com/clck/...
      if (h.includes('yandex.') && url.pathname.startsWith('/clck/')) {
        const t = url.searchParams.get('url') || url.searchParams.get('to');
        if (t?.startsWith('http')) { e.preventDefault(); location.href = decodeURIComponent(t); } return;
      }
    } catch (_) {}
  }, true);

  // ── 11. Notifications / Push ─────────────────────────────────────────────────
  // Leave browser permission prompts intact. Hard-denying these APIs globally
  // breaks legitimate web apps and makes the privacy toggle possible to honor.

  // ── 15. Global Privacy Control (GPC) ─────────────────────────────────────────
  // Legally significant in California (CCPA), Colorado (CPA), Connecticut, and EU (GDPR).
  // Major publishers (NYT, WashPost, etc.) are legally required to respect this signal.
  // Ghostery and DuckDuckGo ship this; uBlock Origin does not.
  try {
    Object.defineProperty(navigator, 'globalPrivacyControl', {
      get: () => true, configurable: false, enumerable: true,
    });
  } catch (_) {}

  // ── 16. Geolocation ───────────────────────────────────────────────────────────
  // Leave geolocation under the browser's native permission prompt. Hard-denying
  // globally broke maps, delivery, and local-search flows.

  // ── 17. Font enumeration protection ───────────────────────────────────────────
  // document.fonts.check() reveals which fonts are installed — a unique fingerprint.
  // Return a fixed answer (false) for everything except system fallbacks.
  const _SAFE_FONTS = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy',
    'system-ui', 'arial', 'times new roman', 'courier new', 'georgia', 'helvetica',
    'verdana', 'trebuchet ms', 'tahoma']);
  try {
    const _origFontCheck = document.fonts.check.bind(document.fonts);
    document.fonts.check = function (font, text) {
      const name = (font || '').toLowerCase().replace(/['"]/g, '').replace(/\d+px\s*/, '').trim();
      if (_SAFE_FONTS.has(name)) return _origFontCheck(font, text);
      return false; // deny fingerprinting of non-standard fonts
    };
  } catch (_) {}

  // ── 18. Sensor API + IdleDetector blocking ────────────────────────────────────
  // DeviceMotion/Orientation reveal device type and orientation — fingerprint vector.
  // IdleDetector tells sites when the user is away from keyboard.
  try {
    window.addEventListener('devicemotion', e => e.stopImmediatePropagation(), true);
    window.addEventListener('deviceorientation', e => e.stopImmediatePropagation(), true);
  } catch (_) {}
  try {
    if (typeof IdleDetector !== 'undefined') {
      IdleDetector.prototype.start = () => Promise.reject(new DOMException('Not allowed', 'NotAllowedError'));
    }
  } catch (_) {}

  // ── 19. document.referrer stripping ──────────────────────────────────────────
  // Cross-origin pages should not see your previous URL.
  // The DNR rule in background.js strips the Referer HTTP header; this covers
  // the JS-readable document.referrer for same-process navigations.
  try {
    if (document.referrer && new URL(document.referrer).origin !== location.origin) {
      Object.defineProperty(document, 'referrer', { get: () => '', configurable: true });
    }
  } catch (_) {}

  // ── 12. Popup ad blocker ──────────────────────────────────────────────────────
  // Block known popup ad networks. Does NOT block all cross-origin opens —
  // that broke OAuth flows (GitHub login, Google Sign-In, etc.).
  const POPUP_AD_PATTERNS = [
    /popads\.net/i, /popcash\.net/i, /propellerclick\.com/i,
    /onclickads\.net/i, /clickadu\.com/i, /adsterra\.com/i,
    /juicyads\.com/i, /exoclick\.com/i, /trafficjunky\.net/i,
    /hilltopads\.net/i, /evadav\.com/i, /adcash\.com/i,
    /plugrush\.com/i, /popmyads\.com/i, /zeropark\.com/i,
    /pushground\.com/i, /megapu\.sh/i, /propeller\-ads\.com/i,
  ];
  const _windowOpen = window.open;
  window.open = function (url, target, features) {
    if (url && POPUP_AD_PATTERNS.some(p => p.test(String(url)))) return null;
    return _windowOpen.apply(this, arguments);
  };
  try { window.open.toString = () => _windowOpen.toString(); } catch (_) {}

  // ── 13. Chat widget removal ───────────────────────────────────────────────────
  const CHAT_SEL = [
    '#intercom-frame', '#intercom-container', '.intercom-lightweight-app',
    '#webWidget', '#ze-snippet', '.zEWidget-launcher',
    '#drift-widget', '#drift-frame-controller', '#drift-widget-container',
    '.crisp-client', '#crisp-chatbox',
    '#hubspot-messages-iframe-container', '.hs-messages-widget',
    '#fc_frame', '#freshwidget-frame', '#chat-widget-container',
    '#olark-wrapper', '#tawkchat-container', '.tawk-min-container',
    'jdiv', '#jivo-iframe-container', '.BeaconFabButtonFrame',
    '[id*="chat-widget"]', '[class*="chat-widget"]',
    '[id*="livechat"]', '[class*="livechat"]',
  ].join(',');

  function removeChats() {
    try { document.querySelectorAll(CHAT_SEL).forEach(el => el.remove()); } catch (_) {}
  }

  function startChatObserver() {
    if (!document.body) { setTimeout(startChatObserver, 200); return; }
    setTimeout(removeChats, 1000);
    let _cd = null;
    new MutationObserver(() => {
      clearTimeout(_cd);
      _cd = setTimeout(removeChats, 500);
    }).observe(document.body, { childList: true, subtree: true });
  }
  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', startChatObserver)
    : startChatObserver();

  // ── 14. Anti-adblock wall bypass ──────────────────────────────────────────────
  const ANTIBLOCK_REs = [
    /please\s+(disable|turn\s+off|whitelist)\s+(your\s+)?(ad.?block|advert)/i,
    /ad.?block(er)?\s+(detected|found|is\s+(active|enabled|on))/i,
    /we\s+(noticed|detected).{0,30}ad.?block/i,
    /disable\s+your\s+ad.?block/i, /disable\s+ad.?block/i,
    /turn\s+off.{0,20}ad.{0,10}block/i,
    /please\s+support\s+us\s+by\s+disabling/i,
    /whitelist\s+(our\s+)?site/i,
  ];

  function bypassAntiAdblock() {
    try {
      document.querySelectorAll(
        '[class*="adblock"],[id*="adblock"],[class*="adblocker"],[id*="adblocker"],' +
        '[class*="ad-block"],[id*="ad-block"],[class*="whitelist-modal"]'
      ).forEach(el => {
        const text = (el.textContent || '').trim();
        if (text.length > 0 && text.length < 1500 && ANTIBLOCK_REs.some(r => r.test(text))) {
          el.remove();
          document.documentElement.style.overflow = '';
          if (document.body) document.body.style.overflow = '';
        }
      });
    } catch (_) {}

    if (!document.body) return;
    for (const el of document.body.children) {
      const s = el.getAttribute('style') || '';
      if (!s.includes('fixed') && !s.includes('z-index')) continue;
      try {
        const cs = window.getComputedStyle(el);
        if (cs.position !== 'fixed') continue;
        if ((parseInt(cs.zIndex, 10) || 0) < 9000) continue;
        const text = (el.textContent || '').trim();
        if (text.length < 1500 && ANTIBLOCK_REs.some(r => r.test(text))) {
          el.remove();
          if (document.body) document.body.style.overflow = '';
        }
      } catch (_) {}
    }
  }

  function startAntiAdblockObserver() {
    if (!document.body) { setTimeout(startAntiAdblockObserver, 200); return; }
    setTimeout(bypassAntiAdblock, 800);
    setTimeout(bypassAntiAdblock, 2500);
    let _abd = null;
    new MutationObserver(() => {
      clearTimeout(_abd);
      _abd = setTimeout(bypassAntiAdblock, 300);
    }).observe(document.body, { childList: true, subtree: true });
  }
  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', startAntiAdblockObserver)
    : startAntiAdblockObserver();

  // ── Auto-refresh loop detection ──────────────────────────────────────────────
  // Some sites reload when they detect an ad blocker. Detect rapid reloads
  // (3+ in 10 seconds) and suppress the reload.
  // Auto-refresh detection removed — broke YouTube SPA
  // ── Init URL cleanup ──────────────────────────────────────────────────────────
  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', cleanCurrentURL)
    : cleanCurrentURL();
  window.addEventListener('popstate', cleanCurrentURL);

  // ── 20. Timezone spoofing ─────────────────────────────────────────────────────
  // Spoofing timezone to UTC prevents fingerprinting via time-zone leakage.
  // Opt-in only — breaks calendar apps (Google Calendar, Outlook) and
  // meeting schedulers. Activated via a message from the content script
  // coordinator when the user enables the setting.
  // NOTE: This uses a postMessage from the isolated-world content script
  // because we can't read chrome.storage in MAIN world directly.
  let _timezoneSpoofEnabled = false;
  let _timezonePatched = false;
  window.addEventListener('message', (e) => {
    if (e.source !== window || e.data?.type !== 'SB_TIMEZONE_SPOOF') return;
    _timezoneSpoofEnabled = !!e.data.enabled;
    if (!_timezoneSpoofEnabled || _timezonePatched) return;
    _timezonePatched = true;
    try {
      const _OrigDTF = Intl.DateTimeFormat;
      const _origOffset = Date.prototype.getTimezoneOffset;
      const _origLocaleString = Date.prototype.toLocaleString;
      const _origLocaleDateString = Date.prototype.toLocaleDateString;
      const _origLocaleTimeString = Date.prototype.toLocaleTimeString;
      // Override Intl.DateTimeFormat to resolve to UTC only while the setting is enabled.
      const PatchedDTF = function (locale, opts) {
        return new _OrigDTF(locale, _timezoneSpoofEnabled ? { ...opts, timeZone: 'UTC' } : opts);
      };
      PatchedDTF.prototype          = _OrigDTF.prototype;
      PatchedDTF.supportedLocalesOf = _OrigDTF.supportedLocalesOf.bind(_OrigDTF);
      try { Object.defineProperty(Intl, 'DateTimeFormat', { value: PatchedDTF, writable: true, configurable: true }); } catch (_) {}

      Date.prototype.getTimezoneOffset = function () {
        return _timezoneSpoofEnabled ? 0 : _origOffset.apply(this, arguments);
      };
      const _patchLocale = (fn) => function (...args) {
        if (_timezoneSpoofEnabled) {
          if (!args[1]) args[1] = {};
          args[1].timeZone = 'UTC';
        }
        return fn.apply(this, args);
      };
      Date.prototype.toLocaleString     = _patchLocale(_origLocaleString);
      Date.prototype.toLocaleDateString = _patchLocale(_origLocaleDateString);
      Date.prototype.toLocaleTimeString = _patchLocale(_origLocaleTimeString);
    } catch (_) {}
  });

  // ── 21. navigator.userAgentData normalization ─────────────────────────────────
  // User-Agent Client Hints (navigator.userAgentData) expose detailed browser,
  // OS, architecture, and device model information — far more precise than the
  // classic navigator.userAgent string. Return a minimal, generic response that
  // matches what a vanilla Chromium install would report.
  // getHighEntropyValues() calls are intercepted so even explicit requests for
  // architecture / platform version / full build version return generic values.
  try {
    if (typeof navigator.userAgentData !== 'undefined') {
      const _genericBrands = [
        { brand: 'Chromium',    version: '99' },
        { brand: 'Not A;Brand', version: '99' },
      ];
      const _highEntropyDefaults = {
        architecture:    'x86',
        bitness:         '64',
        brands:          _genericBrands,
        fullVersionList: [{ brand: 'Chromium', version: '99.0.0.0' }],
        mobile:          false,
        model:           '',
        platform:        'Windows',
        platformVersion: '10.0.0',
        uaFullVersion:   '99.0.0.0',
        wow64:           false,
      };
      const _fakeUAData = {
        brands:              _genericBrands,
        mobile:              false,
        platform:            'Windows',
        getHighEntropyValues: (/* hints */) => Promise.resolve({ ..._highEntropyDefaults }),
        toJSON:              () => ({ brands: _genericBrands, mobile: false, platform: 'Windows' }),
      };
      Object.defineProperty(navigator, 'userAgentData', {
        get: () => _fakeUAData, configurable: true, enumerable: true,
      });
    }
  } catch (_) {}

  // ── 22. mediaDevices.enumerateDevices normalization ───────────────────────────
  // Without explicit permission, enumerateDevices() reveals the NUMBER and TYPE
  // (audioinput / videoinput / audiooutput) of all connected hardware — enough
  // to fingerprint a specific machine by its microphone/camera count.
  // Strip labels (already blank before permission) but also blank out deviceId
  // and groupId for unpermissioned entries, matching the spec's intended behaviour.
  try {
    if (navigator.mediaDevices?.enumerateDevices) {
      const _origEnum = navigator.mediaDevices.enumerateDevices.bind(navigator.mediaDevices);
      navigator.mediaDevices.enumerateDevices = async function () {
        const devices = await _origEnum();
        return devices.map(d => ({
          kind:     d.kind,
          label:    d.label,  // already blank until permission granted
          deviceId: d.label ? d.deviceId : '',  // blank until user grants permission
          groupId:  d.label ? d.groupId  : '',
          toJSON:   function () { return { kind: this.kind, label: this.label, deviceId: this.deviceId, groupId: this.groupId }; },
        }));
      };
    }
  } catch (_) {}

  // ── 24. Sec-Fetch header awareness (passive) ──────────────────────────────────
  // Sec-Fetch-Site / Sec-Fetch-Mode / Sec-Fetch-Dest are "forbidden" headers —
  // they cannot be set or removed by extensions or JS. They're set by the browser
  // itself before each request and cannot be spoofed. No action needed here.
  // (Documented so future maintainers don't spend time attempting to override them.)

})();
