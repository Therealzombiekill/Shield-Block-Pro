/**
 * ShieldBlock Pro — Filter List Parser v3.0
 *
 * Now parses:
 *   - DNR network block rules (||domain.com^, |http://…, and generic substring
 *     patterns like /ads/banner/* or -ad-300x250.)
 *   - DNR exception rules (@@…) → `allow` / `allowAllRequests` rules, so filter
 *     lists can unbreak sites the same way uBO honors them
 *   - $important → higher-priority block (beats same-band exceptions)
 *   - Global cosmetic rules (##.selector)
 *   - Domain-scoped cosmetic rules (example.com##.selector — incl. multi-domain
 *     a.com,b.com##.selector, fanned out per domain)
 *   - Scriptlet rules (example.com##+js(name, arg), incl. multi-domain)
 *   - $removeparam tracking-param strips
 */

import { isDomainProtected, SHARED_GOOGLE_API_EXCLUDED_INITIATORS } from './trusted-sites.js';

const RESOURCE_TYPE_MAP = {
  'script':         'script',
  'image':          'image',
  'stylesheet':     'stylesheet',
  'css':            'stylesheet',
  'xmlhttprequest': 'xmlhttprequest',
  'xhr':            'xmlhttprequest',
  'subdocument':    'sub_frame',
  'frame':          'sub_frame',
  'document':       'main_frame',
  'doc':            'main_frame',
  'media':          'media',
  'font':           'font',
  'websocket':      'websocket',
  'other':          'other',
  'ping':           'ping',
  'beacon':         'ping',
};

const DEFAULT_RESOURCE_TYPES = [
  'script', 'image', 'xmlhttprequest', 'sub_frame', 'media', 'font', 'stylesheet', 'other', 'ping',
];

const ALL_RESOURCE_TYPES = [
  'main_frame', 'sub_frame', 'script', 'image', 'stylesheet', 'object',
  'xmlhttprequest', 'ping', 'media', 'websocket', 'font', 'other',
];

// Options that change action semantics in ways we don't implement — a rule
// carrying one of these must be dropped, not silently broadened.
// ($popup needs window-open interception; $denyallow inverts initiator logic;
// $badfilter negates another rule; the rest rewrite responses/headers.)
const UNSUPPORTED_OPTION_NAMES = new Set([
  'redirect', 'redirect-rule', 'csp', 'replace', 'rewrite', 'header',
  'urltransform', 'permissions', 'cookie', 'popup', 'denyallow',
  'genericblock', 'ghide', 'generichide', 'ehide', 'elemhide', 'shide', 'specifichide',
]);

// Procedural pseudo-classes handled by content-procedural.js (not insertCSS)
const PROCEDURAL_MARKERS = [':has-text(', ':matches-css(', ':upward(', ':xpath('];

export function isProceduralCosmetic(selector) {
  return typeof selector === 'string' && PROCEDURAL_MARKERS.some(m => selector.includes(m));
}

// Truly unsupported — not implemented in insertCSS *or* the procedural engine.
// These must never reach the CSS path: one invalid selector can invalidate an
// entire injected stylesheet rule.
function hasUnsupportedPseudo(selector) {
  return (
    selector.includes(':nth-ancestor(')    ||
    selector.includes(':watch-attr(')      ||
    selector.includes(':style(')           ||
    selector.includes(':remove(')          ||
    selector.includes(':remove-attr(')     ||
    selector.includes(':remove-class(')    ||
    selector.includes(':matches-path(')    ||
    selector.includes(':matches-attr(')    ||
    selector.includes(':matches-prop(')    ||
    selector.includes(':min-text-length(') ||
    selector.includes(':others(')          ||
    selector.includes(':shadow(')          ||
    selector.includes('-abp-')             ||
    selector.includes('{ ')
  );
}

// Filter lists ship Unicode IDN domains (e.g. пример.рф), but the browser
// reports location.hostname — and matches DNR conditions — in punycode (xn--…).
// A rule keyed by the raw Unicode form would never match. ASCII domains return
// unchanged (fast path, no behavior change); conversion failures fall back to
// the original string so the caller's other guards still apply.
function toPunycodeDomain(domain) {
  if (/^[\x00-\x7F]*$/.test(domain)) return domain;
  try { return new URL('http://' + domain + '/').hostname || domain; }
  catch (_) { return domain; }
}

