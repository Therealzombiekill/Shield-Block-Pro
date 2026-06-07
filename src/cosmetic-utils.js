/**
 * Shared cosmetic aggregation helpers (background + validation scripts).
 */
import { isProceduralCosmetic } from './filter-parser.js';

/**
 * Deduplicate and cap per-domain cosmetic selectors.
 * Procedural rules are kept first so :has-text() survives sync caps.
 */
export function finalizeDomainCosmetics(raw, { globalMax = 600, domainMax = 350 } = {}) {
  const out = {};
  for (const [dom, sels] of Object.entries(raw ?? {})) {
    if (!Array.isArray(sels) || !sels.length) continue;
    const deduped = [...new Set(sels.filter(s => typeof s === 'string' && s.length > 0 && s.length < 513))];
    const proc  = deduped.filter(isProceduralCosmetic);
    const plain = deduped.filter(s => !isProceduralCosmetic(s));
    const max = dom === '*' ? globalMax : domainMax;
    out[dom] = [...proc, ...plain].slice(0, max);
  }
  return out;
}

export function countProceduralInDomainCosmetics(domainCosmetics) {
  let n = 0;
  for (const sels of Object.values(domainCosmetics ?? {})) {
    if (!Array.isArray(sels)) continue;
    n += sels.filter(isProceduralCosmetic).length;
  }
  return n;
}

/** Deduplicate scriptlet rules per domain (max 50 each). */
export function finalizeScriptletRules(allScriptletRules) {
  const out = {};
  for (const [dom, rules] of Object.entries(allScriptletRules ?? {})) {
    const seen = new Set();
    out[dom] = (rules ?? []).filter(r => {
      const k = r.name + JSON.stringify(r.args);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    }).slice(0, 50);
  }
  return out;
}
