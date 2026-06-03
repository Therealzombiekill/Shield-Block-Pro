// ShieldBlock Pro — minimal popup

const $ = id => document.getElementById(id);

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

async function refreshStats() {
  const [stats, lifetime] = await Promise.all([
    msg('GET_STATS'),
    msg('GET_LIFETIME'),
  ]);
  const session = stats?.total ?? 0;
  const life = lifetime?.total ?? 0;
  if ($('session-count')) $('session-count').textContent = fmt(session);
  if ($('lifetime-count')) $('lifetime-count').textContent = fmt(life);
}

function init() {
  const privacy = $('privacy-link');
  if (privacy) {
    privacy.href = chrome.runtime.getURL('privacy.html');
  }
  refreshStats();
  setInterval(refreshStats, 4000);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
