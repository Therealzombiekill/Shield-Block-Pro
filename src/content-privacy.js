/**
 * ShieldBlock Pro — Privacy Settings Bridge
 *
 * Runs in the isolated world so it can read extension settings and forward the
 * effective privacy/tracking state to inject-privacy.js in the MAIN world.
 */

(async () => {
  if (!location.href.startsWith('http://') && !location.href.startsWith('https://')) return;

  const host = location.hostname.replace(/^www\./, '');
  let settings = null;
  let whitelist = [];
  let globalPaused = false;

  function isWhitelisted(list = whitelist) {
    return list.some(d => host === d || host.endsWith('.' + d));
  }

  function postConfig() {
    // browser-compat.js always runs first in this context, so the helper is defined.
    const onAmazon = !!globalThis.__sbIsAmazonShoppingHost?.(host);
    const disabled = globalPaused || isWhitelisted() || onAmazon;
    window.postMessage({
      type: 'SB_PRIVACY_CONFIG',
      privacy: settings?.privacy !== false && !disabled,
      tracking: settings?.tracking !== false && !disabled,
      skipUrlClean: typeof globalThis.__sbShouldSkipPrivacyUrlClean === 'function'
        ? globalThis.__sbShouldSkipPrivacyUrlClean(host)
        : false,
    }, '*');
  }

  try {
    settings = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
  } catch (_) {
    await new Promise(r => setTimeout(r, 300));
    try { settings = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }); }
    catch (_) { settings = null; }
  }

  whitelist = settings?.whitelist ?? [];
  globalPaused = !!settings?.globalPause;
  postConfig();

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.settings?.newValue) {
      settings = { ...(settings || {}), ...changes.settings.newValue };
    }
    if (changes.whitelist) whitelist = changes.whitelist.newValue ?? [];
    if (changes.globalPause) {
      globalPaused = !!(changes.globalPause.newValue && changes.globalPause.newValue.until > Date.now());
    }
    if (changes.settings || changes.whitelist || changes.globalPause) postConfig();
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'GLOBAL_PAUSE') {
      globalPaused = true;
      postConfig();
    }
    if (message?.type === 'GLOBAL_RESUME') {
      globalPaused = false;
      postConfig();
    }
    if (message?.type === 'WHITELIST_CHANGED') {
      whitelist = message.whitelist ?? [];
      postConfig();
    }
  });
})().catch(() => {});
