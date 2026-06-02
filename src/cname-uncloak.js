/**
 * ShieldBlock Pro — CNAME uncloaking (Firefox only)
 *
 * First-party CNAME cloaking hides a third-party tracker behind a subdomain of
 * the site you're visiting (e.g. metrics.example.com is a CNAME for a tracker's
 * domain). DNR/urlFilter rules can't see through that — the request looks
 * first-party. uBO solves this on Firefox with browser.dns.resolve() + a blocking
 * webRequest listener; Chrome MV3 has neither a DNS API nor blocking webRequest,
 * so this whole feature is Firefox-only and a no-op everywhere else.
 *
 * The matching logic is pure and unit-tested (test/cname.test.js). The installer
 * takes its browser APIs by injection so it can run under Node in tests and stays
 * a no-op unless the host actually exposes dns + blocking webRequest.
 */

// Curated seed list of base domains used by first-party CNAME cloaking services.
// Sourced from public CNAME-tracker research and uBO's cname handling. Matching
// is suffix-based, so a base domain here also covers all of its subdomains.
export const KNOWN_CNAME_TRACKERS = new Set([
  // AT Internet / Piano Analytics
  'at-o.net', 'ati-host.net', 'atinternet.com', 'xiti.com',
  // Adobe Experience Cloud
  'omtrdc.net', 'demdex.net', '2o7.net', 'everesttech.net', 'adobedc.net', 'hitbox.com',
  // Criteo
  'criteo.com', 'criteo.net', 'dnsdelegation.io',
  // Eulerian
  'eulerian.net',
  // Commanders Act
  'tagcommander.com', 'commander1.com',
  // Keyade
  'keyade.com',
  // Webtrekk / Mapp
  'wt-eu02.net', 'webtrekk.net', 'mateti.net', 'mpnl.net',
  // Other documented cloaking trackers
  'monetate.net', 'online-metrix.net', 'wizaly.com', 'affex.org', 'intentmedia.net',
  'tracedock.com', 'gnst.net', 'mxptint.net', 'storetail.io', 'imrworldwide.com',
  'ojrq.net', 'ywxi.net', 'act-on.net', 'partners.tremorhub.com', 'sc-static.net',
]);

// Public suffixes that take two labels, so the registrable domain is the last
// three labels (e.g. shop.example.co.uk → example.co.uk). Not exhaustive — a full
// PSL is overkill here; this covers the common multi-label TLDs.
const TWO_LABEL_TLDS = new Set([
  'co.uk', 'org.uk', 'gov.uk', 'ac.uk', 'co.jp', 'or.jp', 'ne.jp',
  'com.au', 'net.au', 'org.au', 'co.nz', 'com.br', 'com.cn', 'com.mx',
  'co.in', 'co.za', 'com.tr', 'com.tw', 'co.kr', 'com.sg', 'com.hk',
]);

/** Lowercased hostname from a URL string, or '' if it can't be parsed. */
export function hostOf(url) {
  try { return new URL(url).hostname.toLowerCase(); } catch (_) { return ''; }
}

/** Registrable ("base") domain, honoring the common two-label public suffixes. */
export function baseDomain(host) {
  if (!host) return '';
  const parts = host.replace(/\.$/, '').split('.');
  if (parts.length <= 2) return parts.join('.');
  const lastTwo = parts.slice(-2).join('.');
  const take = TWO_LABEL_TLDS.has(lastTwo) ? 3 : 2;
  return parts.slice(-take).join('.');
}

/**
 * If a canonical name belongs to a known CNAME tracker, return the matched base
 * domain; otherwise null. Walks the suffix chain so foo.bar.criteo.com matches.
 */
export function canonicalIsTracker(canonical, trackers = KNOWN_CNAME_TRACKERS) {
  if (!canonical) return null;
  const host = canonical.toLowerCase().replace(/\.$/, '');
  const parts = host.split('.');
  for (let i = 0; i < parts.length - 1; i++) {
    const suffix = parts.slice(i).join('.');
    if (trackers.has(suffix)) return suffix;
  }
  return null;
}

/**
 * True only for the CNAME-cloaking shape: reqHost is a *subdomain of the same
 * registrable domain* as the page. Same-host and cross-site requests are skipped
 * (DNR already covers cross-site; same-host isn't a disguised third party).
 */
export function isCloakingCandidate(reqHost, docHost) {
  if (!reqHost || !docHost || reqHost === docHost) return false;
  const base = baseDomain(reqHost);
  return base !== '' && base === baseDomain(docHost) && reqHost !== base;
}

function isWhitelisted(host, whitelist = []) {
  return whitelist.some(d => host === d || host.endsWith('.' + d));
}

/**
 * Wire the Firefox blocking webRequest listener. Returns the installed listener
 * (for tests / teardown) or null when the environment can't support it.
 *
 * env = { isFirefox, webRequest, dns, getSettings, onBlocked, ttlMs }
 */
export function installCnameUncloaking(env = {}) {
  const { isFirefox, webRequest, dns, getSettings, onBlocked, ttlMs = 60 * 60 * 1000 } = env;
  if (!isFirefox) return null;
  if (!dns || typeof dns.resolve !== 'function') return null;
  if (!webRequest || !webRequest.onBeforeRequest || typeof webRequest.onBeforeRequest.addListener !== 'function') {
    return null;
  }

  const cache = new Map(); // reqHost -> { tracker: string|'', t: number }

  const listener = async (details) => {
    try {
      const settings = (await getSettings?.()) ?? {};
      if (settings.globalPause || settings.cnameUncloak === false) return {};

      const reqHost = hostOf(details.url);
      const docHost = hostOf(details.documentUrl || details.originUrl || '');
      if (!isCloakingCandidate(reqHost, docHost)) return {};
      if (isWhitelisted(docHost, settings.whitelist ?? [])) return {};

      const cached = cache.get(reqHost);
      if (cached && (Date.now() - cached.t) < ttlMs) {
        if (cached.tracker) { onBlocked?.(cached.tracker, reqHost, details); return { cancel: true }; }
        return {};
      }

      let canonical = '';
      try {
        const rec = await dns.resolve(reqHost, ['canonical']);
        canonical = rec?.canonicalName ?? '';
      } catch (_) { /* resolution failed — treat as clean */ }

      const tracker = canonical ? canonicalIsTracker(canonical) : null;
      cache.set(reqHost, { tracker: tracker ?? '', t: Date.now() });
      if (tracker) { onBlocked?.(tracker, reqHost, details); return { cancel: true }; }
      return {};
    } catch (_) {
      return {}; // never break a request on our own error
    }
  };

  webRequest.onBeforeRequest.addListener(
    listener,
    { urls: ['http://*/*', 'https://*/*'] },
    ['blocking'],
  );
  return listener;
}
