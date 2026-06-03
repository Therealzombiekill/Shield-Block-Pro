// ShieldBlock Pro — minimal popup (live stats while open)

const $ = id => document.getElementById(id);

const REFRESH_MS = 1000;
let _refreshTimer = null;

async function msg(type, extra = {}) {
  try {
    return await chrome.runtime.sendMessage({ type, ...extra });
  } catch (e) {
    if (
      e?.message?.includes('Could not establish') ||
      e?.message?.includes('receiving end')
    ) {
      await new Promise(r => setTimeout(r, 300));
      try {
        return await chrome.runtime.sendMessage({ type, ...extra });
      } catch (_) {
        return null;
      }
    }
    return null;
  }
}

function fmt(n) {
  n = n | 0;
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return String(n);
}

function formatTimeSaved(seconds) {
  let s = Math.floor(seconds || 0);
  if (s < 60) return s + 's';
  if (s < 3600) return Math.floor(s / 60) + 'm';
  if (s < 86400) {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return m ? `${h}h ${m}m` : `${h}h`;
  }
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  return h ? `${d}d ${h}h` : `${d}d`;
}

async function refreshStats() {
  const live = await msg('GET_POPUP_STATS');
  if (!live) return;

  const session = live.session ?? 0;
  const life = live.lifetime ?? 0;
  const saved = live.timeSavedSeconds ?? 0;

  const sessionEl = $('session-count');
  if (sessionEl) sessionEl.textContent = fmt(session);

  const lifeEl = $('lifetime-count');
  if (lifeEl) lifeEl.textContent = fmt(life);

  const savedEl = $('time-saved');
  if (savedEl) savedEl.textContent = formatTimeSaved(saved);
}

function startLiveRefresh() {
  refreshStats();
  if (_refreshTimer) clearInterval(_refreshTimer);
  _refreshTimer = setInterval(refreshStats, REFRESH_MS);
}

function stopLiveRefresh() {
  if (_refreshTimer) {
    clearInterval(_refreshTimer);
    _refreshTimer = null;
  }
}

function init() {
  const privacy = $('privacy-link');
  if (privacy) {
    privacy.href = chrome.runtime.getURL('privacy.html');
  }

  startLiveRefresh();

  // Instant bump when background flushes stats to storage
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.stats || changes.lifetime || changes.timeSaved) {
      refreshStats();
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') startLiveRefresh();
    else stopLiveRefresh();
  });

  window.addEventListener('pagehide', stopLiveRefresh);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
