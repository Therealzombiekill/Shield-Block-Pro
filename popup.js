// ShieldBlock Pro — Popup JS v3

const $ = id => document.getElementById(id);

function formatTimeSaved(s) {
  s = Math.floor(s || 0);
  if (s < 60)    return s + 's';
  if (s < 3600)  return Math.floor(s / 60) + 'm';
  if (s < 86400) { const h = Math.floor(s/3600), m = Math.floor((s%3600)/60); return m ? `${h}h ${m}m` : `${h}h`; }
  const d = Math.floor(s/86400), h = Math.floor((s%86400)/3600); return h ? `${d}d ${h}h` : `${d}d`;
}

// ── Nav ───────────────────────────────────────────────────────────────
// ── Single consolidated nav handler ──────────────────────────────────────────
let _logInterval = null;
let _catalog     = null;      // curated filter catalog (lazy-loaded)
let _catalogCat  = 'ads';     // active catalog category
let _catalogOpen = false;     // catalog panel visibility state
document.querySelectorAll('.nb').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nb').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    $('panel-' + btn.dataset.panel)?.classList.add('active');

    clearInterval(_logInterval);

    switch (btn.dataset.panel) {
      case 'stats':
        refreshStats();
        drawSparkline();
        checkPauseStatus();
        checkGlobalPause();
        refreshMatrix();
        refreshPageLog();
        refreshTopDomains();
        break;
      case 'whitelist':
        refreshWhitelist();
        refreshCustomRules();
        break;
      case 'log':
        refreshLog();
        _logInterval = setInterval(refreshLog, 2000);
        break;
      case 'filters':
        loadUserFilters();
        loadCustomLists();
        refreshListStatus();
        if (_catalogOpen) renderCatalog();
        break;
      case 'support':
        refreshFilterStatus(); // update rule count in the fbar
        break;
    }
  });
});

// ── Message helper — handles suspended service worker ─────────────────
async function msg(type, extra = {}) {
  try { return await chrome.runtime.sendMessage({ type, ...extra }); }
  catch (e) {
    if (e?.message?.includes('Could not establish') ||
        e?.message?.includes('receiving end')) {
      await new Promise(r => setTimeout(r, 300));
      try { return await chrome.runtime.sendMessage({ type, ...extra }); }
      catch (_) { return null; }
    }
    return null;
  }
}

// ── Number formatter ──────────────────────────────────────────────────
const fmt = n => {
  n = n || 0;
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return String(n);
};

// ── Stats ─────────────────────────────────────────────────────────────
let _lastTotal = 0;

async function refreshStats() {
  try {
    const [s, lt, ps, stored] = await Promise.all([
      msg('GET_STATS'), msg('GET_LIFETIME'), msg('GET_PAGE_STATS'),
      chrome.storage.local.get(['timeSaved','filterSyncedAt']),
    ]);
    const stats = s  ?? { total:0, amazon:0, general:0, social:0, cookies:0 };
    const life  = lt ?? { total:0 };
    const page  = ps ?? { total:0 };

    const total = stats.total || 0;
    const el = $('stat-total');
    el.textContent = fmt(total);

    // Flash accent color when count increases
    if (total > _lastTotal && _lastTotal > 0) {
      el.classList.add('flash');
      setTimeout(() => el.classList.remove('flash'), 600);
    }
    _lastTotal = total;

    $('s-yt').textContent = fmt(stats.youtube  || 0);
    $('s-tw').textContent = fmt(stats.twitch   || 0);
    $('s-sp').textContent = fmt(stats.spotify  || 0);
    $('s-az').textContent = fmt(stats.amazon   || 0);
    $('s-hl').textContent = fmt(stats.hulu     || 0);
    $('s-kk').textContent = fmt(stats.kick     || 0);
    $('s-sc').textContent = fmt(stats.social   || 0);
    $('s-ck').textContent = fmt(stats.cookies  || 0);
    $('s-wb').textContent = fmt(stats.general  || 0);
    $('stat-lifetime').textContent = fmt(life.total) + ' total';
    $('stat-time-saved').textContent = formatTimeSaved(stored?.timeSaved ?? 0);

    const syncedAt = stored?.filterSyncedAt;
    if ($('stat-last-sync')) {
      if (!syncedAt) {
        $('stat-last-sync').textContent = 'never';
      } else {
        const age = Date.now() - syncedAt;
        const mins = Math.floor(age / 60000);
        const hrs  = Math.floor(age / 3600000);
        const days = Math.floor(age / 86400000);
        $('stat-last-sync').textContent =
          days  > 0 ? `${days}d ago` :
          hrs   > 0 ? `${hrs}h ago`  :
          mins  > 0 ? `${mins}m ago` : 'just now';
      }
    }

    const n = page.total ?? 0;
    if (n > 0) {
      const parts = [];
      if (page.amazon  > 0) parts.push(`${fmt(page.amazon)} amz`);
      if (page.social  > 0) parts.push(`${fmt(page.social)} social`);
      if (page.cookies > 0) parts.push(`${fmt(page.cookies)} 🍪`);
      if (page.general > 0) parts.push(`${fmt(page.general)} web`);
      $('stat-page').textContent = parts.length
        ? fmt(n) + ' · ' + parts.join(' · ')
        : fmt(n) + ' blocked';
    } else {
      $('stat-page').textContent = '—';
    }

    // Also draw the sparkline when stats refresh
    drawSparkline();
  } catch (_) {
    $('stat-total').textContent = '—';
  }
}

$('reset-btn')?.addEventListener('click', async () => {
  await msg('RESET_STATS');
  _lastTotal = 0;
  refreshStats();
});

// ── Per-page blocked requests ─────────────────────────────────────────────────
async function refreshPageLog() {
  const list = $('page-log-list');
  if (!list) return;
  try {
    const entries = await msg('GET_PAGE_LOG') ?? [];
    if (!entries.length) { list.textContent = 'Nothing blocked on this page yet'; return; }
    // Count by domain
    const counts = new Map();
    for (const e of entries) counts.set(e.url, (counts.get(e.url) || 0) + 1);
    const sorted = [...counts.entries()].sort((a,b) => b[1]-a[1]).slice(0, 8);
    list.textContent = '';
    const frag = document.createDocumentFragment();
    for (const [domain, count] of sorted) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;justify-content:space-between;padding:1px 0;color:var(--muted)';
      row.innerHTML = `<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1">${escapeHtml(domain)}</span><span style="color:var(--red);margin-left:8px;flex-shrink:0">${count}×</span>`;
      frag.appendChild(row);
    }
    list.appendChild(frag);
  } catch (_) { list.textContent = '—'; }
}

