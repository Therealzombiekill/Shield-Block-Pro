/**
 * ShieldBlock Pro — Procedural cosmetic engine (shared, chainable)
 *
 * Loaded as a classic content script before content-procedural.js, exposing
 * globalThis.__sbProc. Implements uBO-style procedural selectors AND chains them
 * left to right (e.g. `.item:has-text(/ad/i):upward(2)` → find text, then remove
 * the 2nd ancestor). The DOM is reached only through an injected adapter (ctx) so
 * the matching logic is pure and unit-tested in test/procedural.test.js against a
 * mock DOM. content-procedural.js supplies the real adapter.
 *
 * MARKERS must stay in sync with ENGINE_PROCEDURAL_PSEUDOS in filter-parser.js —
 * a marker the parser routes to domainCosmetics but the engine can't handle would
 * be injected as invalid CSS. test/parser.test.js enforces the match.
 */
(function () {
  'use strict';

  var MARKERS = [':has-text(', ':matches-css(', ':upward(', ':xpath(', ':matches-attr(', ':min-text-length('];
  var KNOWN = { 'has-text': 1, 'matches-css': 1, 'upward': 1, 'xpath': 1, 'matches-attr': 1, 'min-text-length': 1 };

  function isProcedural(sel) {
    for (var i = 0; i < MARKERS.length; i++) if (sel.indexOf(MARKERS[i]) !== -1) return true;
    return false;
  }

  function toRe(s) {
    if (!s) return null;
    if (s.charAt(0) === '/' && s.lastIndexOf('/') > 0) {
      var li = s.lastIndexOf('/');
      try { return new RegExp(s.slice(1, li), s.slice(li + 1)); } catch (_) { return null; }
    }
    try { return new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')); } catch (_) { return null; }
  }

  function stripQuotes(s) {
    s = (s || '').trim();
    if (s.length >= 2 && (s.charAt(0) === '"' || s.charAt(0) === "'") && s.charAt(s.length - 1) === s.charAt(0)) {
      return s.slice(1, -1);
    }
    return s;
  }

  // Split "prefix:op(arg):op2(arg2)" → { prefix, ops:[{name,arg}] }. Only the
  // procedural MARKERS start an op; native CSS (:has, :not, :is) stays in prefix.
  function parse(selector) {
    var s = (selector || '').trim();
    var depth = 0, opStart = -1;
    for (var i = 0; i < s.length; i++) {
      var c = s.charAt(i);
      if (c === '(') depth++;
      else if (c === ')') { if (depth > 0) depth--; }
      else if (depth === 0 && c === ':') {
        for (var m = 0; m < MARKERS.length; m++) {
          if (s.substr(i, MARKERS[m].length) === MARKERS[m]) { opStart = i; break; }
        }
        if (opStart !== -1) break;
      }
    }
    if (opStart === -1) return { prefix: s, ops: [] };

    var prefix = s.slice(0, opStart).trim();
    var ops = [], j = opStart;
    while (j < s.length && s.charAt(j) === ':') {
      var paren = s.indexOf('(', j);
      if (paren === -1) break;
      var name = s.slice(j + 1, paren);
      var d = 0, end = -1;
      for (var k = paren; k < s.length; k++) {
        if (s.charAt(k) === '(') d++;
        else if (s.charAt(k) === ')') { if (--d === 0) { end = k; break; } }
      }
      if (end === -1) break;
      ops.push({ name: name, arg: s.slice(paren + 1, end) });
      j = end + 1;
      while (j < s.length && s.charAt(j) === ' ') j++;
    }
    return { prefix: prefix, ops: ops };
  }

  function uniq(arr) {
    var out = [];
    for (var i = 0; i < arr.length; i++) if (arr[i] && out.indexOf(arr[i]) === -1) out.push(arr[i]);
    return out;
  }

  function matchesAttr(el, arg, ctx) {
    var eq = arg.indexOf('=');
    var nameRe = toRe(stripQuotes(eq === -1 ? arg : arg.slice(0, eq)));
    var valRe = eq === -1 ? null : toRe(stripQuotes(arg.slice(eq + 1)));
    if (!nameRe) return false;
    var attrs = ctx.attrs(el) || [];
    for (var i = 0; i < attrs.length; i++) {
      if (nameRe.test(attrs[i].name)) {
        if (valRe === null) return true;
        if (valRe && valRe.test(attrs[i].value)) return true;
      }
    }
    return false;
  }

  function applyOp(op, set, ctx) {
    var name = op.name, arg = op.arg, out = [], re, i;
    switch (name) {
      case 'has-text':
        re = toRe(arg); if (!re) return [];
        return set.filter(function (el) { return re.test(ctx.getText(el)); });
      case 'min-text-length': {
        var n = parseInt(arg, 10);
        if (isNaN(n)) return [];
        return set.filter(function (el) { return (ctx.getText(el) || '').length >= n; });
      }
      case 'matches-css': {
        var mm = arg.match(/^\s*([a-zA-Z-]+)\s*:\s*([\s\S]+)$/);
        if (!mm) return [];
        re = toRe(mm[2].trim()); if (!re) return [];
        return set.filter(function (el) { return re.test(ctx.getStyle(el, mm[1])); });
      }
      case 'matches-attr':
        return set.filter(function (el) { return matchesAttr(el, arg, ctx); });
      case 'upward': {
        var steps = parseInt(arg, 10);
        for (i = 0; i < set.length; i++) {
          if (!isNaN(steps)) {
            var node = set[i];
            for (var s2 = 0; s2 < steps && node; s2++) node = ctx.parent(node);
            if (node) out.push(node);
          } else {
            var anc = ctx.closest(set[i], arg.trim());
            if (anc) out.push(anc);
          }
        }
        return uniq(out);
      }
      case 'xpath':
        for (i = 0; i < set.length; i++) {
          var r = ctx.xpath(arg, set[i]) || [];
          for (var x = 0; x < r.length; x++) out.push(r[x]);
        }
        return uniq(out);
      default:
        return []; // unknown op — skip selector (never over-remove)
    }
  }

  /** Returns the array of elements the selector resolves to (to be removed). */
  function evaluate(selector, ctx) {
    var p = parse(selector);
    if (!p.ops.length) return [];
    for (var i = 0; i < p.ops.length; i++) if (!KNOWN[p.ops[i].name]) return [];

    var ops = p.ops, set;
    if (p.prefix) {
      set = ctx.queryAll(p.prefix);
    } else if (ops[0].name === 'xpath') {
      set = ctx.xpath(ops[0].arg, null); // document-scoped xpath when it's the subject
      ops = ops.slice(1);
    } else {
      set = ctx.queryAll('*');
    }
    set = set || [];
    for (var j = 0; j < ops.length; j++) {
      set = applyOp(ops[j], set, ctx);
      if (!set || !set.length) return [];
    }
    return uniq(set);
  }

  globalThis.__sbProc = {
    MARKERS: MARKERS,
    isProcedural: isProcedural,
    parse: parse,
    evaluate: evaluate,
  };
})();