// Split scriptlet arguments on commas, honoring uBO escaping: a literal comma
// inside an argument is written as `\,` or `\x2c` (e.g. a /regex,with,commas/
// or a cookie value). A naive split(',') corrupts such multi-arg scriptlets.
// Split on unescaped commas only, then unescape back to literal commas.
function splitScriptletArgs(inner) {
  const parts = [];
  let cur = '';
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (c === '\\' && i + 1 < inner.length) { cur += c + inner[i + 1]; i++; continue; }
    if (c === ',') { parts.push(cur); cur = ''; continue; }
    cur += c;
  }
  parts.push(cur);
  return parts.map(s => s.trim().replace(/\\x2c/gi, ',').replace(/\\,/g, ','));
}

// Split an ABP domain prefix ("a.com,b.com,~c.com") into positive domains.
// Returns [] when nothing usable remains (pure negations, pipes, wildcards TLD).
function splitDomainPrefix(prefix, cap = 10) {
  const out = [];
  for (const raw of prefix.split(',')) {
    const d = raw.trim().toLowerCase();
    if (!d || d.startsWith('~') || d.includes('|') || d.includes('*')) continue;
    out.push(toPunycodeDomain(d));
    if (out.length >= cap) break;
  }
  return out;
}

// Looks like an ABP/uBO regex filter (/…/), not a literal path pattern.
function looksLikeRegexFilter(f) {
  return f.length > 2 && f.startsWith('/') && f.endsWith('/') &&
         /[\\()\[\]+?{}]|\.\*/.test(f);
}

