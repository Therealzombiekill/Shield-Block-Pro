/**
 * ShieldBlock Pro — Trusted sites (single source of truth)
 *
 * Used by filter-parser (protected domains, Google API initiator exclusions),
 * background (safe-browsing allowlist). Content scripts use browser-compat.js
 * (__sbShouldSkipPrivacyUrlClean) — keep PRIVACY_URL_CLEAN_SKIP_HOSTS in sync there.
 * Static rules in rules/*.json should mirror SHARED_GOOGLE_API_EXCLUDED_INITIATORS
 * for apis.google.com / boq.google.com entries.
 */

export const PROTECTED_DOMAINS = new Set([
  // YouTube — playback
  'youtube.com', 'youtu.be', 'youtube-nocookie.com',
  'ytimg.com', 'yt3.ggpht.com', 'googlevideo.com',
  'gvt1.com', 'gvt2.com', 'gvt3.com',
  'googleapis.com', 'gstatic.com', 'ggpht.com',
  'youtubei.googleapis.com',
  // Twitch
  'twitch.tv', 'twitchsvc.net', 'jtvnw.net', 'twitchapps.com',
  // CDNs
  'cloudflare.com', 'cloudfront.net', 'fastly.net',
  'akamaihd.net', 'akamaized.net', 'edgecastcdn.net',
  // Browser / libs
  'ajax.googleapis.com', 'fonts.googleapis.com', 'fonts.gstatic.com',
  'jquery.com', 'bootstrapcdn.com', 'jsdelivr.net', 'unpkg.com',
  // GitHub
  'github.com', 'githubassets.com', 'githubusercontent.com', 'ghcr.io',
  'raw.githubusercontent.com', 'gist.github.com', 'github.io',
  // Google Workspace / sign-in
  'google.com', 'drive.google.com', 'docs.google.com', 'sheets.google.com',
  'slides.google.com', 'mail.google.com', 'accounts.google.com',
  'calendar.google.com', 'meet.google.com', 'classroom.google.com',
  'drive.usercontent.google.com', 'chat.google.com', 'keep.google.com', 'photos.google.com',
  // GA / GTM dashboards (first-party apps)
  'analytics.google.com', 'tagmanager.google.com',
  // Amazon shopping (first-party APIs — blocking breaks checkout/search)
  'amazon.com', 'amazon.co.uk', 'amazon.de', 'amazon.ca', 'amazon.com.au',
  'amazon.co.jp', 'amazon.in', 'amazon.fr', 'amazon.es', 'amazon.it',
  'amazon.com.mx', 'amazon.com.br', 'amazon.nl', 'amazon.pl', 'amazon.se', 'amazon.sg',
  'media-amazon.com', 'ssl-images-amazon.com',
]);

/** Regional Amazon storefronts — allowlisted in v2.13+ (no Amazon-specific scripts). */
export const AMAZON_STABILITY_DOMAINS = [
  'amazon.com', 'www.amazon.com',
  'amazon.co.uk', 'www.amazon.co.uk',
  'amazon.de', 'www.amazon.de',
  'amazon.ca', 'www.amazon.ca',
  'amazon.com.au', 'www.amazon.com.au',
  'amazon.co.jp', 'www.amazon.co.jp',
  'amazon.in', 'www.amazon.in',
  'amazon.fr', 'www.amazon.fr',
  'amazon.es', 'www.amazon.es',
  'amazon.it', 'www.amazon.it',
  'amazon.com.mx', 'www.amazon.com.mx',
  'amazon.com.br', 'www.amazon.com.br',
  'amazon.nl', 'www.amazon.nl',
  'amazon.pl', 'www.amazon.pl',
  'amazon.se', 'www.amazon.se',
  'amazon.sg', 'www.amazon.sg',
  'amazon.ae', 'www.amazon.ae',
  'amazon.com.tr', 'www.amazon.com.tr',
  'amazon.sa', 'www.amazon.sa',
  'amazon.eg', 'www.amazon.eg',
  'amazon.com.be', 'www.amazon.com.be',
  'amazon.cl', 'www.amazon.cl',
  'amazon.com.co', 'www.amazon.com.co',
];

/** Never block shared Google endpoints when the page is one of these initiators. */
export const SHARED_GOOGLE_API_EXCLUDED_INITIATORS = [
  'youtube.com', 'youtu.be', 'youtube-nocookie.com', 'music.youtube.com', 'tv.youtube.com',
  'github.com', 'www.github.com', 'api.github.com', 'gist.github.com',
  'githubassets.com', 'githubusercontent.com',
  'google.com', 'www.google.com',
  'drive.google.com', 'docs.google.com', 'sheets.google.com', 'slides.google.com',
  'mail.google.com', 'accounts.google.com', 'calendar.google.com', 'meet.google.com',
  'classroom.google.com', 'chat.google.com', 'keep.google.com', 'photos.google.com',
  'analytics.google.com', 'tagmanager.google.com',
];