// ── Top blocked domains (session) ─────────────────────────────────────────────
async function refreshTopDomains() {
  const list = $('top-domains-list');
  const sbBadge = $('sb-indicator');
  if (!list) return;
  try {
    const [domains, sbStatus] = await Promise.all([
      msg('GET_TOP_DOMAINS').then(r => r ?? []),
      msg('GET_SAFE_BROWSING_STATUS').then(r => r ?? {}),
    ]);

    // Safe browsing indicator
    if (sbBadge && sbStatus.domainCount > 0) {
      sbBadge.style.display = '';
      sbBadge.title = `Safe browsing active — ${sbStatus.domainCount.toLocaleString()} threat domains`;
    }

    if (!domains.length) { list.textContent = 'No blocks recorded yet'; return; }
    const max = domains[0]?.count || 1;
    list.textContent = '';
    const frag = document.createDocumentFragment();
    for (const { domain, count } of domains.slice(0, 10)) {
      const pct = Math.round((count / max) * 100);
      const row = document.createElement('div');
      row.style.cssText = 'margin-bottom:3px';
      row.innerHTML = `
        <div style="display:flex;justify-content:space-between;font-size:9px;margin-bottom:1px">
          <span style="color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1">${escapeHtml(domain)}</span>
          <span style="color:var(--muted);margin-left:6px;flex-shrink:0">${count}</span>
        </div>
        <div style="height:2px;background:var(--border);border-radius:1px">
          <div style="height:2px;width:${pct}%;background:var(--accent);border-radius:1px;transition:width .3s"></div>
        </div>`;
      frag.appendChild(row);
    }
    list.appendChild(frag);
  } catch (_) { list.textContent = '—'; }
}


async function refreshFilterStatus() {
  try {
    const s = await msg('GET_FILTER_STATUS');
    // BUG NOTE: +725 was a hardcoded approximation of the static bundled rule count
    // (base.json + extended.json + tracking.json + hosts.json). Using activeRules +
    // staticRules when the background reports it, otherwise fall back to raw activeRules.
    const staticRules = s?.staticRules ?? 725; // background now reports this if available
    const active = (s?.activeRules || 0) + staticRules;
    const dot  = $('fdot');
    const text = $('ftext');
    if (s?.syncError) {
      dot.className = 'fdot';
      dot.style.background = 'var(--red)';
      const _se = (s.syncError||'').slice(0, 30);
      dot.title = s.syncError;
      text.textContent = '';
      const _eb = document.createElement('strong');
      _eb.style.color = 'var(--red)'; _eb.textContent = 'sync error';
      text.appendChild(_eb);
      text.appendChild(document.createTextNode(' — ' + _se));
    } else if (active > 0) {
      dot.className = 'fdot';
      dot.style.background = '';
      const failures = s?.syncFailures ?? 0;
      if (failures > 0) dot.className = 'fdot warn'; // static amber — not the spinning syncing class
      text.textContent = '';
      const _ab = document.createElement('strong');
      _ab.textContent = active.toLocaleString();
      text.appendChild(_ab);
      text.appendChild(document.createTextNode(' rules active'));
      if (failures > 0) {
        const _fn = document.createElement('span');
        _fn.style.color = 'var(--yellow)'; _fn.textContent = ` (${failures} errors)`;
        text.appendChild(_fn);
      }
    } else {
      dot.className = 'fdot syncing';
      dot.style.background = '';
      text.textContent = '';
      const _sb = document.createElement('strong'); _sb.textContent = 'syncing…';
      text.appendChild(_sb);
    }
    // Update the rules count description in blockers panel
    const desc = $('rules-desc');
    if (desc && active > 0) desc.textContent = `${active.toLocaleString()} rules active`;
  } catch (_) {}
}

let _syncing = false;
$('sync-btn')?.addEventListener('click', async () => {
  if (_syncing) return;
  _syncing = true;
  $('fdot').className = 'fdot syncing';
  $('ftext').textContent = '';
  const _fb = document.createElement('strong'); _fb.textContent = 'fetching…';
  $('ftext').appendChild(_fb);
  $('sync-btn').textContent = '…';
  await msg('FORCE_SYNC');
  let tries = 0;
  const poll = setInterval(async () => {
    await refreshFilterStatus();
    const s = await msg('GET_FILTER_STATUS');
    if ((s?.activeRules ?? 0) > 0 || ++tries > 20) {
      clearInterval(poll);
      $('sync-btn').textContent = '↺ sync';
      _syncing = false;
    }
  }, 1000);
});

// ── Toggles ───────────────────────────────────────────────────────────
document.querySelectorAll('[data-s]').forEach(input => {
  input.addEventListener('change', async e => {
    await msg('SET_SETTINGS', { settings: { [e.target.dataset.s]: e.target.checked } });
  });
});

async function loadSettings() {
  const s = await msg('GET_SETTINGS');
  if (!s) return;
  document.querySelectorAll('[data-s]').forEach(input => {
    if (input.dataset.s in s) input.checked = s[input.dataset.s];
  });
}

// ── Whitelist ─────────────────────────────────────────────────────────
async function getCurrentTabDomain() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab?.url) return null;
    const url = new URL(tab.url);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.hostname.replace(/^www\./, '');
  } catch (_) { return null; }
}

function escapeHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;')
                  .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function updateStatusPill(domain, whitelist) {
  if (!domain) return;
  const wl = whitelist.some(d => domain === d || domain.endsWith('.' + d));
  const el = $('hdr-status');
  el.className = wl ? 'pill pill-off' : 'pill pill-on';
  el.textContent = '';
  const _d = document.createElement('div'); _d.className = 'dot'; el.appendChild(_d);
  el.appendChild(document.createTextNode(wl ? 'PAUSED' : 'ACTIVE'));
}

