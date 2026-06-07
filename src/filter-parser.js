/**
 * ShieldBlock Pro — Filter List Parser v2.0
 *
 * Now parses:
 *   - DNR network rules (||domain.com^)
 *   - Global cosmetic rules (##.selector)
 *   - Domain-scoped cosmetic rules (example.com##.selector)
 *   - Scriptlet rules (example.com##+js(name, arg))
 */

import { isDomainProtected, SHARED_GOOGLE_API_EXCLUDED_INITIATORS } from './trusted-sites.js';

const RESOURCE_TYPE_MAP = {
  'script':         'script',
  'image':          'image',
  'stylesheet':     'stylesheet',
  'xmlhttprequest': 'xmlhttprequest',
  'xhr':            'xmlhttprequest',
  'subdocument':    'sub_frame',
  'media':          'media',
  'font':           'font',
  'websocket':      'websocket',
  'other':          'other',
  'ping':           'ping',
};

const DEFAULT_RESOURCE_TYPES = [
  'script', 'image', 'xmlhttprequest', 'sub_frame', 'media', 'font', 'stylesheet', 'other', 'ping',
];

// Procedural pseudo-classes handled by content-procedural.js (not insertCSS)
const PROCEDURAL_MARKERS = [':has-text(', ':matches-css(', ':upward(', ':xpath('];

export function isProceduralCosmetic(selector) {
  return typeof selector === 'string' && PROCEDURAL_MARKERS.some(m => selector.includes(m));
}

// Truly unsupported — not yet implemented anywhere
function hasUnsupportedPseudo(selector) {
  return (
    selector.includes(':nth-ancestor(') ||
    selector.includes(':watch-attr(') ||
    selector.includes('{ ')
  );
}

function parseLine(line, idCounter) {
  try {
  line = line.trim();
  if (!line || line.startsWith('!') || line.startsWith('[') || line.startsWith('#!')) {
    return null;
  }

  // ── Exception cosmetic (#@#) — skip before ## check ──────────────────────────
  if (line.includes('#@#')) return null;

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
      const parts = inner.split(',').map(s => s.trim());
      const [name, ...args] = parts;
      if (!name) return null;
      // '*' means apply to all domains
      const domain = prefix ? prefix.toLowerCase() : '*';
      // Skip exception domains (prefixed with ~) and multi-domain scriptlets
      if (domain.startsWith('~') || domain.includes('|')) return null;
      return { type: 'scriptlet', domain, name, args };
    }

    // ── Domain-scoped cosmetic: example.com##.selector ────────────────────
    if (prefix && prefix !== '*') {
      // Skip multi-domain rules (comma-separated), exception prefixes, and
      // pipe-separated alternates — these produce composite keys that never
      // match any real hostname.
      if (prefix.includes(',') || prefix.startsWith('~') || prefix.includes('|')) return null;
      if (rawAfter.length < 2 || rawAfter.length > 512) return null;
      if (hasUnsupportedPseudo(rawAfter)) return null;
      return { type: 'domain-cosmetic', domain: prefix.toLowerCase(), selector: rawAfter };
    }

    // ── Global cosmetic: ##.selector ──────────────────────────────────────
    if (rawAfter.length < 2 || rawAfter.length > 512) return null;
    if (hasUnsupportedPseudo(rawAfter)) return null;
    // Global procedural rules → domainCosmetics['*'] for content-procedural.js
    if (isProceduralCosmetic(rawAfter)) {
      return { type: 'domain-cosmetic', domain: '*', selector: rawAfter };
    }
    return { type: 'cosmetic', selector: rawAfter };
  }

  // ── Exception rules — skip ─────────────────────────────────────────────────
  if (line.startsWith('@@')) return null;
  if (!line.startsWith('||') && !line.startsWith('http')) return null;

  // ── Network (DNR) rules ────────────────────────────────────────────────────
  let filter = line;
  let resourceTypes = null;
  const excludedResourceTypes = new Set();
  let domainType = null;
  const initiatorDomains = [];
  const excludedInitiatorDomains = [...SHARED_GOOGLE_API_EXCLUDED_INITIATORS];

  const optIdx = filter.lastIndexOf('$');
  if (optIdx !== -1) {
    const opts = filter.slice(optIdx + 1);
    filter = filter.slice(0, optIdx);
    const types = [];
    for (const rawOpt of opts.split(',')) {
      const opt = rawOpt.trim();
      const negated = opt.startsWith('~');
      const optName = opt.replace(/^~/, '');
      const t = RESOURCE_TYPE_MAP[optName];
      if (t && !negated) types.push(t);
      if (t && negated) excludedResourceTypes.add(t);
      if (optName === 'third-party') domainType = negated ? 'firstParty' : 'thirdParty';
      if (opt.startsWith('domain=')) {
        for (const d of opt.slice(7).split('|')) {
          const rawDomain = d.trim();
          const negatedDomain = rawDomain.startsWith('~');
          const domain = (negatedDomain ? rawDomain.slice(1) : rawDomain).replace(/^www\./, '');
          if (!domain) continue;
          if (negatedDomain) excludedInitiatorDomains.push(domain);
          else initiatorDomains.push(domain);
        }
      }
    }
    if (types.length) resourceTypes = types;
    else if (excludedResourceTypes.size) {
      resourceTypes = DEFAULT_RESOURCE_TYPES.filter(t => !excludedResourceTypes.has(t));
      if (!resourceTypes.length) return null;
    }
    // $removeparam — extract param name and domain constraints, handle separately
    // Format: $removeparam=paramname or $removeparam=paramname,domain=x.com
    const rpOpt = opts.split(',').find(o => o.trim().startsWith('removeparam'));
    if (rpOpt !== undefined) {
      const paramPart = rpOpt.trim();
      const eqIdx = paramPart.indexOf('=');
      const paramName = eqIdx !== -1 ? paramPart.slice(eqIdx + 1).trim() : '';
      if (!paramName || paramName.startsWith('/')) return null; // skip regex removeparam
      // Extract domain= and ~domain= opts
      const initDomains    = [];
      const exclDomains    = [];
      for (const part of opts.split(',')) {
        const p = part.trim();
        if (p.startsWith('domain=')) {
          for (const d of p.slice(7).split('|')) {
            if (d.startsWith('~')) exclDomains.push(d.slice(1));
            else if (d) initDomains.push(d);
          }
        }
      }
      return { type: 'removeparam', param: paramName, initDomains, exclDomains };
    }
    // Skip other unsupported option types that would change the action semantics.
    // Match option *names* (token before '='), not substrings — a naive includes()
    // would drop legitimate block rules like "$image,domain=cspire.com" (contains "csp")
    // or any domain= value containing "redirect"/"replace".
    const _optNames = opts.split(',').map(o => o.trim().split('=')[0]);
    if (_optNames.includes('redirect') || _optNames.includes('redirect-rule') ||
        _optNames.includes('csp') || _optNames.includes('replace')) return null;
  }

  // Clean up the filter
  filter = filter.replace(/\^$/, '').replace(/\*$/, '');
  const bare = filter.replace(/^\|\|/, '').replace(/[/?^*].*/, '').toLowerCase();

  if (bare.length < 4) return null;
  if (filter === '*' || filter === '||*') return null;
  if (isDomainProtected(filter)) return null;

  // Convert to DNR urlFilter
  let urlFilter = filter;
  if (!urlFilter.startsWith('||') && !urlFilter.startsWith('http')) return null;

  if (urlFilter.length < 4 || urlFilter.length > 512) return null;

  const condition = {
    urlFilter,
    resourceTypes: resourceTypes ?? DEFAULT_RESOURCE_TYPES,
    // Never block resources when the initiator is YouTube
    excludedInitiatorDomains: [...new Set(excludedInitiatorDomains)],
  };
  if (initiatorDomains.length) condition.initiatorDomains = [...new Set(initiatorDomains)];
  if (domainType) condition.domainType = domainType;

  return {
    type: 'dnr',
    rule: {
      id: idCounter,
      priority: 2,
      action: { type: 'block' },
      condition,
    },
  };
  } catch (_) { return null; }
}

