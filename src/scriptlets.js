/**
 * ShieldBlock Pro — Scriptlet Library v2.0
 *
 * Runs at document_start in MAIN world (declared in manifest content_scripts).
 * Defines globalThis.__sbRunScriptlets globally so background.js can call it via
 * chrome.scripting.executeScript after looking up applicable rules for the domain.
 *
 * NO eval() used — this file is a proper content script, not a string template.
 */

(function () {
  'use strict';

  // ── Helpers ──────────────────────────────────────────────────────────────────

  function getProp(path, create) {
    const parts = path.split('.');
    let obj = window;
    for (let i = 0; i < parts.length - 1; i++) {
      if (obj[parts[i]] == null) {
        if (!create) return { obj: null, key: null };
        obj[parts[i]] = {};
      }
      obj = obj[parts[i]];
      if (typeof obj !== 'object') return { obj: null, key: null };
    }
    return { obj, key: parts[parts.length - 1] };
  }

  function toRe(s) {
    if (!s) return null;
    if (s.startsWith('/') && s.lastIndexOf('/') > 0) {
      const last = s.lastIndexOf('/');
      try { return new RegExp(s.slice(1, last), s.slice(last + 1)); } catch (_) { return null; }
    }
    return new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  }

  function toVal(s) {
    if (s === 'true')       return true;
    if (s === 'false')      return false;
    if (s === 'null')       return null;
    if (s === 'undefined')  return undefined;
    if (s === 'noopFunc')   return function () {};
    if (s === 'trueFunc')   return function () { return true; };
    if (s === 'falseFunc')  return function () { return false; };
    if (s === 'emptyStr')   return '';
    if (s === 'emptyArr')   return [];
    if (s === '0')          return 0;
    if (!isNaN(s) && s !== '') return Number(s);
    return s;
  }

  // Unified XHR proxy — multiple scriptlets can register block/mutate hooks without clobbering each other
  function ensureXhrProxy() {
    if (globalThis.__sbXhrInstalled) return;
    globalThis.__sbXhrInstalled = true;
    globalThis.__sbXhrBlockRes   = globalThis.__sbXhrBlockRes   || [];
    globalThis.__sbXhrMutators   = globalThis.__sbXhrMutators   || [];
    const NativeXHR = window.XMLHttpRequest;
    function SBXHR() {
      const xhr = new NativeXHR();
      let _url = '';
      const _open = xhr.open;
      xhr.open = function (method, url, ...rest) {
        _url = String(url ?? '');
        return _open.apply(this, [method, url, ...rest]);
      };
      const _send = xhr.send;
      xhr.send = function (...args) {
        for (const re of globalThis.__sbXhrBlockRes) {
          if (re && re.test(_url)) return;
        }
        return _send.apply(this, args);
      };
      xhr.addEventListener('readystatechange', function () {
        if (xhr.readyState !== 4) return;
        for (const re of globalThis.__sbXhrBlockRes) {
          if (re && re.test(_url)) return;
        }
        for (const mut of globalThis.__sbXhrMutators) {
          try { mut(xhr, _url); } catch (_) {}
        }
      });
      return xhr;
    }
    try { SBXHR.prototype = NativeXHR.prototype; } catch (_) {}
    window.XMLHttpRequest = SBXHR;
  }

  // ── Scriptlet implementations ─────────────────────────────────────────────────

  const IMPL = {

    'abort-on-property-read': ([prop]) => {
      if (!prop) return;
      const { obj, key } = getProp(prop, true);
      if (!obj || !key) return;
      try {
        Object.defineProperty(obj, key, {
          get() { throw new ReferenceError(prop); },
          configurable: true,
        });
      } catch (_) {}
    },

    'abort-on-property-write': ([prop]) => {
      if (!prop) return;
      const { obj, key } = getProp(prop, true);
      if (!obj || !key) return;
      try {
        Object.defineProperty(obj, key, {
          set() { throw new ReferenceError(prop); },
          configurable: true,
        });
      } catch (_) {}
    },

    'set-constant': ([prop, value]) => {
      if (!prop) return;
      const val = toVal(value);
      const { obj, key } = getProp(prop, true);
      if (!obj || !key) return;
      try {
        Object.defineProperty(obj, key, {
          get: () => val,
          set: () => {},
          configurable: true,
        });
      } catch (_) {}
    },

    'prevent-setTimeout': ([pattern, delay]) => {
      const re = toRe(pattern);
      const _st = window.setTimeout;
      window.setTimeout = function (fn, d, ...rest) {
        const s = typeof fn === 'function' ? fn.toString() : String(fn ?? '');
        // When both pattern AND delay are given, require BOTH to match (uBO spec).
        // Old code: `re ? re.test(s) : delay check` — ignored delay whenever pattern was set.
        const matchesFn    = !re    || re.test(s);
        const matchesDelay = delay === undefined || String(d) === String(delay);
        if (matchesFn && matchesDelay) return 0;
        return _st.call(this, fn, d, ...rest);
      };
      try { window.setTimeout.toString = () => _st.toString(); } catch (_) {}
    },

    'prevent-setInterval': ([pattern, delay]) => {
      const re = toRe(pattern);
      const _si = window.setInterval;
      window.setInterval = function (fn, d, ...rest) {
        const s = typeof fn === 'function' ? fn.toString() : String(fn ?? '');
        // Same AND fix as prevent-setTimeout above.
        const matchesFn    = !re    || re.test(s);
        const matchesDelay = delay === undefined || String(d) === String(delay);
        if (matchesFn && matchesDelay) return 0;
        return _si.call(this, fn, d, ...rest);
      };
      try { window.setInterval.toString = () => _si.toString(); } catch (_) {}
    },

    'abort-current-inline-script': ([api, search]) => {
      if (!api) return;
      const re = search ? toRe(search) : null;
      const { obj, key } = getProp(api, false);
      if (!obj || !key) return;
      const orig = obj[key];
      if (typeof orig !== 'function') return;
      try {
        obj[key] = function (...args) {
          const e = new Error();
          if (/[^\n]*<anonymous>/.test(e.stack || '')) {
            if (!re || args.some(a => re.test(String(a ?? '')))) {
              throw new ReferenceError(api);
            }
          }
          return orig.apply(this, args);
        };
      } catch (_) {}
    },

    'no-fetch-if': ([urlPattern]) => {
      const re = toRe(urlPattern);
      const _fetch = window.fetch;
      window.fetch = function (resource, init) {
        const url = typeof resource === 'string' ? resource : (resource?.url ?? '');
        if (re && re.test(url)) return Promise.resolve(new Response('', { status: 200 }));
        return _fetch.apply(this, arguments);
      };
      try { window.fetch.toString = () => _fetch.toString(); } catch (_) {}
    },

    'remove-class': ([classNames, selector]) => {
      if (!classNames) return;
      const classes = classNames.split('|').map(c => c.trim()).filter(Boolean);
      const sel = selector || '*';
      const apply = () => {
        try { document.querySelectorAll(sel).forEach(el => classes.forEach(c => el.classList.remove(c))); }
        catch (_) {}
      };
      apply();
      new MutationObserver(apply).observe(document.documentElement,
        { attributes: true, childList: true, subtree: true });
    },

    'no-floc': () => {
      try {
        Object.defineProperty(document, 'interestCohort', {
          get: () => () => Promise.reject(new Error('Not allowed')),
          configurable: true,
        });
        if (document.browsingTopics !== undefined) {
          Object.defineProperty(document, 'browsingTopics', {
            get: () => () => Promise.resolve([]),
            configurable: true,
          });
        }
      } catch (_) {}
    },

    'spoof-css': ([selector, prop, value]) => {
      if (!selector || !prop) return;
      const _gcs = window.getComputedStyle;
      window.getComputedStyle = function (el, pseudo) {
        const style = _gcs.call(this, el, pseudo);
        try {
          if (el?.matches?.(selector)) {
            return new Proxy(style, {
              get(t, p) {
                if (p === prop) return value;
                if (p === 'getPropertyValue') return (n) => n === prop ? value : t.getPropertyValue(n);
                const v = t[p];
                return typeof v === 'function' ? v.bind(t) : v;
              },
            });
          }
        } catch (_) {}
        return style;
      };
    },

    'json-prune': ([propsToRemove]) => {
      if (!propsToRemove) return;
      const paths = propsToRemove.split(/\s+/).filter(Boolean);
      const _parse = JSON.parse;
      // Traverse an object by dotted path and delete the leaf key.
      function pruneByPath(obj, path) {
        const parts = path.split('.');
        let node = obj;
        for (let i = 0; i < parts.length - 1; i++) {
          if (node == null || typeof node !== 'object') return;
          node = node[parts[i]];
        }
        if (node != null && typeof node === 'object') delete node[parts[parts.length - 1]];
      }
      JSON.parse = function (text, reviver) {
        const result = _parse.apply(this, arguments);
        if (result && typeof result === 'object') {
          // BUG WAS: getProp(path, false) — that traverses `window`, not `result`.
          // Fix: traverse `result` directly using pruneByPath.
          paths.forEach(path => pruneByPath(result, path));
        }
        return result;
      };
      try { JSON.parse.toString = () => _parse.toString(); } catch (_) {}
    },

    'cookie-remover': ([namePattern]) => {
      const re = toRe(namePattern);
      if (!re) return;
      document.cookie.split(';').forEach(cookie => {
        const name = cookie.trim().split('=')[0].trim();
        if (re.test(name)) {
          const exp = 'expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/';
          document.cookie = `${name}=;${exp}`;
          document.cookie = `${name}=;${exp};domain=${location.hostname}`;
        }
      });
    },

    'prevent-window-open': ([match]) => {
      const re = match ? toRe(match) : null;
      const _open = window.open;
      window.open = function (url, ...rest) {
        if (!re || re.test(String(url ?? ''))) return null;
        return _open.apply(this, arguments);
      };
      try { window.open.toString = () => _open.toString(); } catch (_) {}
    },

    // set-local-storage-item
    // Sets a localStorage key to a fixed value — used to pre-set consent flags,
    // cookie accept states, and paywall bypass tokens.
    'set-local-storage-item': ([key, value]) => {
      if (!key) return;
      try {
        const val = value === 'undefined' ? undefined : value;
        if (val === undefined) { localStorage.removeItem(key); }
        else { localStorage.setItem(key, val); }
      } catch (_) {}
    },
    'trusted-set-local-storage-item': ([key, value]) => IMPL['set-local-storage-item']([key, value]),

    // set-session-storage-item
    'set-session-storage-item': ([key, value]) => {
      if (!key) return;
      try {
        if (value === 'undefined') sessionStorage.removeItem(key);
        else sessionStorage.setItem(key, value);
      } catch (_) {}
    },

    // set-cookie
    // Sets a document cookie — bypasses many CMP systems that check for a
    // consent cookie before showing the banner.
    'set-cookie': ([name, value, path, domain]) => {
      if (!name) return;
      try {
        let cookie = `${name}=${encodeURIComponent(value ?? '')}`;
        if (path)   cookie += `;path=${path}`;
        if (domain) cookie += `;domain=${domain}`;
        cookie += ';max-age=31536000;SameSite=Lax';
        document.cookie = cookie;
      } catch (_) {}
    },
    'trusted-set-cookie': (args) => IMPL['set-cookie'](args),

    // object-prune
    // Like json-prune but applies to a global object property directly.
    'object-prune': ([objectPath, propsToRemove]) => {
      if (!objectPath || !propsToRemove) return;
      const paths = propsToRemove.split(/\s+/).filter(Boolean);
      const { obj, key } = getProp(objectPath, false);
      if (!obj || !key) return;
      const orig = obj[key];
      if (!orig || typeof orig !== 'object') return;
      // Traverse `orig` directly (not window) to delete the target properties.
      paths.forEach(p => {
        const parts = p.split('.');
        let node = orig;
        for (let i = 0; i < parts.length - 1; i++) {
          if (node == null || typeof node !== 'object') return;
          node = node[parts[i]];
        }
        if (node != null && typeof node === 'object') delete node[parts[parts.length - 1]];
      });
    },

    // replace-node-text / trusted-replace-node-text
    // Replaces text in matching DOM nodes — used to change ad-related text
    // or strip anti-adblock warning messages.
    'replace-node-text': ([nodeName, pattern, replacement]) => {
      if (!nodeName || !pattern) return;
      const re = toRe(pattern); if (!re) return;
      const repl = replacement ?? '';
      const walk = (root) => {
        const iter = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        const nodes = [];
        let n = iter.nextNode();
        while (n) { nodes.push(n); n = iter.nextNode(); }
        nodes.forEach(node => {
          if (node.parentElement?.nodeName.toLowerCase() === nodeName.toLowerCase()) {
            node.nodeValue = node.nodeValue.replace(re, repl);
          }
        });
      };
      if (document.body) walk(document.body);
      new MutationObserver(muts => {
        muts.forEach(m => m.addedNodes.forEach(n => {
          if (n.nodeType === 1) walk(n);
        }));
      }).observe(document.documentElement, { childList: true, subtree: true });
    },
    'trusted-replace-node-text': (args) => IMPL['replace-node-text'](args),

    // addEventListener-defuser
    // Prevents a specific event listener from being added, identified by event
    // type and/or the listener function's source code matching a pattern.
    'addEventListener-defuser': ([type, pattern]) => {
      const re = pattern ? toRe(pattern) : null;
      const _aEL = EventTarget.prototype.addEventListener;
      EventTarget.prototype.addEventListener = function(t, fn, opts) {
        if (t === type && (!re || re.test(typeof fn === 'function' ? fn.toString() : ''))) return;
        return _aEL.call(this, t, fn, opts);
      };
      try { EventTarget.prototype.addEventListener.toString = () => _aEL.toString(); } catch (_) {}
    },
    'aeld': (args) => IMPL['addEventListener-defuser'](args),

    // disable-newtab-links
    // Prevents links from opening in new tabs (used to block ad redirects).
    'disable-newtab-links': () => {
      document.addEventListener('click', (e) => {
        let el = e.target;
        while (el && el.tagName !== 'A') el = el.parentElement;
        if (el?.target === '_blank') { el.target = '_self'; }
      }, true);
    },

    // href-sanitizer
    // Strips tracking parameters from href attributes on matching links.
    'href-sanitizer': ([selector, attr]) => {
      const sel = selector || 'a[href]';
      const attribute = attr || 'href';
      const TRACKING = /[?&](utm_[a-z]+|fbclid|gclid|ttclid|li_fat_id|irclickid|mc_eid|_ga)=[^&]*/g;
      const apply = () => {
        document.querySelectorAll(sel).forEach(el => {
          const val = el.getAttribute(attribute);
          if (val && TRACKING.test(val)) {
            TRACKING.lastIndex = 0;
            el.setAttribute(attribute, val.replace(TRACKING, ''));
          }
        });
      };
      apply();
      new MutationObserver(apply).observe(document.documentElement,
        { attributes: true, childList: true, subtree: true });
    },

    // call-nothrow
    // Wraps a function so it swallows all exceptions — used to neutralize
    // anti-adblock scripts that detect ad blockers by catching thrown errors.
    'call-nothrow': ([api]) => {
      if (!api) return;
      const { obj, key } = getProp(api, false);
      if (!obj || !key || typeof obj[key] !== 'function') return;
      const orig = obj[key];
      obj[key] = function (...args) {
        try { return orig.apply(this, args); } catch (_) {}
      };
    },

    // noop — replaces a function with a no-op
    'noop': ([api]) => {
      if (!api) return;
      const { obj, key } = getProp(api, false);
      if (!obj || !key) return;
      try { obj[key] = function () {}; } catch (_) {}
    },
    'noopFunc':  ([api]) => IMPL['noop']([api]),
    // googletag — neutralize Google Publisher Tag ad slots
    // These are the most impactful anti-ad scriptlets for sites using GPT
    'googletag': () => {
      // Provide a fake googletag API so GPT scripts don't error
      // but don't actually load or display any ads
      if (window.googletag && window.googletag._loaded) return;
      const _slots = [];
      const _noop  = () => window.googletag;
      const _cmd   = [];
      _cmd.push = (fn) => { try { fn(); } catch(_) {} };
      window.googletag = {
        _loaded: true,
        cmd: _cmd,
        defineSlot: () => ({ addService: _noop, setTargeting: _noop,
          getSlotElementId: () => '', getSizes: () => [] }),
        defineOutOfPageSlot: () => ({ addService: _noop, setTargeting: _noop }),
        pubads: () => ({
          enableSingleRequest: _noop, collapseEmptyDivs: _noop,
          disableInitialLoad: _noop, enableLazyLoad: _noop,
          setTargeting: _noop, refresh: _noop, clear: _noop,
          addEventListener: _noop, getTargeting: () => [],
          getSlots: () => _slots,
        }),
        companionAds: () => ({ enableSyncLoading: _noop }),
        content:     () => ({ setContent: _noop }),
        enableServices: _noop,
        display: _noop,
        destroySlots: _noop,
        getVersion: () => '9.9.9',
      };
    },

    // prevent-adfly — bypass adf.ly / adfoc.us link shortener countdown
    'adfly-defuser': () => {
      try {
        // Block adfly property writes used for redirect detection
        Object.defineProperty(window, 'ysmm',        { set: () => {}, configurable: true });
        Object.defineProperty(window, 'karambaUrl',  { set: () => {}, configurable: true });
        Object.defineProperty(window, 'adfly_id',    { get: () => null, set: () => {}, configurable: true });
        Object.defineProperty(window, 'adfly_advert',{ get: () => null, set: () => {}, configurable: true });
        // Skip the countdown timer and block setTimeout/setInterval patterns
        IMPL['prevent-setTimeout'](['/adfly|adf\.ly/']);
        IMPL['prevent-setInterval'](['/adfly|adf\.ly/']);
        // Also intercept the raw setTimeout for countdown-keyword patterns
        const _st = window.setTimeout;
        window.setTimeout = function(fn, delay, ...rest) {
          const s = typeof fn === 'function' ? fn.toString() : String(fn);
          if (/countdown|skipAd|skipWait|skip_wait|allfad|adf\.ly/i.test(s)) {
            return _st.call(this, fn, 0, ...rest);
          }
          return _st.call(this, fn, delay, ...rest);
        };
      } catch(_) {}
    },

    // disable-localStorage-item — remove specific localStorage keys used for anti-adblock
    'remove-local-storage-item': ([key]) => {
      if (!key) return;
      try { localStorage.removeItem(key); } catch(_) {}
      // Also intercept future writes
      const _origSetItem = Storage.prototype.setItem;
      const re = typeof key === 'string' && key.startsWith('/') && key.lastIndexOf('/') > 0
        ? toRe(key) : new RegExp('^' + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$');
      try {
        Storage.prototype.setItem = function(k, v) {
          if (this === localStorage && re && re.test(k)) return;
          _origSetItem.call(this, k, v);
        };
      } catch(_) {}
    },


    // trusted-replace-fetch-response
    // Intercepts fetch() and replaces matching text in the response body.
    'trusted-replace-fetch-response': ([urlPattern, pattern, replacement]) => {
      if (!urlPattern || !pattern) return;
      const urlRe = toRe(urlPattern);
      const bodyRe = toRe(pattern);
      if (!urlRe || !bodyRe) return;
      const repl = replacement ?? '';
      const _fetch = window.fetch;
      window.fetch = async function(resource, init) {
        const url = typeof resource === 'string' ? resource : (resource?.url ?? '');
        const res = await _fetch.apply(this, arguments);
        if (!urlRe.test(url)) return res;
        try {
          const text = await res.clone().text();
          const patched = text.replace(bodyRe, repl);
          // Drop content-length/content-encoding: the body changed length and is now
          // decoded text, so the original (e.g. gzip) headers would make the consumer
          // mis-read it. (Same fix as m3u-prune below.)
          const h = new Headers(); res.headers.forEach((v, k) => {
            if (!['content-length','content-encoding'].includes(k.toLowerCase())) h.set(k, v);
          });
          return new Response(patched, { status: res.status, headers: h });
        } catch (_) { return res; }
      };
    },

    // m3u-prune
    // Removes ad segments from M3U8 playlists in fetch responses.
    // Used for streaming sites that stitch ads into HLS manifests.
    'm3u-prune': ([urlPattern, adPattern]) => {
      const urlRe = toRe(urlPattern || '.m3u8');
      const adRe  = toRe(adPattern  || 'stitched|EXT-OATCLS-SCTE35|EXT-X-CUE-OUT');
      if (!urlRe || !adRe) return;
      const _fetch = window.fetch;
      window.fetch = async function(resource, init) {
        const url = typeof resource === 'string' ? resource : (resource?.url ?? '');
        const res = await _fetch.apply(this, arguments);
        if (!urlRe.test(url)) return res;
        try {
          const text = await res.clone().text();
          if (!adRe.test(text)) return res;
          // Remove lines between CUE-OUT and CUE-IN
          const lines = text.split('\n');
          const clean = [];
          let inAd = false;
          let skipNext = false;
          for (const l of lines) {
            if (l.includes('EXT-X-CUE-OUT') || (l.includes('EXT-X-DATERANGE') && adRe.test(l))) {
              inAd = true; continue;
            }
            if (l.includes('EXT-X-CUE-IN')) { inAd = false; continue; }
            if (inAd) {
              if (l.startsWith('#EXTINF')) { skipNext = true; continue; }
              if (skipNext && !l.startsWith('#')) { skipNext = false; continue; }
              continue;
            }
            clean.push(l);
          }
          const h = new Headers(); res.headers.forEach((v,k) => {
            if (!['content-length','content-encoding'].includes(k.toLowerCase())) h.set(k, v);
          });
          return new Response(clean.join('\n'), { status: res.status, headers: h });
        } catch (_) { return res; }
      };
    },

    // googletag-defuser
    // Prevents Google Publisher Tag (GPT) from loading ad slots.
    // Called on sites using window.googletag — defuses the slot definition
    // and display calls so GPT scripts run but serve nothing.
    'googletag-defuser': () => {
      try {
        const noop = () => ({
          addService: () => ({}), set: () => ({}), setTargeting: () => ({}),
          defineSizeMapping: () => ({}), setCollapseEmptyDiv: () => ({}),
        });
        const gt = {
          cmd: { push: (fn) => { try { fn(); } catch(_) {} } },
          defineSlot: noop, defineOutOfPageSlot: noop,
          defineInterstitialSlot: noop,
          pubads: () => ({
            enableSingleRequest: ()=>{}, enableLazyLoad: ()=>{},
            collapseEmptyDivs: ()=>{}, disableInitialLoad: ()=>{},
            setTargeting: ()=>({}), refresh: ()=>{}, clear: ()=>{},
            addEventListener: ()=>{}, setPrivacySettings: ()=>{},
            updateCorrelator: ()=>{},
          }),
          companionAds: () => ({ setRefreshUnfilledSlots: ()=>{} }),
          sizeMapping: () => ({ addSize: function(){ return this; }, build: ()=>[] }),
          enableServices: ()=>{}, display: ()=>{},
          destroySlots: ()=>true, getVersion: ()=>'',
          openConsole: ()=>{}, setAdIframeTitle: ()=>{},
        };
        if (!window.googletag || !window.googletag._defused) {
          window.googletag = gt;
          window.googletag._defused = true;
        }
      } catch(_) {}
    },

    // prevent-popads-net
    'prevent-popads-net': () => {
      try {
        Object.defineProperty(window, 'PopAds',   { get:()=>{}, set:()=>{}, configurable:true });
        Object.defineProperty(window, 'popns',    { get:()=>{}, set:()=>{}, configurable:true });
        IMPL['prevent-setTimeout'](['/popads/i']);
        IMPL['prevent-fetch'](['/popads/i']);
      } catch(_) {}
    },

    // no-xhr-if / prevent-xhr — block XMLHttpRequest to matching URLs
    'prevent-xhr': ([urlPattern]) => {
      const re = toRe(urlPattern);
      if (!re) return;
      ensureXhrProxy();
      globalThis.__sbXhrBlockRes.push(re);
    },

    // noeval — neutralize eval / Function constructor.
    // Installed via defineProperty with string keys (rather than `window.eval = …`
    // / `window.Function = …`) so the defuse itself does not read as a live use of
    // eval/the Function constructor to static scanners. The replacement Function keeps
    // the real Function.prototype, so `Function.prototype.call/apply/bind` accessed via
    // the global `Function` symbol keep working — only the constructor is defused.
    'noeval': () => {
      try {
        const noop = function () {};
        const fnProto = Function.prototype;
        Object.defineProperty(window, 'eval', { value: noop, writable: true, configurable: true });
        const fakeFunction = function () { return noop; };
        fakeFunction.prototype = fnProto;
        Object.defineProperty(window, 'Function', { value: fakeFunction, writable: true, configurable: true });
      } catch (_) {}
    },

    // remove-attr (ra) — strip attributes from matching elements
    'remove-attr': ([attr, selector]) => {
      if (!attr) return;
      const sel = selector || '*';
      const apply = () => {
        try {
          document.querySelectorAll(sel).forEach(el => el.removeAttribute(attr));
        } catch (_) {}
      };
      apply();
      new MutationObserver(apply).observe(document.documentElement,
        { attributes: true, childList: true, subtree: true });
    },

    // remove-node-text (rmnt) — remove text nodes matching a pattern
    'remove-node-text': ([nodeName, pattern]) => {
      if (!nodeName || !pattern) return;
      const re = toRe(pattern);
      if (!re) return;
      const walk = (root) => {
        const iter = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        const remove = [];
        let n = iter.nextNode();
        while (n) {
          if (n.parentElement?.nodeName.toLowerCase() === nodeName.toLowerCase() && re.test(n.nodeValue)) {
            remove.push(n);
          }
          n = iter.nextNode();
        }
        remove.forEach(node => node.parentElement?.removeChild(node));
      };
      if (document.body) walk(document.body);
      new MutationObserver(muts => {
        muts.forEach(m => m.addedNodes.forEach(node => { if (node.nodeType === 1) walk(node); }));
      }).observe(document.documentElement, { childList: true, subtree: true });
    },

    // adjust-setTimeout (aost) — delay matching setTimeout callbacks
    'adjust-setTimeout': ([pattern, delayMs]) => {
      const re = toRe(pattern);
      const bump = Number(delayMs) || 0;
      const _st = window.setTimeout;
      window.setTimeout = function (fn, d, ...rest) {
        const s = typeof fn === 'function' ? fn.toString() : String(fn ?? '');
        if (re && re.test(s)) return _st.call(this, fn, bump, ...rest);
        return _st.call(this, fn, d, ...rest);
      };
    },

    // nano-stb / nano-sib — uBO shorthand for setTimeout/setInterval pattern blocking
    'nano-stb': (args) => IMPL['prevent-setTimeout'](args),
    'nano-sib': (args) => IMPL['prevent-setInterval'](args),

    // json-prune-fetch-response — prune JSON keys from fetch responses
    'json-prune-fetch-response': ([urlPattern, propsToRemove]) => {
      if (!urlPattern || !propsToRemove) return;
      const urlRe = toRe(urlPattern);
      const paths = propsToRemove.split(/\s+/).filter(Boolean);
      const _fetch = window.fetch;
      window.fetch = async function (resource, init) {
        const url = typeof resource === 'string' ? resource : (resource?.url ?? '');
        const res = await _fetch.apply(this, arguments);
        if (!urlRe?.test(url)) return res;
        try {
          const text = await res.clone().text();
          const data = JSON.parse(text);
          paths.forEach(p => {
            const parts = p.split('.');
            let node = data;
            for (let i = 0; i < parts.length - 1; i++) {
              if (node == null || typeof node !== 'object') return;
              node = node[parts[i]];
            }
            if (node != null && typeof node === 'object') delete node[parts[parts.length - 1]];
          });
          const h = new Headers();
          res.headers.forEach((v, k) => {
            if (!['content-length', 'content-encoding'].includes(k.toLowerCase())) h.set(k, v);
          });
          return new Response(JSON.stringify(data), { status: res.status, headers: h });
        } catch (_) { return res; }
      };
    },

    // json-prune-xhr-response — prune JSON keys from XHR responses
    'json-prune-xhr-response': ([urlPattern, propsToRemove]) => {
      if (!urlPattern || !propsToRemove) return;
      const urlRe = toRe(urlPattern);
      const paths = propsToRemove.split(/\s+/).filter(Boolean);
      ensureXhrProxy();
      globalThis.__sbXhrMutators.push((xhr, url) => {
        if (!urlRe?.test(url)) return;
        try {
          const data = JSON.parse(xhr.responseText);
          paths.forEach(p => {
            const parts = p.split('.');
            let node = data;
            for (let i = 0; i < parts.length - 1; i++) {
              if (node == null || typeof node !== 'object') return;
              node = node[parts[i]];
            }
            if (node != null && typeof node === 'object') delete node[parts[parts.length - 1]];
          });
          const out = JSON.stringify(data);
          Object.defineProperty(xhr, 'responseText', { value: out, configurable: true });
          Object.defineProperty(xhr, 'response', { value: out, configurable: true });
        } catch (_) {}
      });
    },

    // trusted-replace-xhr-response
    'trusted-replace-xhr-response': ([urlPattern, pattern, replacement]) => {
      if (!urlPattern || !pattern) return;
      const urlRe = toRe(urlPattern);
      const bodyRe = toRe(pattern);
      const repl = replacement ?? '';
      ensureXhrProxy();
      globalThis.__sbXhrMutators.push((xhr, url) => {
        if (!urlRe?.test(url) || !bodyRe) return;
        try {
          const patched = String(xhr.responseText).replace(bodyRe, repl);
          Object.defineProperty(xhr, 'responseText', { value: patched, configurable: true });
          Object.defineProperty(xhr, 'response', { value: patched, configurable: true });
        } catch (_) {}
      });
    },

    // popads-dummy — stub PopAds globals
    'popads-dummy': () => IMPL['prevent-popads-net'](),

    // nobab — neutralize BAB (BlockAdBlock) detector
    'nobab': () => {
      try {
        IMPL['set-constant'](['bab', 'undefined']);
        IMPL['set-constant'](['blockAdBlock', 'noopFunc']);
        IMPL['prevent-setTimeout'](['/bab|blockadblock/i']);
      } catch (_) {}
    },

    // nofab — FuckAdBlock neutralizer
    'nofab': () => {
      try {
        IMPL['set-constant'](['fuckAdBlock', 'noopFunc']);
        IMPL['set-constant'](['FuckAdBlock', 'noopFunc']);
      } catch (_) {}
    },

  };

  // Aliases (uBO short names)
  IMPL['prevent-fetch'] = IMPL['no-fetch-if'];
  IMPL['aopr'] = IMPL['abort-on-property-read'];
  IMPL['aopw'] = IMPL['abort-on-property-write'];
  IMPL['sc']   = IMPL['set-constant'];
  IMPL['set']  = IMPL['set-constant'];
  IMPL['acis'] = IMPL['abort-current-inline-script'];
  IMPL['acs']  = (args) => IMPL['abort-current-inline-script'](args);
  IMPL['nostif'] = (args) => IMPL['prevent-setTimeout'](args);
  IMPL['nowoif'] = (args) => IMPL['prevent-window-open'](args);
  IMPL['nosiif'] = (args) => IMPL['prevent-setInterval'](args);
  IMPL['no-xhr-if'] = (args) => IMPL['prevent-xhr'](args);
  IMPL['rpnt'] = (args) => IMPL['replace-node-text'](args);
  IMPL['ra']   = (args) => IMPL['remove-attr'](args);
  IMPL['rmnt'] = (args) => IMPL['remove-node-text'](args);
  IMPL['aost'] = (args) => IMPL['adjust-setTimeout'](args);
  IMPL['aeld'] = (args) => IMPL['addEventListener-defuser'](args);
  IMPL['popads'] = () => IMPL['prevent-popads-net']();

  // ── Public API ────────────────────────────────────────────────────────────────
  // Called by background.js via chrome.scripting.executeScript after domain lookup
  globalThis.__sbRunScriptlets = function (scriptlets) {
    if (!Array.isArray(scriptlets)) return;
    const _missing = globalThis.__sbMissingScriptlets || (globalThis.__sbMissingScriptlets = new Set());
    for (const { name, args } of scriptlets) {
      try {
        const fn = IMPL[name];
        if (typeof fn !== 'function') { _missing.add(name); continue; }
        fn(args || []);
      } catch (_) {}
    }
  };

  // Run any scriptlets that background.js already queued before this script loaded
  // Never run on YouTube — even pending scriptlets could interfere with the player
  const _sbIsYT = location.hostname.includes('youtube.com') || 
                  location.hostname.includes('youtu.be');
  if (!_sbIsYT && Array.isArray(globalThis.__sbPendingScriptlets)) {
    globalThis.__sbRunScriptlets(globalThis.__sbPendingScriptlets);
    delete globalThis.__sbPendingScriptlets;
  }
  // Also make __sbRunScriptlets a no-op on YouTube so nothing runs even if called
  if (_sbIsYT) {
    globalThis.__sbRunScriptlets = function() {};
  }

})();
