(function () {
  const params  = new URLSearchParams(location.search);
  const blocked = params.get('url') || '';

  if (blocked) {
    document.getElementById('blocked-url').textContent = blocked;
    try { document.title = 'Blocked: ' + new URL(blocked).hostname + ' — ShieldBlock'; }
    catch (_) {}
  }

  // ── Back button trap fix ──────────────────────────────────────────────────
  // background.js uses chrome.tabs.update({ url: warningUrl }) which REPLACES
  // the current history entry (same as location.replace). So blocked.html IS
  // already the only entry for this tab — history.back() would go to the entry
  // BEFORE the dangerous site, which is correct. However, if the tab was freshly
  // opened (no previous entry), history.back() is a no-op and the user is stuck.
  // Fix: if no previous history exists, open the ShieldBlock new-tab page instead.
  document.querySelector('.btn-back').addEventListener('click', () => {
    if (history.length > 1) {
      history.back();
    } else {
      // location.href = 'chrome://' is blocked by browsers — use the tabs API instead.
      // blocked.html is an extension page so chrome.tabs is available.
      try {
        const api = (typeof browser !== 'undefined' && browser.tabs) ? browser.tabs : chrome.tabs;
        const newTab = (typeof browser !== 'undefined') ? 'about:newtab' : 'chrome://newtab';
        api.getCurrent(function (tab) {
          if (tab && tab.id != null) api.update(tab.id, { url: newTab });
          else window.close();
        });
      } catch (_) { window.close(); }
    }
  });

  document.getElementById('proceed-btn').addEventListener('click', async () => {
    if (!blocked) return;
    const confirmed = confirm(
      'This site may contain malware or phishing content.\n\n' +
      'Are you absolutely sure you want to continue to:\n' + blocked
    );
    if (!confirmed) return;
    try {
      await chrome.runtime.sendMessage({ type: 'ALLOW_SAFE_BROWSING_URL', url: blocked });
    } catch (_) {}
    location.href = blocked;
  });
})();
