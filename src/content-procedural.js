/**
 * ShieldBlock Pro — Procedural Cosmetic Filter Engine v2.0
 *
 * Implements uBO-style procedural pseudo-classes that Chrome's CSS engine
 * doesn't support natively. Also applies domain-scoped cosmetic rules and
 * handles the interactive element picker.
 */

(async () => {
  if (!location.href.startsWith('http')) return;

  // If SW is waking up when this fires, sendMessage throws silently. Retry once.
  let settings, stored;
  try {
    const [_s, _st] = await Promise.all([
      chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }),
      chrome.storage.local.get(['domainCosmetics', 'customHideRules']),
    ]);
    settings = _s; stored = _st;
  } catch (_) {
    await new Promise(r => setTimeout(r, 300));
    try {
      const [_s, _st] = await Promise.all([
        chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }),
        chrome.storage.local.get(['domainCosmetics', 'customHideRules']),
      ]);
      settings = _s; stored = _st;
    } catch (_) { settings = null; stored = {}; }
  }
  if (settings?.globalPause) return;
  if (!settings?.cosmetic) return;

  const host  = location.hostname.replace(/^www\./, '');
  // Skip entirely on YouTube — nothing to do there
  if (host.includes('youtube.com') || host.includes('youtu.be')) return;
  const _wl   = settings?.whitelist ?? [];
  if (_wl.some(d => host === d || host.endsWith('.' + d))) return;

  const domainCosmetics  = stored.domainCosmetics  ?? {};
  const customHideRules  = stored.customHideRules   ?? [];

  // ── Collect all selectors for this domain ─────────────────────────────────
  const applicable = [
    ...(domainCosmetics[host] || []),
    ...Object.entries(domainCosmetics)
       .filter(([d]) => d !== host && host.endsWith('.' + d))
       .flatMap(([, v]) => v),
    ...customHideRules,
  ].filter(Boolean);

  const PROCEDURAL_MARKERS = [':has-text(', ':matches-css(', ':upward(', ':xpath('];
  const procedural = applicable.filter(s => PROCEDURAL_MARKERS.some(m => s.includes(m)));
  const plain      = applicable.filter(s => !procedural.includes(s));

  // ── Plain domain-scoped rules — inject via <style> ────────────────────────
  // NOTE: content scripts cannot call chrome.scripting.insertCSS.
  // We inject a <style> element directly — same effect, works everywhere.
  if (plain.length > 0) {
    try {
      const css = [...new Set(plain)].join(',\n') + ' { display:none!important; }';
      const style = document.createElement('style');
      style.id = '_sb_domain_cosmetic';
      style.textContent = css;
      (document.head || document.documentElement).appendChild(style);
    } catch (_e) { console.warn('[SB:procedural]', _e?.message ?? _e); }
  }

  // ── Procedural filter engine ──────────────────────────────────────────────
  function toRe(s) {
    if (!s) return null;
    if (s.startsWith('/') && s.lastIndexOf('/') > 0) {
      const li = s.lastIndexOf('/');
      try { return new RegExp(s.slice(1, li), s.slice(li + 1)); } catch (_) { return null; }
    }
    try { return new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')); } catch (_) { return null; }
  }

  /**
   * BUG FIX: Extract a procedural pseudo-class argument using balanced-paren matching.
   * Old code used a regex like /^(.*?):has-text\((.+)\)$/ which breaks on patterns
   * containing nested parens, e.g. div:has-text(text(node)) → arg was "text(node" not "text(node)".
   * New parser walks chars and counts depth, so all nesting is handled correctly.
   */
  function extractProc(sel, pseudoName) {
    const marker = ':' + pseudoName + '(';
    const idx = sel.indexOf(marker);
    if (idx === -1) return null;
    let depth = 0, end = -1;
    for (let i = idx + marker.length - 1; i < sel.length; i++) {
      if (sel[i] === '(') depth++;
      else if (sel[i] === ')') { if (--depth === 0) { end = i; break; } }
    }
    if (end === -1) return null; // unbalanced parens — skip
    return { base: sel.slice(0, idx).trim(), arg: sel.slice(idx + marker.length, end), rest: sel.slice(end + 1) };
  }

  function applyProcedural(sel) {
    try {
      let p;

      // :has-text — removes elements whose text content matches a pattern
      if ((p = extractProc(sel, 'has-text'))) {
        const re = toRe(p.arg); if (!re) return;
        document.querySelectorAll(p.base || '*').forEach(el => {
          if (re.test(el.textContent)) el.remove();
        });
        return;
      }

      // :matches-css — removes elements with matching computed style property
      if ((p = extractProc(sel, 'matches-css'))) {
        const cssM = p.arg.match(/^([a-z-]+)\s*:\s*(.+)$/);
        if (!cssM) return;
        const re = toRe(cssM[2]); if (!re) return;
        document.querySelectorAll(p.base || '*').forEach(el => {
          try { if (re.test(window.getComputedStyle(el).getPropertyValue(cssM[1]))) el.remove(); }
          catch (_) {}
        });
        return;
      }

      // :upward(n|selector) — removes the nth ancestor (or closest matching ancestor) of each match
      if ((p = extractProc(sel, 'upward'))) {
        const steps = parseInt(p.arg, 10);
        const toRemove = new Set();
        document.querySelectorAll(p.base || '*').forEach(el => {
          let node = el;
          if (!isNaN(steps)) {
            for (let i = 0; i < steps; i++) node = node?.parentElement;
            if (node) toRemove.add(node);
          } else {
            const ancestor = el.closest(p.arg.trim());
            if (ancestor) toRemove.add(ancestor);
          }
        });
        toRemove.forEach(el => el.remove());
        return;
      }

      // :xpath — XPath-based element selection and removal
      if ((p = extractProc(sel, 'xpath'))) {
        try {
          const result = document.evaluate(p.arg, document, null,
            XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
          for (let i = 0; i < result.snapshotLength; i++) result.snapshotItem(i)?.remove();
        } catch (_e) { console.warn('[SB:procedural]', _e?.message ?? _e); }
      }
    } catch (_e) { console.warn('[SB:procedural]', _e?.message ?? _e); }
  }

  function runProcedural() {
    procedural.forEach(applyProcedural);
  }

  let _procObs = null;
  let _procDeb = null;
  if (procedural.length > 0) {
    runProcedural();
    _procObs = new MutationObserver((muts) => {
      if (muts.every(m => m.type === 'characterData')) return;
      clearTimeout(_procDeb); _procDeb = setTimeout(runProcedural, 500);
    });
    _procObs.observe(document.body || document.documentElement, { childList: true, subtree: true });
  }

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.settings?.newValue?.cosmetic === false) {
      _procObs?.disconnect(); clearTimeout(_procDeb);
    }
  });

  window.addEventListener('beforeunload', () => {
    _procObs?.disconnect(); clearTimeout(_procDeb);
  }, { once: true });

  // ── Element Picker ────────────────────────────────────────────────────────
  let _pickerActive = false;
  let _highlight    = null;

  function buildSelector(el) {
    if (!el || el === document.body) return 'body';
    const tag = el.tagName.toLowerCase();

    // Stable ID
    if (el.id && !el.id.match(/^\d|random|temp/i)) return '#' + CSS.escape(el.id);

    // Stable data attributes
    for (const attr of ['data-testid', 'data-component', 'data-module', 'data-type']) {
      const v = el.getAttribute(attr);
      if (v && v.length < 60) {
        // CSS.escape is for identifiers; attribute values need CSS *string* escaping.
        // In a [attr="value"] selector, only \ and " need escaping.
        const escaped = v.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        return `[${attr}="${escaped}"]`;
      }
    }

    // Classes — filter out dynamic/state classes
    const stableClasses = [...(el.classList || [])].filter(c =>
      c.length > 2 && !c.match(/\d{3,}|active|selected|open|visible|hidden|hover|focus|disabled/i)
    );
    if (stableClasses.length > 0) {
      return tag + '.' + stableClasses.slice(0, 2).map(CSS.escape).join('.');
    }

    // Nth-child fallback
    const parent = el.parentElement;
    if (parent) {
      const idx = [...parent.children].indexOf(el) + 1;
      return buildSelector(parent) + ` > ${tag}:nth-child(${idx})`;
    }
    return tag;
  }

  function activatePicker() {
    if (_pickerActive) return;
    _pickerActive = true;

    // Highlight overlay
    _highlight = document.createElement('div');
    _highlight.id = '_sb_picker_highlight';
    _highlight.style.cssText = [
      'position:fixed', 'pointer-events:none', 'z-index:2147483647',
      'border:2px solid #7c6aff', 'background:rgba(124,106,255,0.15)',
      'border-radius:3px', 'transition:all 0.05s', 'display:none',
    ].join(';');
    document.body.appendChild(_highlight);

    // Instruction toast
    const toast = document.createElement('div');
    toast.id = '_sb_picker_toast';
    toast.style.cssText = [
      'position:fixed', 'bottom:20px', 'left:50%', 'transform:translateX(-50%)',
      'background:#1a1a2e', 'border:1px solid #7c6aff', 'border-radius:8px',
      'padding:10px 18px', 'z-index:2147483647', 'color:#e2e2f0',
      'font:13px/1.4 -apple-system,sans-serif', 'pointer-events:none',
      'box-shadow:0 4px 20px rgba(0,0,0,0.5)',
    ].join(';');
    toast.textContent = '🛡 Click an element to hide it. Press Esc to cancel.';
    document.body.appendChild(toast);

    let _rafPending = false;
    let _pendingRect = null;

    const onMove = (e) => {
      if (!_pickerActive) return;
      const el = document.elementFromPoint(e.clientX, e.clientY);
      if (!el || el === _highlight || el === toast) return;
      _highlight._el = el;
      _pendingRect = el.getBoundingClientRect();
      // Batch style writes in rAF — avoids forced layout on every mousemove tick
      if (!_rafPending) {
        _rafPending = true;
        requestAnimationFrame(() => {
          _rafPending = false;
          if (!_pendingRect || !_pickerActive) return;
          const r = _pendingRect;
          // NOTE: _highlight is position:fixed so top/left are viewport coords.
          // getBoundingClientRect() already returns viewport-relative coords.
          // Adding scrollY/scrollX here was wrong and caused misalignment when scrolled.
          _highlight.style.top    = r.top    + 'px';
          _highlight.style.left   = r.left   + 'px';
          _highlight.style.width  = r.width  + 'px';
          _highlight.style.height = r.height + 'px';
          _highlight.style.display = 'block';
        });
      }
    };

    const onClick = (e) => {
      if (!_pickerActive) return;
      const el = _highlight._el;
      if (!el) return;
      e.preventDefault(); e.stopPropagation();
      const sel = buildSelector(el);
      el.style.cssText += ';display:none!important';
      chrome.runtime.sendMessage({ type: 'ADD_CUSTOM_RULE', selector: sel }).catch(() => {});

      // Show confirmation BEFORE deactivating — deactivatePicker() removes the toast.
      // Update in place then schedule removal; deactivate cleans up highlight + cursor.
      toast.textContent = `✅ Hidden: ${sel.slice(0, 50)}`;
      toast.style.display = 'block';
      setTimeout(() => toast.remove(), 2500);

      // Deactivate picker state (removes highlight overlay + listeners) but NOT the toast
      _pickerActive = false;
      _highlight?.remove(); _highlight = null;
      document.removeEventListener('mousemove', onMove, true);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('keydown', onKey, true);
      document.body.style.cursor = '';
    };

    const onKey = (e) => { if (e.key === 'Escape') deactivatePicker(); };

    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKey, true);
    document.body.style.cursor = 'crosshair';

    const deactivatePicker = () => {
      _pickerActive = false;
      _highlight?.remove(); _highlight = null;
      document.removeEventListener('mousemove', onMove, true);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('keydown', onKey, true);
      document.body.style.cursor = '';
      toast.remove();
    };
  }

  // ── Right-click element tracking ─────────────────────────────────────────
  // Track the last right-clicked element so the context menu can hide it
  let _lastRclick = null;
  document.addEventListener('contextmenu', (e) => {
    _lastRclick = e.target;
  }, true);

  // Listen for messages from popup/background
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'ACTIVATE_PICKER') {
      activatePicker();
      sendResponse({ ok: true });
      return true;
    }
    if (msg.type === 'DEACTIVATE_PICKER') {
      sendResponse({ ok: true });
      return true;
    }
    if (msg.type === 'HIDE_LAST_RCLICK' && _lastRclick) {
      const el = _lastRclick;
      const sel = buildSelector(el);
      el.style.setProperty('display', 'none', 'important');
      // Don't include tabId — sender.tab.id is undefined in a content script's
      // onMessage listener when the background is the sender. Background uses its
      // own sender.tab.id from the onMessage closure instead.
      chrome.runtime.sendMessage({ type: 'HIDE_ELEMENT', selector: sel }).catch(() => {});
      // Log the event
      chrome.runtime.sendMessage({ type: 'LOG_EVENT', source: 'picker',
        level: 'info', message: `Right-click hidden: ${sel}` }).catch(() => {});
      sendResponse({ ok: true, selector: sel });
      return true;
    }
    if (msg.type === 'REPORT_LAST_RCLICK' && _lastRclick) {
      const el = _lastRclick;
      const sel = buildSelector(el);
      chrome.runtime.sendMessage({ type: 'LOG_EVENT', source: 'report',
        level: 'warn', message: `Reported ad: ${sel}`,
        data: { url: location.href, html: el.outerHTML?.slice(0, 200) } }).catch(() => {});
      el.style.setProperty('display', 'none', 'important');
      sendResponse({ ok: true });
      return true;
    }
    if (msg.type === 'GLOBAL_PAUSE') { _procObs?.disconnect(); clearTimeout(_procDeb); }
    if (msg.type === 'GLOBAL_RESUME') {
      if (_procObs) _procObs.observe(document.body || document.documentElement, { childList: true, subtree: true });
      runProcedural();
    }
  });

})().catch(e => console.warn('[SB:procedural] script error:', e?.message ?? e));
