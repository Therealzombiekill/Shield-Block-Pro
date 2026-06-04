/**
 * ShieldBlock Pro — Browser Compatibility Shim
 *
 * Firefox natively exposes `browser.*` (Promise-based) and a legacy
 * `chrome.*` shim (callback-based in older versions). Chrome only has
 * `chrome.*` (Promise-based in MV3). This shim ensures `chrome.*` is
 * always the Promise-based variant regardless of browser.
 *
 * Must be loaded/imported before any other extension code.
 */
(function () {
  // If running in Firefox (browser.* exists) and chrome.* is absent or
  // is the legacy callback shim, swap in browser.* instead.
  if (typeof globalThis.chrome === 'undefined' && typeof globalThis.browser !== 'undefined') {
    globalThis.chrome = globalThis.browser;
    return;
  }

  // Firefox also exposes chrome.* but it may be callback-based in older builds.
  // Prefer browser.* when both exist so we get native Promise support.
  if (typeof globalThis.browser !== 'undefined' && typeof globalThis.chrome !== 'undefined') {
    // Only replace if browser.* has the core namespaces we rely on
    if (typeof globalThis.browser.storage !== 'undefined') {
      globalThis.chrome = globalThis.browser;
    }
  }

  // Mid-session global pause flag — content scripts check this in observer ticks.
  globalThis.__sbGlobalPause = false;
  if (typeof globalThis.chrome?.runtime?.onMessage !== 'undefined') {
    globalThis.chrome.runtime.onMessage.addListener((msg) => {
      if (msg?.type === 'GLOBAL_PAUSE') globalThis.__sbGlobalPause = true;
      if (msg?.type === 'GLOBAL_RESUME') globalThis.__sbGlobalPause = false;
    });
  }

  // Content scripts cannot use ES import — mirror trusted-sites.js PRIVACY_URL_CLEAN_SKIP_HOSTS
  const _privacySkipHosts = new Set([
    'analytics.google.com', 'tagmanager.google.com',
    'github.com', 'gist.github.com', 'github.io',
    'google.com', 'accounts.google.com',
    'drive.google.com', 'docs.google.com', 'sheets.google.com', 'slides.google.com',
    'mail.google.com', 'calendar.google.com', 'meet.google.com', 'classroom.google.com',
    'chat.google.com', 'keep.google.com', 'photos.google.com',
    'drive.usercontent.google.com',
    'amazon.com', 'amazon.co.uk', 'amazon.de', 'amazon.ca', 'amazon.com.au',
    'amazon.co.jp', 'amazon.in', 'amazon.fr', 'amazon.es', 'amazon.it',
    'amazon.com.mx', 'amazon.com.br', 'amazon.nl', 'amazon.pl', 'amazon.se', 'amazon.sg',
  ]);
  // Complete Amazon storefront + first-party CDN apexes (suffix-matched).
  // Mirrors AMAZON_SHOPPING_HOSTS in trusted-sites.js — keep in sync.
  const _amazonHosts = new Set([
    'amazon.com', 'amazon.co.uk', 'amazon.de', 'amazon.ca', 'amazon.com.au',
    'amazon.co.jp', 'amazon.in', 'amazon.fr', 'amazon.es', 'amazon.it',
    'amazon.com.mx', 'amazon.com.br', 'amazon.nl', 'amazon.pl', 'amazon.se', 'amazon.sg',
    'amazon.ae', 'amazon.com.tr', 'amazon.sa', 'amazon.eg', 'amazon.com.be', 'amazon.cl', 'amazon.com.co',
    'media-amazon.com', 'ssl-images-amazon.com',
  ]);
  globalThis.__sbIsAmazonShoppingHost = function (host) {
    // Suffix-match (smile.amazon.com → amazon.com). Previously host.includes('amazon.')
    // false-matched notamazon.com / amazon.evil.com, disabling protections on them.
    return globalThis.__sbHostMatchesSet(host, _amazonHosts);
  };
  globalThis.__sbHostMatchesSet = function (host, domainSet) {
    if (!host) return false;
    host = host.replace(/^www\./, '').toLowerCase();
    if (domainSet.has(host)) return true;
    const parts = host.split('.');
    for (let i = 1; i < parts.length; i++) {
      if (domainSet.has(parts.slice(i).join('.'))) return true;
    }
    return false;
  };
  globalThis.__sbShouldSkipPrivacyUrlClean = function (host) {
    return globalThis.__sbHostMatchesSet(host, _privacySkipHosts);
  };
})();