function renderWhitelistItems(whitelist, currentDomain) {
  const list = $('wl-list');
  list.textContent = '';
  if (!whitelist.length) {
    const empty = document.createElement('div'); empty.className = 'wl-empty';
    empty.textContent = 'No sites whitelisted'; list.appendChild(empty); return;
  }
  whitelist.forEach(d => {
    const item = document.createElement('div'); item.className = 'wl-item';
    const span = document.createElement('span'); span.className = 'wl-dom';
    span.textContent = d; item.appendChild(span);
    const btn = document.createElement('button'); btn.className = 'wl-rm';
    btn.dataset.domain = d; btn.title = 'Remove'; btn.textContent = '×'; item.appendChild(btn);
    list.appendChild(item);
  });
  list.querySelectorAll('.wl-rm').forEach(btn => {
    btn.addEventListener('click', async () => {
      const { whitelist: wl = [] } = await chrome.storage.local.get('whitelist');
      const idx = wl.indexOf(btn.dataset.domain);
      if (idx !== -1) wl.splice(idx, 1);
      await chrome.storage.local.set({ whitelist: wl });
      await msg('WHITELIST_UPDATED', { whitelist: wl });
      // Clean up pause state in case this domain was also paused —
      // RESUME_SITE is a no-op when the domain isn't paused, so safe to call unconditionally.
      await msg('RESUME_SITE', { domain: btn.dataset.domain });
      // Re-render with fresh storage data so the filter stays consistent
      await refreshWhitelist();
      if (btn.dataset.domain === currentDomain) $('site-toggle').checked = true;
    });
  });
}

async function refreshWhitelist() {
  const [domain, stored] = await Promise.all([
    getCurrentTabDomain(),
    chrome.storage.local.get(['whitelist', 'pauseWhitelisted']),
  ]);
  const { whitelist = [], pauseWhitelisted = [] } = stored;

  // Only show permanently-whitelisted domains in the panel.
  // Paused sites are temporarily added to the whitelist but belong to the
  // pause UI (stats panel), not the whitelist panel. Mixing them causes
  // confusion and breaks pause state when users click ×.
  const permanentList = whitelist.filter(d => !pauseWhitelisted.includes(d));

  if (domain) {
    $('site-url').textContent = domain;
    const _isWhitelisted = wl => wl.some(d => domain === d || domain.endsWith('.' + d));
    $('site-toggle').checked = !_isWhitelisted(whitelist);
    $('site-toggle').disabled = false;
    $('site-toggle').onchange = async (e) => {
      const { whitelist: wl = [] } = await chrome.storage.local.get('whitelist');
      if (!e.target.checked) { if (!wl.includes(domain)) wl.push(domain); }
      else {
        const i = wl.indexOf(domain); if (i !== -1) wl.splice(i, 1);
        // If this domain was paused, clean up pause state too —
        // RESUME_SITE is safe to call when not paused (no-op on missing entry).
        msg('RESUME_SITE', { domain });
      }
      await chrome.storage.local.set({ whitelist: wl });
      await msg('WHITELIST_UPDATED', { whitelist: wl });
      await refreshWhitelist();
    };
  } else {
    $('site-url').textContent = 'N/A (non-web page)';
    $('site-toggle').disabled = true;
  }
  renderWhitelistItems(permanentList, domain);
  updateStatusPill(domain, whitelist); // full list — paused sites correctly show as PAUSED
}

// ── Boot ──────────────────────────────────────────────────────────────
const _intervals = [];

async function boot() {
  _intervals.forEach(clearInterval);
  _intervals.length = 0;
  await Promise.all([loadSettings(), refreshStats(), refreshFilterStatus(), refreshWhitelist()]);
  $('app').classList.add('ready');
  _intervals.push(setInterval(refreshStats, 3000));
  _intervals.push(setInterval(refreshFilterStatus, 8000));

  // Check for updates (silently, non-blocking)
  setTimeout(async () => {
    try {
      const { hasUpdate, latest } = await msg('CHECK_UPDATE') ?? {};
      if (hasUpdate && latest) {
        const badge = document.querySelector('.ftr-badge');
        if (badge) {
          badge.textContent = 'UPDATE';
          badge.style.background = 'rgba(0,217,126,.15)';
          badge.style.borderColor = 'rgba(0,217,126,.3)';
          badge.style.color = 'var(--green)';
          badge.title = `v${latest} available`;
        }
      }
    } catch(_) {}
  }, 2000);
}

boot();


// ── Event log ─────────────────────────────────────────────────────────────────
let _logFilter = 'all';

