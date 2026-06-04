// ShieldBlock Pro — minimal popup (live stats, stability-safe polling)

const $ = id => document.getElementById(id);

const REFRESH_MS = 1500;
const REFRESH_SLOW_MS = 4000;
let _refreshTimer = null;
let _storageBound = false;
let _failStreak = 0;
let _storageDebounce = null;

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
  if (!live) {
    _failStreak++;
    return;
  }
  _failStreak = 0;

  const sessionEl = $('session-count');
  if (sessionEl) sessionEl.textContent = fmt(live.session ?? 0);

  const lifeEl = $('lifetime-count');
  if (lifeEl) lifeEl.textContent = fmt(live.lifetime ?? 0);

  const savedEl = $('time-saved');
  if (savedEl) savedEl.textContent = formatTimeSaved(live.timeSavedSeconds ?? 0);

  const stability = $('stability-line');
  if (stability && live.amazonProtected) {
    stability.textContent = 'Amazon stability mode · protection active';
  }
}

function scheduleStorageRefresh() {
  if (_storageDebounce) clearTimeout(_storageDebounce);
  _storageDebounce = setTimeout(() => {
    _storageDebounce = null;
    refreshStats();
  }, 80);
}

function startLiveRefresh() {
  refreshStats();
  if (_refreshTimer) clearInterval(_refreshTimer);
  const interval = _failStreak >= 3 ? REFRESH_SLOW_MS : REFRESH_MS;
  _refreshTimer = setInterval(refreshStats, interval);
}

function stopLiveRefresh() {
  if (_refreshTimer) {
    clearInterval(_refreshTimer);
    _refreshTimer = null;
  }
  if (_storageDebounce) {
    clearTimeout(_storageDebounce);
    _storageDebounce = null;
  }
}

function init() {
  const privacy = $('privacy-link');
  if (privacy) {
    privacy.href = chrome.runtime.getURL('privacy.html');
  }

  startLiveRefresh();

  if (!_storageBound) {
    _storageBound = true;
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes.stats || changes.lifetime || changes.timeSaved) {
        scheduleStorageRefresh();
      }
    });
  }

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
