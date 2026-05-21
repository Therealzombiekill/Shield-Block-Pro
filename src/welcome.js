document.addEventListener('DOMContentLoaded', async () => {
  // ── Version label ──────────────────────────────────────────────────────────
  try {
    const { version } = chrome.runtime.getManifest();
    const el = document.getElementById('ver-label');
    if (el) el.textContent = `v${version} · Free forever`;
  } catch (_) {}

  // ── Live rule count from DNR ───────────────────────────────────────────────
  try {
    const rules = await chrome.declarativeNetRequest.getDynamicRules();
    const staticRules = await chrome.declarativeNetRequest.getSessionRules();
    const total = (rules?.length ?? 0) + (staticRules?.length ?? 0);
    const el = document.getElementById('sw-rule-count');
    if (el && total > 0) {
      // Fetch static count from manifest to add to dynamic count
      const enabled = await chrome.declarativeNetRequest.getEnabledRulesets();
      let staticCount = 0;
      if (chrome.declarativeNetRequest.getAvailableStaticRuleCount) {
        // Approximate: show dynamic count; static rules are always active
        staticCount = 0; // static rules counted separately by the browser
      }
      el.textContent = total > 999 ? `${(total / 1000).toFixed(1)}k` : String(total);
    } else if (el) {
      // Fall back to a static estimate
      el.textContent = '5k+';
    }
  } catch (_) {
    const el = document.getElementById('sw-rule-count');
    if (el) el.textContent = '5k+';
  }

  // ── Button handlers ────────────────────────────────────────────────────────
  document.querySelector('.btn-primary')?.addEventListener('click', () => {
    window.close();
  });

  document.querySelector('.btn-secondary')?.addEventListener('click', () => {
    chrome.runtime.openOptionsPage?.() ??
      window.open(chrome.runtime.getURL('popup.html'), '_blank', 'width=390,height=620,left=200,top=80');
  });
});