function ageStr(ts) {
  const s = Math.round((Date.now() - ts) / 1000);
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s/60)}m` : `${Math.round(s/3600)}h`;
}

async function refreshLog() {
  const [events, network, persistedFull] = await Promise.all([
    msg('GET_EVENT_LOG').then(r => r ?? []),
    msg('GET_REQUEST_LOG').then(r => r ?? []),
    msg('GET_PERSISTED_LOG').then(r => r ?? []),
  ]);

  // Merge and deduplicate by ts+source+message
  const seen = new Set();
  const allEvents = [
    ...persistedFull.map(e => ({ ...e, _type: 'persisted' })),
    ...events.map(e => ({ ...e, _type: 'event' })),
    ...network.map(r => ({ source: 'network', level: 'info',
      message: (r.url||'—'), ts: r.ts, _type: 'network' })),
  ].filter(e => {
    const k = `${e.ts}:${e.source}:${e.message}`;
    if (seen.has(k)) return false;
    seen.add(k); return true;
  }).sort((a, b) => b.ts - a.ts).slice(0, 500);

  const filtered = _logFilter === 'all' ? allEvents
    : allEvents.filter(e => e.source === _logFilter);

  const list = $('log-list');
  if (!list) return;
  if (!filtered.length) {
    list.innerHTML = '<div class="log-empty">No events yet</div>';
    return;
  }

  list.textContent = '';
  const frag = document.createDocumentFragment();
  filtered.forEach(e => {
    const row = document.createElement('div'); row.className = 'log-row';
    const src = document.createElement('span');
    src.className = `log-src src-${(e.source||'general').replace(/[^a-z0-9-]/g,'')}`;
    src.textContent = e.source || '?'; row.appendChild(src);
    const dom = document.createElement('span'); dom.className = 'log-dom';
    if (e.level === 'warn') dom.style.color = 'var(--yellow)';
    else if (e.level === 'error') dom.style.color = 'var(--red)';
    dom.textContent = (e.message||'').slice(0,80); row.appendChild(dom);
    const ts = document.createElement('span'); ts.className = 'log-ts';
    ts.textContent = ageStr(e.ts); row.appendChild(ts);
    frag.appendChild(row);
  });
  list.appendChild(frag);
}

// Filter tabs
document.querySelectorAll('.log-ftag').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.log-ftag').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    _logFilter = btn.dataset.src;
    refreshLog();
  });
});

$('clear-log')?.addEventListener('click', async () => {
  await Promise.all([msg('CLEAR_LOG'), msg('CLEAR_EVENT_LOG')]);
  $('log-list').innerHTML = '<div class="log-empty">Cleared</div>';
});

$('download-log-txt')?.addEventListener('click', async () => {
  try {
    const result = await msg('EXPORT_LOG_TXT');
    if (!result?.ok || !result.text) { alert('Log export failed'); return; }
    const blob = new Blob([result.text], { type: 'text/plain;charset=utf-8;' });
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = `shieldblock-log-${new Date().toISOString().slice(0,19).replace(/:/g,'-')}.txt`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
  } catch (e) { alert('Log export failed: ' + e.message); }
});

// ── Diagnostic export (full JSON snapshot with logs + filter status) ─────────
// ── Extension health self-test ─────────────────────────────────────────────────
$('run-health-check')?.addEventListener('click', async () => {
  const btn     = $('run-health-check');
  const summary = $('health-summary');
  const checks  = $('health-checks');
  if (!summary || !checks) return;

  btn.textContent = 'Running…';
  btn.disabled    = true;
  summary.style.color = 'var(--muted)';
  summary.textContent = 'Testing…';
  checks.textContent  = '';

  try {
    const result = await msg('GET_HEALTH_STATUS');
    if (!result) { summary.textContent = 'Health check unavailable'; return; }

    const colors = { pass: 'var(--green)', warn: '#f59e0b', fail: 'var(--red,#f87171)' };
    const icons  = { pass: '✓', warn: '⚠', fail: '✗' };

    summary.style.color = colors[result.summary === 'healthy' ? 'pass' : result.summary === 'degraded' ? 'fail' : 'warn'];
    summary.textContent = result.summary === 'healthy' ? '✓ All systems healthy'
                        : result.summary === 'degraded' ? '✗ Issues detected — check items below'
                        : '⚠ Warnings — extension working but not optimal';

    checks.textContent = '';
    const frag = document.createDocumentFragment();
    for (const c of result.checks) {
      const row  = document.createElement('div');
      row.style.cssText = 'display:flex;gap:5px;padding:1px 0';
      const icon = document.createElement('span');
      icon.style.color = colors[c.status];
      icon.style.flexShrink = '0';
      icon.textContent = icons[c.status];
      const name = document.createElement('span');
      name.style.color = 'var(--text)';
      name.style.minWidth = '110px';
      name.textContent = c.name;
      const detail = document.createElement('span');
      detail.style.color = 'var(--muted)';
      detail.style.overflow = 'hidden';
      detail.style.textOverflow = 'ellipsis';
      detail.style.whiteSpace = 'nowrap';
      detail.textContent = c.detail;
      row.appendChild(icon); row.appendChild(name); row.appendChild(detail);
      frag.appendChild(row);
    }
    checks.appendChild(frag);
  } catch (e) {
    summary.style.color = 'var(--red,#f87171)';
    summary.textContent = 'Health check failed: ' + e.message;
  } finally {
    btn.textContent = 'Run check';
    btn.disabled    = false;
  }
});

$('export-diagnostic')?.addEventListener('click', async () => {
  try {
    const result = await msg('EXPORT_DIAGNOSTIC');
    if (!result?.data) { alert('Diagnostic export failed'); return; }
    const json = JSON.stringify(result.data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = `shieldblock-diagnostic-${new Date().toISOString().slice(0,19).replace(/:/g,'-')}.json`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
  } catch(e) { alert('Export failed: ' + e.message); }
});

// ── Stats CSV export ───────────────────────────────────────────────────────────
$('export-stats-csv')?.addEventListener('click', async () => {
  try {
    const { dailyStats = {}, lifetime = {}, stats = {} } =
      await chrome.storage.local.get(['dailyStats','lifetime','stats']);

    const rows = [
      ['ShieldBlock Pro — Stats Export', new Date().toLocaleDateString()],
      [],
      ['=== 30-DAY DAILY BLOCKS ==='],
      ['Date', 'Blocks'],
      ...Object.entries(dailyStats).sort().map(([d, c]) => [d, c]),
      [],
      ['=== SESSION BREAKDOWN ==='],
      ['Category',    'Count'],
      ['Network',     stats.network  ?? 0],
      ['DOM cosmetic',stats.dom      ?? 0],
      ['YouTube',     stats.youtube  ?? 0],
      ['Twitch',      stats.twitch   ?? 0],
      ['Spotify',     stats.spotify  ?? 0],
      ['Hulu',        stats.hulu     ?? 0],
      ['Kick',        stats.kick     ?? 0],
      ['Amazon',      stats.amazon   ?? 0],
      ['Social',      stats.social   ?? 0],
      ['Cookies',     stats.cookies  ?? 0],
      ['General',     stats.general  ?? 0],
      [],
      ['=== LIFETIME ==='],
      ['Lifetime total', lifetime.total ?? 0],
    ];

    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `shieldblock-stats-${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  } catch (e) { alert('CSV export failed: ' + e.message); }
});

// ── Pause All ─────────────────────────────────────────────────────────────────
async function checkGlobalPause() {
  const status = await msg('GET_GLOBAL_PAUSE');
  const btn = $('pause-all-btn');
  if (!btn) return;
  if (status?.active) {
    const mins = Math.ceil((status.until - Date.now()) / 60000);
    btn.textContent = `▶ Resume All (${mins}m left)`;
    btn.classList.add('paused');
  } else {
    const dur = parseInt($('pause-dur')?.value) || 30;
    const label = dur >= 60 ? `${dur / 60}h` : `${dur}m`;
    btn.textContent = `⏸ Pause All (${label})`;
    btn.title = `Pause ALL blocking for ${label}`;
    btn.classList.remove('paused');
  }
}

// Keep the "Pause All" label in sync with the duration selector
$('pause-dur')?.addEventListener('change', () => { checkGlobalPause(); });

$('pause-all-btn')?.addEventListener('click', async () => {
  const status = await msg('GET_GLOBAL_PAUSE');
  if (status?.active) {
    await msg('RESUME_ALL');
  } else {
    const minutes = parseInt($('pause-dur')?.value) || 30;
    await msg('PAUSE_ALL', { minutes });
  }
  checkGlobalPause();
});

