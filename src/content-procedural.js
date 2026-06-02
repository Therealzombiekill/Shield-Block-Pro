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

  // Markers come from the shared engine (procedural-engine.js) so the parser,
  // engine, and this splitter stay in lockstep.
  const PROCEDURAL_MARKERS = (globalThis.__sbProc && globalThis.__sbProc.MARKERS) ||
    [':has-text(', ':matches-css(', ':upward(', ':xpath(', ':matches-attr(', ':min-text-length('];
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
  // Matching logic lives in procedural-engine.js (globalThis.__sbProc) so it is
  // unit-tested and supports CHAINING (e.g. :has-text(x):upward(2)). Here we just
  // supply the DOM adapter and remove what it resolves to.
  const _ctx = {
    queryAll: (sel) => { try { return Array.from(document.querySelectorAll(sel)); } catch (_) { return []; } },
    getText:  (el) => el.textContent || '',
    getStyle: (el, prop) => { try { return window.getComputedStyle(el).getPropertyValue(prop); } catch (_) { return ''; } },
    attrs:    (el) => el.attributes || [],
    parent:   (el) => el.parentElement,
    closest:  (el, sel) => { try { return el.closest(sel); } catch (_) { return null; } },
    xpath:    (expr, el) => {
      try {
        const r = document.evaluate(expr, el || document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
        const out = [];
        for (let i = 0; i < r.snapshotLength; i++) out.push(r.snapshotItem(i));
        return out;
      } catch (_) { return []; }
    },
  };

  function applyProcedural(sel) {
    if (!globalThis.__sbProc) return; // engine not loaded — skip (never mis-target)
    try {
      __sbProc.evaluate(sel, _ctx).forEach(el => { try { el && el.remove && el.remove(); } catch (_) {} });
    } catch (_e) { console.warn('[SB:procedural]', _e?.message ?? _e); }
  }

  function runProcedural() {
    procedural.forEach(applyProcedural);
  }

  let _procDeb = null;
  let _procObserver = null;
  if (procedural.length > 0) {
    runProcedural();
    _procObserver = new MutationObserver((muts) => {
      if (muts.every(m => m.type === 'characterData')) return;
      clearTimeout(_procDeb); _procDeb = setTimeout(runProcedural, 500);
    });
    _procObserver.observe(document.body || document.documentElement, { childList: true, subtree: true });
  }

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.settings?.newValue?.cosmetic === false) {
      _procObserver?.disconnect();
      _procObserver = null;
      clearTimeout(_procDeb);
      // Remove injected style block
      document.getElementById('_sb_domain_cosmetic')?.remove();
    }
  });

  // ── Element Picker ────────────────────────────────────────────────────────
  let _pickerActive = false;
  let _highlight    = null;
  let _deactivatePicker = null; // set by activatePicker; called by DEACTIVATE_PICKER message

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
      _deactivatePicker = null;
      _highlight?.remove(); _highlight = null;
      document.removeEventListener('mousemove', onMove, true);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('keydown', onKey, true);
      document.body.style.cursor = '';
      toast.remove();
    };
    _deactivatePicker = deactivatePicker;
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
      _deactivatePicker?.();
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
  });

})().catch(e => console.warn('[SB:procedural] script error:', e?.message ?? e));