/**
 * Parse a filter list text.
 * Returns:
 *   rules          — DNR network blocking rules
 *   cosmetics      — global CSS selectors (array)
 *   domainCosmetics — { 'domain.com': ['.sel1', '.sel2'] }
 *   scriptletRules  — { 'domain.com': [{name, args}], '*': [...] }
 */
export function parseFilterList(text, startId = 1000, maxRules = 4500) {
  const lines          = text.split(/\r?\n/);
  const rules          = [];
  const cosmetics      = new Set();
  const domainCosmetics = {};
  const scriptletRules  = {};
  // removeparams: { global: Set<string>, domain: Map<domainKey, Set<string>> }
  const removeParams    = { global: new Set(), domain: new Map() };

  const MAX_COSMETICS        = 8000;
  const MAX_DOMAIN_COSMETICS = 15000;
  const MAX_SCRIPTLETS       = 3000;
  let domainCosmeticCount    = 0;
  let scriptletCount         = 0;
  let id = startId;

  for (const line of lines) {
    if (rules.length >= maxRules &&
        cosmetics.size >= MAX_COSMETICS &&
        domainCosmeticCount >= MAX_DOMAIN_COSMETICS &&
        scriptletCount >= MAX_SCRIPTLETS) break;

    const result = parseLine(line, id);
    if (!result) continue;

    switch (result.type) {
      case 'dnr':
        if (rules.length < maxRules) { rules.push(result.rule); id++; }
        break;
      case 'cosmetic':
        if (cosmetics.size < MAX_COSMETICS) cosmetics.add(result.selector);
        break;
      case 'domain-cosmetic':
        if (domainCosmeticCount < MAX_DOMAIN_COSMETICS) {
          const { domain, selector } = result;
          if (!domainCosmetics[domain]) domainCosmetics[domain] = [];
          domainCosmetics[domain].push(selector);
          domainCosmeticCount++;
        }
        break;
      case 'scriptlet':
        if (scriptletCount < MAX_SCRIPTLETS) {
          const { domain, name, args } = result;
          if (!scriptletRules[domain]) scriptletRules[domain] = [];
          scriptletRules[domain].push({ name, args });
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

  return {
    rules,
    cosmetics: [...cosmetics],
    domainCosmetics,
    scriptletRules,
    removeParams: {
      global: [...removeParams.global],
      domain: [...removeParams.domain.values()].map(e => ({
        params: [...e.params], initDomains: e.initDomains, exclDomains: e.exclDomains,
      })),
    },
  };
}