// ── Per-domain filtering matrix ───────────────────────────────────────────────
const MATRIX_LABELS = {
  '3p-scripts': { label: '3P scripts',  icon: '⚙', title: 'Block 3rd-party scripts' },
  '3p-frames':  { label: '3P frames',   icon: '🖼', title: 'Block 3rd-party iframes' },
  '3p-xhr':     { label: '3P requests', icon: '📡', title: 'Block 3rd-party XHR/fetch' },
  '3p-images':  { label: '3P media',    icon: '🖼', title: 'Block 3rd-party images/media' },
};

let _currentHost = '';

async function refreshMatrix() {
  const grid   = $('matrix-grid');
  const status = $('matrix-status');
  if (!grid) return;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url?.startsWith('http')) { grid.innerHTML = ''; if (status) status.textContent = 'Not available on this page'; return; }
    _currentHost = new URL(tab.url).hostname.replace(/^www\./, '');

    const matrix = await msg('GET_MATRIX') ?? {};
    const siteRules = matrix[_currentHost] ?? {};

    grid.innerHTML = '';
    for (const [key, def] of Object.entries(MATRIX_LABELS)) {
      const current = siteRules[key] ?? 'default';
      const btn = document.createElement('button');
      btn.className = 'ghost matrix-btn';
      btn.dataset.key = key;
      btn.title = def.title;
      btn.style.cssText = 'display:flex;align-items:center;gap:4px;font-size:9px;padding:3px 5px;border-radius:4px;width:100%;' +
        (current === 'block' ? 'color:#f87171;border:1px solid rgba(248,113,113,.35);background:rgba(248,113,113,.08)' :
         current === 'allow' ? 'color:var(--green);border:1px solid rgba(74,222,128,.35);background:rgba(74,222,128,.08)' :
         'border:1px solid var(--border2)');
      btn.innerHTML = `<span>${current === 'block' ? '🔴' : current === 'allow' ? '🟢' : '⚪'}</span><span>${def.label}</span>`;
      btn.addEventListener('click', async () => {
        const next = current === 'default' ? 'block' : current === 'block' ? 'allow' : 'default';
        await msg('SET_MATRIX_RULE', { hostname: _currentHost, ruleKey: key, action: next });
        if (status) { status.textContent = `${def.label} → ${next}`; setTimeout(() => { if (status) status.textContent = ''; }, 2000); }
        refreshMatrix();
      });
      grid.appendChild(btn);
    }

    const activeCount = Object.values(siteRules).filter(v => v !== 'default').length;
    if (status) status.textContent = activeCount ? `${activeCount} rule${activeCount > 1 ? 's' : ''} active on ${_currentHost}` : '';
  } catch (e) {
    if (status) status.textContent = 'Matrix unavailable';
  }
}

$('matrix-clear')?.addEventListener('click', async () => {
  if (!_currentHost) return;
  await msg('CLEAR_MATRIX', { hostname: _currentHost });
  refreshMatrix();
});

$('pick-btn')?.addEventListener('click', async () => {
  await msg('ACTIVATE_PICKER');
  window.close();
});

// ── Custom rules ──────────────────────────────────────────────────────────────
async function refreshCustomRules() {
  const rules = await msg('GET_CUSTOM_RULES') ?? [];
  const list = $('custom-rules-list');
  if (!list) return;
  if (!rules.length) {
    list.innerHTML = '<div class="wl-empty">None — use ⊕ pick to hide elements</div>';
    return;
  }
  list.textContent = '';
  rules.forEach(r => {
    const item = document.createElement('div'); item.className = 'wl-item';
    const span = document.createElement('span'); span.className = 'wl-dom';
    span.style.cssText = 'max-width:220px;font-size:10px'; span.textContent = r.slice(0,60); item.appendChild(span);
    const btn = document.createElement('button'); btn.className = 'wl-rm';
    btn.dataset.rule = r; btn.title = 'Remove'; btn.textContent = '×'; item.appendChild(btn);
    list.appendChild(item);
  });
  list.querySelectorAll('.wl-rm').forEach(btn => {
    btn.addEventListener('click', async () => {
      await msg('REMOVE_CUSTOM_RULE', { selector: btn.dataset.rule });
      refreshCustomRules();
    });
  });
}

// ── My Filters panel ──────────────────────────────────────────────────────────
async function loadUserFilters() {
  const text = await msg('GET_USER_FILTERS') ?? '';
  const ta = $('filters-text');
  if (ta) ta.value = text;
}

$('filters-save')?.addEventListener('click', async () => {
  const text = $('filters-text')?.value ?? '';
  const status = $('filters-status');
  if (status) status.textContent = 'Applying…';
  await msg('PARSE_USER_FILTERS', { text });
  if (status) {
    status.textContent = '✓ Rules applied — reload the page to see changes';
    setTimeout(() => { if (status) status.textContent = ''; }, 4000);
  }
});

$('filters-clear')?.addEventListener('click', async () => {
  await msg('CLEAR_USER_FILTERS');
  const ta = $('filters-text');
  if (ta) ta.value = '';
  const status = $('filters-status');
  if (status) { status.textContent = '✓ Cleared'; setTimeout(() => { status.textContent = ''; }, 2000); }
});

// ── Import from clipboard (uBlock Origin / ABP format) ────────────────────────
// Reads clipboard, strips uBlock metadata lines (! Title: ..., ! Expires: ...),
// merges with existing rules, deduplicates, then saves.
$('import-ub-btn')?.addEventListener('click', async () => {
  const status = $('filters-status');
  try {
    const text = await navigator.clipboard.readText();
    if (!text.trim()) { if (status) { status.style.color = 'var(--red,#f87171)'; status.textContent = 'Clipboard is empty'; setTimeout(() => { status.textContent = ''; }, 2500); } return; }

    // Strip uBlock/ABP metadata header lines but keep filter rules
    const imported = text.split('\n')
      .filter(line => {
        const t = line.trim();
        if (!t || t.startsWith('[Adblock')) return false; // skip [Adblock Plus 2.0] header
        if (t.startsWith('!') && (t.includes('Title:') || t.includes('Expires:') ||
            t.includes('Version:') || t.includes('Homepage:') || t.includes('Licence:'))) return false;
        return true; // keep rules and comments
      })
      .join('\n');

    const ta = $('filters-text');
    const existing = (ta?.value || '').trim();
    // Merge: existing rules first, then imported, dedup by line content
    const merged = [...new Set([...existing.split('\n'), ...imported.split('\n')]
      .map(l => l.trim()).filter(Boolean))].join('\n');

    if (ta) ta.value = merged;
    const lineCount = imported.split('\n').filter(l => l.trim() && !l.trim().startsWith('!')).length;
    if (status) { status.style.color = 'var(--green)'; status.textContent = `✓ Imported ${lineCount} rules — click Apply to save`; setTimeout(() => { status.textContent = ''; }, 4000); }
  } catch (e) {
    if (status) { status.style.color = 'var(--red,#f87171)'; status.textContent = e.name === 'NotAllowedError' ? 'Clipboard permission denied' : `Import failed: ${e.message}`; setTimeout(() => { status.textContent = ''; }, 3000); }
  }
});