function parseLine(line, idCounter) {
  try {
  line = line.trim();
  if (!line || line.startsWith('!') || line.startsWith('[') || line.startsWith('#!')) {
    return null;
  }

  // ── Cosmetic exception (unhide): example.com#@#.selector ───────────────────
  // Lists ship these to cancel hide rules that break specific sites. Collected
  // per-domain and subtracted from injected selectors at navigation time.
  const _unhideIdx = line.indexOf('#@#');
  if (_unhideIdx !== -1) {
    const prefix = line.slice(0, _unhideIdx).trim();
    const sel    = line.slice(_unhideIdx + 3).trim();
    if (sel.length < 2 || sel.length > 512) return null;
    if (hasUnsupportedPseudo(sel) || sel.startsWith('+js(')) return null;
    const domains = (!prefix || prefix === '*') ? ['*'] : splitDomainPrefix(prefix);
    if (!domains.length) return null;
    return { type: 'cosmetic-exception', domains, selector: sel };
  }

  // ── Extended cosmetic / snippet syntaxes we don't implement ─────────────────
  // #?# extended-css, #$# ABP snippet / AdGuard CSS-inject, #%# AdGuard JS,
  // $$ AdGuard HTML filtering. Must be skipped BEFORE the network path —
  // otherwise the generic-pattern fallback would turn them into garbage
  // substring rules.
  if (line.includes('#?#') || line.includes('#$#') ||
      line.includes('#%#') || line.includes('$$'))  return null;

  // ── Cosmetic / scriptlet filters (## separator) ────────────────────────────
  // BUG FIX: `!line.includes('$')` was too broad — it dropped valid cosmetic rules
  // containing CSS $= attribute selectors (e.g. ##[class$="-ad"], ##[src$=".gif"]).
  // The `$` that matters as a filter option separator only appears BEFORE `##`
  // (e.g. `||ad.com^$script` never has `##`). Any `$` after `##` is CSS syntax.
  const _hashIdx = line.indexOf('##');
  if (_hashIdx !== -1 && (line.indexOf('$') === -1 || line.indexOf('$') > _hashIdx)) {
    const idx = _hashIdx;

    const prefix   = line.slice(0, idx).trim();
    const rawAfter = line.slice(idx + 2).trim();

    // ── Scriptlet: example.com##+js(name, arg1, arg2) ─────────────────────
    if (rawAfter.startsWith('+js(') && rawAfter.endsWith(')')) {
      const inner = rawAfter.slice(4, -1).trim();
      const parts = splitScriptletArgs(inner);
      const [name, ...args] = parts;
      if (!name) return null;
      // '*' means apply to all domains; multi-domain prefixes fan out per domain
      const domains = (!prefix || prefix === '*') ? ['*'] : splitDomainPrefix(prefix);
      if (!domains.length) return null;
      return { type: 'scriptlet', domains, name, args };
    }

    // ── Domain-scoped cosmetic: example.com##.selector ────────────────────
    if (prefix && prefix !== '*') {
      if (rawAfter.length < 2 || rawAfter.length > 512) return null;
      if (hasUnsupportedPseudo(rawAfter)) return null;
      // Multi-domain rules (a.com,b.com##.sel) fan out one entry per domain;
      // negated (~) and pipe/wildcard alternates are skipped.
      const domains = splitDomainPrefix(prefix);
      if (!domains.length) return null;
      return { type: 'domain-cosmetic', domains, selector: rawAfter };
    }

    // ── Global cosmetic: ##.selector ──────────────────────────────────────
    if (rawAfter.length < 2 || rawAfter.length > 512) return null;
    if (hasUnsupportedPseudo(rawAfter)) return null;
    // Global procedural rules → domainCosmetics['*'] for content-procedural.js
    if (isProceduralCosmetic(rawAfter)) {
      return { type: 'domain-cosmetic', domains: ['*'], selector: rawAfter };
    }
    return { type: 'cosmetic', selector: rawAfter };
  }

  // ── Network (DNR) rules — block and @@ exception ───────────────────────────
  const isException = line.startsWith('@@');
  let filter = isException ? line.slice(2) : line;
  let resourceTypes = null;
  const excludedResourceTypes = new Set();
  let domainType = null;
  let important  = false;
  let isBadfilter  = false; // $badfilter — cancels the matching rule
  let docException = false; // @@…$document → allowAllRequests
  const initiatorDomains = [];
  const excludedInitiatorDomains = [];

  const optIdx = filter.lastIndexOf('$');
  if (optIdx !== -1) {
    const opts = filter.slice(optIdx + 1);
    filter = filter.slice(0, optIdx);
    const types = [];
    for (const rawOpt of opts.split(',')) {
      const opt = rawOpt.trim();
      const negated = opt.startsWith('~');
      const optName = opt.replace(/^~/, '').split('=')[0];
      const t = RESOURCE_TYPE_MAP[optName];
      if (t && !negated) types.push(t);
      if (t && negated) excludedResourceTypes.add(t);
      if (optName === 'third-party' || optName === '3p') domainType = negated ? 'firstParty' : 'thirdParty';
      if (optName === 'first-party' || optName === '1p') domainType = negated ? 'thirdParty' : 'firstParty';
      if (optName === 'important') important = true;
      if (optName === 'all') {
        if (isException) docException = true;
        else types.push(...ALL_RESOURCE_TYPES);
      }
      if (isException && (optName === 'document' || optName === 'doc')) docException = true;
      if (opt.startsWith('domain=')) {
        for (const d of opt.slice(7).split('|')) {
          const rawDomain = d.trim();
          const negatedDomain = rawDomain.startsWith('~');
          const domain = (negatedDomain ? rawDomain.slice(1) : rawDomain).replace(/^www\./, '');
          if (!domain || domain.includes('*')) continue;
          // DNR initiatorDomains must be ASCII (canonicalized) — punycode IDNs
          if (negatedDomain) excludedInitiatorDomains.push(toPunycodeDomain(domain.toLowerCase()));
          else initiatorDomains.push(toPunycodeDomain(domain.toLowerCase()));
        }
      }
    }
    if (types.length) resourceTypes = [...new Set(types)];
    else if (excludedResourceTypes.size) {
      resourceTypes = DEFAULT_RESOURCE_TYPES.filter(t => !excludedResourceTypes.has(t));
      if (!resourceTypes.length) return null;
    }
    // $removeparam — extract param name and domain constraints, handle separately
    // Format: $removeparam=paramname or $removeparam=paramname,domain=x.com
    const rpOpt = opts.split(',').find(o => o.trim().startsWith('removeparam'));
    if (rpOpt !== undefined) {
      if (isException) return null; // removeparam exceptions not supported
      const paramPart = rpOpt.trim();
      const eqIdx = paramPart.indexOf('=');
      const paramName = eqIdx !== -1 ? paramPart.slice(eqIdx + 1).trim() : '';
      if (!paramName || paramName.startsWith('/')) return null; // skip regex removeparam
      // Extract domain= and ~domain= opts. DNR initiatorDomains must be canonical
      // ASCII — punycode IDNs (same as the $domain= network path above) and drop
      // wildcards, so a regional list's IDN $removeparam can't make Chrome reject
      // the entire (atomic) removeparam batch and disable all URL cleaning.
      const initDomains    = [];
      const exclDomains    = [];
      for (const part of opts.split(',')) {
        const p = part.trim();
        if (p.startsWith('domain=')) {
          for (const d of p.slice(7).split('|')) {
            const raw = d.trim().toLowerCase();
            if (!raw) continue;
            const negatedDomain = raw.startsWith('~');
            const dom = (negatedDomain ? raw.slice(1) : raw).replace(/^www\./, '');
            if (!dom || dom.includes('*')) continue;
            if (negatedDomain) exclDomains.push(toPunycodeDomain(dom));
            else initDomains.push(toPunycodeDomain(dom));
          }
        }
      }
      return { type: 'removeparam', param: paramName, initDomains, exclDomains };
    }
    // Skip option types that would change the action semantics. Match option
    // *names* (token before '='), not substrings — a naive includes() would drop
    // legitimate block rules like "$image,domain=cspire.com" (contains "csp")
    // or any domain= value containing "redirect"/"replace".
    const _optNames = opts.split(',').map(o => o.trim().replace(/^~/, '').split('=')[0]);
    // $badfilter: this line CANCELS the identical rule elsewhere in the list.
    // Parse it like a normal rule and report it as a cancellation signature.
    if (_optNames.includes('badfilter')) isBadfilter = true;
    if (_optNames.some(n => UNSUPPORTED_OPTION_NAMES.has(n))) {
      // Exceptions for cosmetic/generic hiding are simply inert for us — but a
      // *block* rule with an unsupported action option must not over-block.
      if (!isException) return null;
      // @@…$elemhide-style lines carry no network meaning either — drop unless
      // they also carry a document scope (handled below via docException).
      if (!docException) return null;
    }
  }

  // Clean up the filter
  filter = filter.replace(/\^$/, '').replace(/\*$/, '');

  if (filter === '*' || filter === '||*') {
    // "@@*$document,domain=…" style: a real allow-everything-on-domain rule
    if (!(isException && docException && initiatorDomains.length)) return null;
    filter = '';
  }
  if (looksLikeRegexFilter(filter)) return null; // regex filters unsupported in urlFilter

  let urlFilter = null;
  let anchored  = false;
  if (filter.startsWith('||') || filter.startsWith('http') || filter.startsWith('|http')) {
    // Domain-anchored or absolute-URL pattern
    const bare = filter.replace(/^\|+/, '').replace(/^https?:\/\//, '').replace(/[/?^*].*/, '').toLowerCase();
    if (bare.length < 4) return null;
    urlFilter = filter;
    anchored  = true;
  } else if (filter.length >= 5) {
    // Generic substring pattern (/ads/banner/*, -ad-300x250., &ad_type=…).
    // EasyList ships thousands of these; DNR urlFilter matches substrings
    // natively. Guards: ≥5 chars, ≥3 alphanumerics, no '|' mid-pattern
    // (a literal pipe never appears in URLs — the rule would match nothing).
    const alnum = (filter.match(/[a-z0-9]/gi) ?? []).length;
    if (alnum < 3) return null;
    if (filter.includes('|')) return null;
    urlFilter = filter;
  } else if (!(isException && docException && (filter.length === 0 || initiatorDomains.length))) {
    return null;
  }

  // Chrome DNR rejects any rule whose urlFilter contains non-ASCII characters,
  // and updateDynamicRules is atomic per batch — one bad rule rejects the whole
  // batch (up to 500 rules), silently collapsing blocking. Regional lists ship
  // IDN domains (||пример.рф^); browsers put punycode on the wire, so a pure
  // ||host^ pattern is converted to punycode (keeps the blocking) and anything
  // else still non-ASCII is dropped — a raw-Unicode urlFilter never matches a
  // real request anyway, so the drop loses nothing while protecting the batch.
  if (urlFilter !== null && !/^[\x00-\x7F]*$/.test(urlFilter)) {
    const m = urlFilter.match(/^\|\|([^/^*|]+)([\^/]?)$/);
    if (m) urlFilter = '||' + toPunycodeDomain(m[1].toLowerCase()) + m[2];
    if (!/^[\x00-\x7F]*$/.test(urlFilter)) return null;
  }

  if (urlFilter !== null && (urlFilter.length < 4 || urlFilter.length > 512)) return null;
  // Never emit BLOCK rules against protected/critical domains. Exceptions are
  // exempt — allowing a protected domain is harmless (and usually the point).
  if (!isException && isDomainProtected(filter)) return null;

  // The Google-API initiator guard prevents GENERIC patterns from breaking
  // Google/GitHub apps. Domain-anchored block rules target specific ad hosts and
  // don't need it — and at 27 entries per rule it would dominate storage/ruleset
  // size if applied to everything. Never applied to exceptions (it would invert
  // into over-blocking).
  if (!isException && !anchored) {
    excludedInitiatorDomains.push(...SHARED_GOOGLE_API_EXCLUDED_INITIATORS);
  }

  const condition = {};
  // Omit resourceTypes when the filter carries no type options: DNR's default
  // (all types except main_frame) is a superset of DEFAULT_RESOURCE_TYPES and
  // matches uBO's untyped-rule semantics, while keeping rules ~120 bytes smaller.
  if (resourceTypes) condition.resourceTypes = resourceTypes;
  if (urlFilter !== null && urlFilter !== '') condition.urlFilter = urlFilter;
  if (excludedInitiatorDomains.length) condition.excludedInitiatorDomains = [...new Set(excludedInitiatorDomains)];
  if (initiatorDomains.length) condition.initiatorDomains = [...new Set(initiatorDomains)];
  if (domainType) condition.domainType = domainType;

  let action;
  let priority = 2;
  if (isException) {
    if (docException) {
      // @@…$document — exempt the whole page: allowAllRequests applies to the
      // navigation and every request made by the resulting frame tree.
      action = { type: 'allowAllRequests' };
      condition.resourceTypes = ['main_frame', 'sub_frame'];
      priority = 5; // beat block(2/3), removeparam redirect(3/4)
    } else {
      // Plain network exception. Same priority as blocks — DNR breaks ties by
      // action precedence (allow > block), matching ABP exception semantics.
      action = { type: 'allow' };
    }
  } else {
    action = { type: 'block' };
    // $important blocks beat same-priority exceptions (uBO semantics)
    if (important) priority = 3;
  }
  // A rule must have some condition besides resourceTypes to be meaningful
  if (!condition.urlFilter && !condition.initiatorDomains) return null;

  const rule = { id: idCounter, priority, action, condition };
  if (isBadfilter) return { type: 'badfilter', rule };
  return { type: 'dnr', rule };
  } catch (_) { return null; }
}

// Stable identity for a parsed rule — used by $badfilter cancellation (and
// mirrors the sync-time dedupe key in background.js).
function _ruleSignature(rule) {
  const c    = rule.condition ?? {};
  const rt   = (c.resourceTypes ?? []).slice().sort().join(',');
  const init = (c.initiatorDomains ?? []).slice().sort().join('|');
  return `${rule.action?.type}:${rule.priority ?? 0}:${c.urlFilter ?? ''}:${rt}:${init}`;
}

/**
 * Parse a filter list text.
 * Returns:
 *   rules          — DNR network rules (block + allow/allowAllRequests exceptions)
 *   cosmetics      — global CSS selectors (array)
 *   domainCosmetics — { 'domain.com': ['.sel1', '.sel2'] }
 *   scriptletRules  — { 'domain.com': [{name, args}], '*': [...] }
 */
export function parseFilterList(text, startId = 1000, maxRules = 4500) {
  const lines          = text.split(/\r?\n/);
  const blockRules     = [];
  const allowRules     = []; // @@ exceptions — never starved out by block volume
  const badfilterKeys  = new Set(); // $badfilter signatures — cancel matching rules
  const cosmetics      = new Set();
  const domainCosmetics = {};
  const scriptletRules  = {};
  const cosmeticExceptions = {}; // { domain|'*': [selectors] } — unhide (#@#) rules
  // removeparams: { global: Set<string>, domain: Map<domainKey, Set<string>> }
  const removeParams    = { global: new Set(), domain: new Map() };

  const MAX_COSMETICS        = 8000;
  const MAX_DOMAIN_COSMETICS = 15000;
  const MAX_SCRIPTLETS       = 3000;
  // Exceptions are what keep aggressive blocking from breaking sites — reserve
  // up to a quarter of the rule budget for them regardless of where they appear
  // in the file (EasyList puts them after tens of thousands of block lines).
  const maxExceptions        = Math.max(50, Math.floor(maxRules / 4));
  let domainCosmeticCount    = 0;
  let scriptletCount         = 0;

  for (const line of lines) {
    if (blockRules.length >= maxRules &&
        allowRules.length >= maxExceptions &&
        cosmetics.size >= MAX_COSMETICS &&
        domainCosmeticCount >= MAX_DOMAIN_COSMETICS &&
        scriptletCount >= MAX_SCRIPTLETS) break;

    const result = parseLine(line, 0); // real IDs assigned after the parse
    if (!result) continue;

    switch (result.type) {
      case 'dnr':
        if (result.rule.action.type === 'block') {
          if (blockRules.length < maxRules) blockRules.push(result.rule);
        } else if (allowRules.length < maxExceptions) {
          allowRules.push(result.rule);
        }
        break;
      case 'badfilter':
        badfilterKeys.add(_ruleSignature(result.rule));
        break;
      case 'cosmetic-exception':
        for (const domain of result.domains) {
          const arr = cosmeticExceptions[domain] ?? (cosmeticExceptions[domain] = []);
          if (arr.length < 200) arr.push(result.selector);
        }
        break;
      case 'cosmetic':
        if (cosmetics.size < MAX_COSMETICS) cosmetics.add(result.selector);
        break;
      case 'domain-cosmetic':
        for (const domain of result.domains) {
          if (domainCosmeticCount >= MAX_DOMAIN_COSMETICS) break;
          if (!domainCosmetics[domain]) domainCosmetics[domain] = [];
          domainCosmetics[domain].push(result.selector);
          domainCosmeticCount++;
        }
        break;
      case 'scriptlet':
        for (const domain of result.domains) {
          if (scriptletCount >= MAX_SCRIPTLETS) break;
          if (!scriptletRules[domain]) scriptletRules[domain] = [];
          scriptletRules[domain].push({ name: result.name, args: result.args });
          scriptletCount++;
        }
        break;
      case 'removeparam': {
        const { param, initDomains, exclDomains } = result;
        // ABP allows multiple params in one option via '|' (e.g. removeparam=utm_source|utm_medium).
        // Split here so each param is individually matched by the DNR removeParams action.
        const paramList = param.split('|').map(p => p.trim()).filter(Boolean);
        if (!initDomains.length && !exclDomains.length) {
          // Global param — add to global set
          for (const p of paramList) removeParams.global.add(p);
        } else {
          // Domain-scoped — key by sorted domain list
          const key = [...initDomains].sort().join('|') + '~~' + [...exclDomains].sort().join('|');
          if (!removeParams.domain.has(key)) {
            removeParams.domain.set(key, { params: new Set(), initDomains, exclDomains });
          }
          for (const p of paramList) removeParams.domain.get(key).params.add(p);
        }
        break;
      }
    }
  }

  // Merge: exceptions first (so trimming to budget always drops blocks, never
  // the rules that unbreak sites), then apply $badfilter cancellations, then
  // assign sequential IDs from startId.
  let rules = [...allowRules, ...blockRules];
  if (badfilterKeys.size) rules = rules.filter(r => !badfilterKeys.has(_ruleSignature(r)));
  rules = rules.slice(0, maxRules);
  let id = startId;
  for (const r of rules) r.id = id++;

  return {
    rules,
    cosmetics: [...cosmetics],
    domainCosmetics,
    scriptletRules,
    cosmeticExceptions,
    removeParams: {
      global: [...removeParams.global],
      domain: [...removeParams.domain.values()].map(e => ({
        params: [...e.params], initDomains: e.initDomains, exclDomains: e.exclDomains,
      })),
    },
  };
}