/** Malware feeds list paths on these hosts — never block at apex/domain granularity. */
export const SB_DOMAIN_ALLOWLIST = new Set([
  'github.com', 'githubassets.com', 'githubusercontent.com', 'raw.githubusercontent.com',
  'gist.github.com', 'github.io',
  'drive.google.com', 'docs.google.com', 'drive.usercontent.google.com', 'storage.googleapis.com',
  'dropbox.com', 'dropboxusercontent.com', 'mega.nz', 'mediafire.com',
  'cdn.discordapp.com', 'media.discordapp.net', 't.me',
  'google.com', 'gstatic.com', 'googleusercontent.com', 'youtube.com', 'youtu.be',
  'analytics.google.com', 'tagmanager.google.com',
  'microsoft.com', 'live.com', 'office.com', 'sharepoint.com', 'apple.com', 'icloud.com',
  'amazon.com', 'amazon.co.uk', 'amazon.de', 'amazon.ca', 'amazon.com.au', 'amazon.co.jp',
  'amazon.in', 'amazon.fr', 'amazon.es', 'amazon.it', 'amazon.com.mx', 'amazon.com.br',
  'amazon.nl', 'amazon.pl', 'amazon.se', 'amazon.sg',
  'cloudflare.com', 'facebook.com', 'instagram.com', 'x.com', 'twitter.com',
  'linkedin.com', 'reddit.com', 'wikipedia.org', 'mozilla.org', 'anthropic.com', 'claude.ai',
]);

/** Do not strip query/hash params on these hosts (breaks SPA, OAuth, file URLs). */
export const PRIVACY_URL_CLEAN_SKIP_HOSTS = new Set([
  'analytics.google.com', 'tagmanager.google.com',
  'github.com', 'gist.github.com', 'github.io',
  'google.com', 'accounts.google.com',
  'drive.google.com', 'docs.google.com', 'sheets.google.com', 'slides.google.com',
  'mail.google.com', 'calendar.google.com', 'meet.google.com', 'classroom.google.com',
  'chat.google.com', 'keep.google.com', 'photos.google.com',
  'drive.usercontent.google.com',
  ...AMAZON_STABILITY_DOMAINS,
]);

export function hostMatchesSet(host, domainSet) {
  if (!host) return false;
  host = host.replace(/^www\./, '').toLowerCase();
  if (domainSet.has(host)) return true;
  const parts = host.split('.');
  for (let i = 1; i < parts.length; i++) {
    if (domainSet.has(parts.slice(i).join('.'))) return true;
  }
  return false;
}

export function isDomainProtected(filter) {
  const bare = filter.replace(/^\|\|/, '').split(/[/?^]/)[0].toLowerCase();
  if (PROTECTED_DOMAINS.has(bare)) return true;
  const parts = bare.split('.');
  for (let i = 1; i < parts.length; i++) {
    if (PROTECTED_DOMAINS.has(parts.slice(i).join('.'))) return true;
  }
  return false;
}

export function isSafeBrowsingAllowlisted(host) {
  return hostMatchesSet(host, SB_DOMAIN_ALLOWLIST);
}

export function shouldSkipPrivacyUrlClean(host) {
  return hostMatchesSet(host, PRIVACY_URL_CLEAN_SKIP_HOSTS) || isAmazonShoppingHost(host);
}

/** Any Amazon storefront host (regional TLDs and subdomains like smile.amazon.com). */
export function isAmazonShoppingHost(host) {
  // Suffix-match against the known Amazon storefront/CDN apexes. hostMatchesSet already
  // covers subdomains (smile.amazon.com → amazon.com). Previously this used
  // host.includes('amazon.'), which false-matched unrelated sites (notamazon.com,
  // amazon.evil.com), silently disabling cookie/privacy/removeparam protection on them.
  return hostMatchesSet(host, AMAZON_SHOPPING_HOSTS);
}

/** Apex domains for DNR excludedInitiatorDomains on static Amazon ad rules. */
export const AMAZON_INITIATOR_EXCLUSIONS = [
  'amazon.com', 'amazon.co.uk', 'amazon.de', 'amazon.ca', 'amazon.com.au',
  'amazon.co.jp', 'amazon.in', 'amazon.fr', 'amazon.es', 'amazon.it',
  'amazon.com.mx', 'amazon.com.br', 'amazon.nl', 'amazon.pl', 'amazon.se', 'amazon.sg',
  'amazon.ae', 'amazon.com.tr', 'amazon.sa', 'amazon.eg', 'amazon.com.be', 'amazon.cl', 'amazon.com.co',
];

/** Storefront + first-party CDN apexes, suffix-matched (covers subdomains via hostMatchesSet). */
const AMAZON_SHOPPING_HOSTS = new Set([
  ...AMAZON_INITIATOR_EXCLUSIONS,
  'media-amazon.com', 'ssl-images-amazon.com',
]);

/** Manifest exclude_matches — keep in sync with content-general exclusions. */
export const AMAZON_EXCLUDE_MATCHES = [
  '*://*.amazon.com/*',
  '*://*.amazon.co.uk/*',
  '*://*.amazon.de/*',
  '*://*.amazon.ca/*',
  '*://*.amazon.com.au/*',
  '*://*.amazon.co.jp/*',
  '*://*.amazon.in/*',
  '*://*.amazon.fr/*',
  '*://*.amazon.es/*',
  '*://*.amazon.it/*',
  '*://*.amazon.com.mx/*',
  '*://*.amazon.com.br/*',
  '*://*.amazon.nl/*',
  '*://*.amazon.pl/*',
  '*://*.amazon.se/*',
  '*://*.amazon.sg/*',
  '*://*.amazon.ae/*',
  '*://*.amazon.com.tr/*',
  '*://*.amazon.sa/*',
  '*://*.amazon.eg/*',
  '*://*.amazon.com.be/*',
  '*://*.amazon.cl/*',
  '*://*.amazon.com.co/*',
];