// ── Export / copy all rules to clipboard ─────────────────────────────────────
$('export-ub-btn')?.addEventListener('click', async () => {
  const status = $('filters-status');
  try {
    const text = $('filters-text')?.value ?? '';
    if (!text.trim()) { if (status) { status.style.color = 'var(--muted)'; status.textContent = 'No rules to copy'; setTimeout(() => { status.textContent = ''; }, 2000); } return; }
    await navigator.clipboard.writeText(text);
    if (status) { status.style.color = 'var(--green)'; status.textContent = '✓ Copied to clipboard'; setTimeout(() => { status.textContent = ''; }, 2000); }
  } catch (e) {
    if (status) { status.style.color = 'var(--red,#f87171)'; status.textContent = 'Copy failed'; setTimeout(() => { status.textContent = ''; }, 2000); }
  }
});

// ── Import from URL ───────────────────────────────────────────────────────────
// Fetches a filter list from any URL and merges its rules into the user's rules.
// Useful for small personal lists or niche community lists not in the subscription catalog.
$('import-url-btn')?.addEventListener('click', async () => {
  const input  = $('import-url-input');
  const status = $('import-url-status');
  const url    = input?.value?.trim();

  if (!url || !url.startsWith('http')) {
    if (status) { status.style.color = 'var(--red,#f87171)'; status.textContent = 'Enter a valid https:// URL'; return; }
  }
  if (status) { status.style.color = 'var(--muted)'; status.textContent = 'Fetching…'; }

  try {
    const result = await msg('FETCH_FILTER_URL', { url });
    if (!result?.ok) throw new Error(result?.error || 'Fetch failed');

    const lines = result.text.split('\n')
      .filter(l => { const t = l.trim(); return t && !t.startsWith('[Adblock'); })
      .filter(l => { const t = l.trim(); return !(t.startsWith('!') && /Title:|Expires:|Version:|Homepage:/i.test(t)); });

    const ta = $('filters-text');
    const existing = (ta?.value || '').trim();
    const merged = [...new Set([...existing.split('\n'), ...lines.map(l => l.trim())]
      .filter(Boolean))].join('\n');
    if (ta) ta.value = merged;

    const ruleCount = lines.filter(l => !l.trim().startsWith('!')).length;
    if (status) { status.style.color = 'var(--green)'; status.textContent = `✓ ${ruleCount} rules loaded — click Apply to save`; }
    if (input) input.value = '';
    setTimeout(() => { if (status) status.textContent = ''; }, 5000);
  } catch (e) {
    if (status) { status.style.color = 'var(--red,#f87171)'; status.textContent = e.message.slice(0, 50); setTimeout(() => { if (status) status.textContent = ''; }, 4000); }
  }
});

// ── Custom filter list subscriptions ──────────────────────────────────────────

