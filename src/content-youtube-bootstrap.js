/**
 * ShieldBlock Pro — YouTube settings bootstrap (document_start)
 *
 * inject-youtube.js runs in MAIN world at document_start but cannot read
 * chrome.storage. This script loads settings immediately so InnerTube hooks
 * are enabled before ytInitialPlayerResponse / early /player fetches.
 */
(async () => {
  let settings;
  try {
    settings = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
  } catch (_) {
    await new Promise((r) => setTimeout(r, 150));
    try {
      settings = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
    } catch (_) {
      settings = null;
    }
  }

  const post = (type) => {
    try {
      window.postMessage({ type }, '*');
    } catch (_) {}
  };

  if (!settings?.youtube || settings?.globalPause) {
    post('SB_YOUTUBE_DISABLE');
    return;
  }

  const host = location.hostname.replace(/^www\./, '');
  const wl = settings?.whitelist ?? [];
  if (wl.some((d) => host === d || host.endsWith('.' + d))) {
    post('SB_YOUTUBE_DISABLE');
    return;
  }

  post('SB_YOUTUBE_ENABLE');
})();