function escapeHtmlCL(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

async function loadCustomLists() {
  const lists = await msg('GET_CUSTOM_LISTS') ?? [];
  const container = $('custom-lists-container');
  if (!container) return;
  if (!lists.length) {
    container.innerHTML = '<div style="font-size:10px;color:var(--muted);margin-bottom:4px">No subscriptions yet.</div>';
    return;
  }
  container.innerHTML = lists.map(l => `
    <div style="display:flex;align-items:center;gap:5px;margin-bottom:5px;background:var(--s2);border-radius:6px;padding:5px 8px">
      <div style="flex:1;min-width:0">
        <div style="font-size:10px;color:var(--text);font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtmlCL(l.name)}</div>
        <div style="font-size:9px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-family:var(--mono)">${escapeHtmlCL(l.url)}</div>
      </div>
      <button class="ghost cl-remove" data-key="${escapeHtmlCL(l.key)}" style="font-size:10px;padding:2px 7px;flex-shrink:0">✕</button>
    </div>
  `).join('');
  container.querySelectorAll('.cl-remove').forEach(btn => {
    btn.addEventListener('click', async () => {
      const r = await msg('REMOVE_CUSTOM_LIST', { key: btn.dataset.key });
      if (r?.ok) { loadCustomLists(); msg('FORCE_SYNC'); }
    });
  });
}

$('cl-add-btn')?.addEventListener('click', async () => {
  const url    = $('cl-url')?.value?.trim();
  const name   = $('cl-name')?.value?.trim();
  const status = $('cl-status');
  if (!url) { if (status) { status.style.color = 'var(--red, #f87171)'; status.textContent = 'Enter a URL first'; setTimeout(()=>{status.textContent='';},2500); } return; }
  if (status) status.textContent = 'Adding…';
  const r = await msg('ADD_CUSTOM_LIST', { url, name });
  if (r?.ok) {
    if ($('cl-url')) $('cl-url').value = '';
    if ($('cl-name')) $('cl-name').value = '';
    if (status) { status.style.color = 'var(--green)'; status.textContent = '✓ Added — syncing…'; setTimeout(()=>{status.textContent='';},3000); }
    loadCustomLists();
    msg('FORCE_SYNC');
  } else {
    if (status) { status.style.color = 'var(--red, #f87171)'; status.textContent = r?.error || 'Failed'; setTimeout(()=>{status.textContent='';},3000); }
  }
});

// ── Curated filter list catalog ────────────────────────────────────────────────

async function loadCatalog() {
  if (_catalog) return _catalog;
  try {
    const res = await fetch(chrome.runtime.getURL('src/filter-catalog.json'));
    _catalog = await res.json();
    return _catalog;
  } catch (e) { return null; }
}

async function renderCatalog() {
  const catalog = await loadCatalog();
  if (!catalog) return;
  const catRow = $('catalog-categories');
  const listEl = $('catalog-list');
  if (!catRow || !listEl) return;

  const subscribedLists = await msg('GET_CUSTOM_LISTS').then(r => r ?? []);
  const subscribedUrls  = new Set(subscribedLists.map(l => l.url));

  // Render category tabs
  catRow.textContent = '';
  for (const cat of catalog.categories) {
    const btn = document.createElement('button');
    btn.className = 'ghost log-ftag' + (cat.id === _catalogCat ? ' active' : '');
    btn.style.cssText = `font-size:9px;padding:2px 7px;border-color:${cat.color}30;color:${cat.id === _catalogCat ? cat.color : 'var(--muted)'}`;
    btn.textContent = cat.label;
    btn.addEventListener('click', () => { _catalogCat = cat.id; renderCatalog(); });
    catRow.appendChild(btn);
  }

  // Render list items for active category
  const activeCat = catalog.categories.find(c => c.id === _catalogCat);
  if (!activeCat) return;
  listEl.textContent = '';
  const frag = document.createDocumentFragment();
  for (const list of activeCat.lists) {
    const isSubbed = subscribedUrls.has(list.url);
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:flex-start;gap:6px;padding:4px 0;border-bottom:1px solid var(--border)';
    row.innerHTML =
      `<div style="flex:1;min-width:0">` +
        `<div style="color:var(--text);font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(list.name)}</div>` +
        `<div style="color:var(--muted);font-size:8px;margin-top:1px">${escapeHtml(list.desc)}</div>` +
      `</div>` +
      `<button data-url="${escapeHtml(list.url)}" data-name="${escapeHtml(list.name)}" ` +
        `class="ghost catalog-sub-btn" style="font-size:9px;padding:2px 7px;white-space:nowrap;` +
        `${isSubbed ? 'color:var(--green);border-color:rgba(74,222,128,.4)' : 'border:1px solid var(--border2)'}">` +
        `${isSubbed ? '✓ Added' : '+ Add'}` +
      `</button>`;
    frag.appendChild(row);
  }
  listEl.appendChild(frag);

  // Wire subscribe buttons
  listEl.querySelectorAll('.catalog-sub-btn').forEach(btn => {
    if (btn.textContent.trim().startsWith('✓')) return; // already subscribed
    btn.addEventListener('click', async () => {
      const url  = btn.dataset.url;
      const name = btn.dataset.name;
      btn.textContent = '…';
      btn.disabled = true;
      const r = await msg('ADD_CUSTOM_LIST', { url, name });
      if (r?.ok) {
        btn.textContent = '✓ Added';
        btn.style.color = 'var(--green)';
        btn.style.borderColor = 'rgba(74,222,128,.4)';
        loadCustomLists();
        msg('FORCE_SYNC');
      } else {
        btn.textContent = '✗ Failed';
        btn.disabled = false;
      }
    });
  });
}

$('catalog-toggle')?.addEventListener('click', async () => {
  _catalogOpen = !_catalogOpen;
  const panel = $('catalog-panel');
  const btn   = $('catalog-toggle');
  if (panel) panel.style.display = _catalogOpen ? 'block' : 'none';
  if (btn) btn.textContent = _catalogOpen ? 'Hide catalog' : 'Browse catalog';
  if (_catalogOpen) renderCatalog();
});

// ── Per-list sync status ───────────────────────────────────────────────────────
async function refreshListStatus() {
  const container = $('list-status-container');
  if (!container) return;
  const [status, filterStatus] = await Promise.all([
    msg('GET_LIST_STATUS').then(r => r ?? {}),
    msg('GET_FILTER_STATUS').then(r => r ?? {}),
  ]);
  const listStatus = Object.keys(status).length > 0 ? status : (filterStatus.listStatus ?? {});

  if (!Object.keys(listStatus).length) {
    container.innerHTML = '<span style="color:var(--muted)">No sync data yet — run a sync first</span>';
    return;
  }

  const rows = Object.entries(listStatus)
    .sort(([, a], [, b]) => {
      // errors first, then ok, then 304/cached
      const order = { error: 0, ok: 1, '304': 2, cached: 3 };
      return (order[a.status] ?? 9) - (order[b.status] ?? 9);
    })
    .map(([key, info]) => {
      const dot = info.status === 'error' ? '🔴'
                : info.status === 'ok'    ? '🟢'
                : info.status === '304'   ? '🔵'
                : '⚪';
      const ruleStr = info.ruleCount != null ? ` ${info.ruleCount}r` : '';
      const errStr  = info.error ? ` — ${info.error.slice(0, 35)}` : '';
      const errStyle = info.status === 'error' ? 'color:#f87171' : 'color:var(--muted)';
      return `<div style="display:flex;gap:4px;align-items:baseline">
        <span>${dot}</span>
        <span style="color:var(--text);flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(key)}</span>
        <span style="${errStyle}">${escapeHtml(ruleStr + errStr)}</span>
      </div>`;
    });

  container.innerHTML = rows.join('');
}

$('refresh-list-status')?.addEventListener('click', refreshListStatus);

// ── Export / Import ────────────────────────────────────────────────────────────
$('export-btn')?.addEventListener('click', async () => {
  try {
    const result = await msg('EXPORT_SETTINGS');
    if (!result?.data) { alert('Export failed — try again'); return; }
    const json    = JSON.stringify(result.data, null, 2);
    // BUG FIX: Firefox popup CSP blocks navigating a link to a data: URI.
    // Use URL.createObjectURL() with a Blob instead — works on both browsers.
    const blob    = new Blob([json], { type: 'application/json' });
    const blobUrl = URL.createObjectURL(blob);
    const a       = document.createElement('a');
    a.href = blobUrl;
    a.download = `shieldblock-backup-${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Revoke after click so the blob is GC'd
    setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
    $('import-status').textContent = '✓ Exported';
    setTimeout(() => { if ($('import-status')) $('import-status').textContent = ''; }, 2000);
  } catch(e) {
    console.error('[SB] Export error:', e);
    $('import-status').textContent = '✗ Export failed';
  }
});

$('import-btn')?.addEventListener('change', async (e) => {
  const file = e.target.files?.[0]; if (!file) return;
  const status = $('import-status');
  if (status) status.textContent = 'Importing…';
  try {
    const text = await file.text();
    let data;
    try { data = JSON.parse(text); }
    catch (_) { if (status) status.textContent = '✗ Invalid JSON file'; return; }
    if (!data || typeof data !== 'object') {
      if (status) status.textContent = '✗ Invalid backup format'; return;
    }
    const result = await msg('IMPORT_SETTINGS', { data });
    if (result?.ok) {
      if (status) status.textContent = '✓ Imported successfully — reload tabs to apply';
      await loadSettings(); // refresh toggle states immediately
    } else {
      if (status) status.textContent = '✗ Import failed';
    }
    setTimeout(() => { if (status) status.textContent = ''; }, 4000);
  } catch(err) {
    console.error('[SB] Import error:', err);
    if (status) status.textContent = '✗ Import failed: ' + err.message?.slice(0,40);
  }
  // Reset file input so same file can be re-imported
  e.target.value = '';
});

// ── 7-day sparkline chart ──────────────────────────────────────────────────────
async function drawSparkline() {
  const canvas = document.getElementById('spark-chart');
  if (!canvas) return;
  const days = await msg('GET_DAILY_STATS') ?? [];
  const ctx  = canvas.getContext('2d');
  const W = canvas.offsetWidth || 300;
  const H = 36;
  canvas.width  = W;
  canvas.height = H;

  const counts = days.map(d => d.count);
  const max    = Math.max(...counts, 1);
  const step   = W / (counts.length - 1 || 1);

  // Background
  ctx.fillStyle = 'rgba(30,30,46,0.4)';
  ctx.fillRect(0, 0, W, H);

  if (counts.every(c => c === 0)) {
    ctx.fillStyle = '#3a3a54';
    ctx.font = '10px monospace';
    ctx.fillText('no data yet', W/2 - 30, H/2 + 4);
    return;
  }

  // Fill gradient
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, 'rgba(124,106,255,0.35)');
  grad.addColorStop(1, 'rgba(124,106,255,0.02)');

  ctx.beginPath();
  counts.forEach((c, i) => {
    const x = i * step;
    const y = H - 4 - (c / max) * (H - 8);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.lineTo((counts.length - 1) * step, H);
  ctx.lineTo(0, H);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  // Line
  ctx.beginPath();
  counts.forEach((c, i) => {
    const x = i * step;
    const y = H - 4 - (c / max) * (H - 8);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.strokeStyle = '#7c6aff';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Day labels
  ctx.fillStyle = '#44446a';
  ctx.font = '8px monospace';
  days.forEach((d, i) => {
    const label = d.date.slice(5); // MM-DD
    const x = i * step;
    if (i === 0 || i === days.length - 1 || i === 3) {
      ctx.fillText(label, x + (i === days.length-1 ? -24 : 2), H - 1);
    }
  });
}

// ── Pause timer ────────────────────────────────────────────────────────────────
let _pauseCheckInterval = null;

async function checkPauseStatus() {
  const btn = $('pause-btn');
  if (!btn) return;
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab?.url) return;
    const domain = new URL(tab.url).hostname.replace(/^www\./, '');
    const paused = await msg('GET_PAUSE_STATUS') ?? {};
    const resumeAt = paused[domain];
    if (resumeAt && resumeAt > Date.now()) {
      const mins = Math.ceil((resumeAt - Date.now()) / 60000);
      const timeLeft = mins >= 60
        ? `${Math.floor(mins / 60)}h${mins % 60 ? ' ' + (mins % 60) + 'm' : ''}`
        : `${mins}m`;
      btn.textContent = `▶ ${timeLeft} left`;
      btn.classList.add('pause-active');
    } else {
      btn.textContent = '⏸ pause';
      btn.classList.remove('pause-active');
    }
  } catch (_) {}
}

$('pause-btn')?.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.url) return;
  const domain = new URL(tab.url).hostname.replace(/^www\./, '');
  const paused = await msg('GET_PAUSE_STATUS') ?? {};

  if (paused[domain] && paused[domain] > Date.now()) {
    await msg('RESUME_SITE', { domain });
    $('pause-btn').textContent = '⏸ pause';
    $('pause-btn').classList.remove('pause-active');
    try { await chrome.tabs.reload(tab.id); } catch (_) {}
  } else {
    const minutes = parseInt($('pause-dur')?.value) || 30;
    await msg('PAUSE_SITE', { domain, minutes });
    $('pause-btn').textContent = `▶ ${minutes >= 60 ? (minutes/60)+'h' : minutes+'m'} left`;
    $('pause-btn').classList.add('pause-active');
    try { await chrome.tabs.reload(tab.id); } catch (_) {}
  }
});

// ── Cloud sync ─────────────────────────────────────────────────────────────────

$('cloud-restore-btn')?.addEventListener('click', async () => {
  const s = $('cloud-status');
  if (s) s.textContent = 'Restoring…';
  const r = await msg('RESTORE_FROM_CLOUD');
  if (r?.ok) {
    if (s) s.textContent = `✓ Restored: ${r.keys?.join(', ')}`;
    await loadSettings();
  } else {
    if (s) s.textContent = '✗ ' + (r?.error || 'Nothing saved');
  }
  setTimeout(() => { if (s) s.textContent = ''; }, 3000);
});

// ── Import uBlock Origin ───────────────────────────────────────────────────────
$('ubo-import-btn')?.addEventListener('change', async (e) => {
  const file = e.target.files?.[0]; if (!file) return;
  const s = $('ubo-status');
  if (s) s.textContent = 'Importing…';
  try {
    const text = await file.text();
    const uboData = JSON.parse(text);
    const r = await msg('IMPORT_UBO', { uboData });
    if (r?.ok) {
      if (s) s.textContent = `✓ Imported: ${r.imported?.join(', ')}`;
      await loadSettings();
    } else {
      if (s) s.textContent = '✗ ' + (r?.error || 'Import failed');
    }
  } catch(err) {
    if (s) s.textContent = '✗ Invalid file: ' + err.message?.slice(0, 40);
  }
  e.target.value = '';
  setTimeout(() => { if (s) s.textContent = ''; }, 4000);
});

// ── Badge toggle ───────────────────────────────────────────────────────────────
$('t-badge')?.addEventListener('change', async (e) => {
  const enabled = e.target.checked;
  await msg('SET_SETTINGS', { settings: { badgeEnabled: enabled } });
  if (!enabled) {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab?.id) chrome.action.setBadgeText({ text: '', tabId: tab.id });
  }
});
