/**
 * ShieldBlock Pro — Browser Compatibility Shim
 *
 * Firefox natively exposes `browser.*` (Promise-based) and a legacy
 * `chrome.*` shim (callback-based in older versions). Chrome only has
 * `chrome.*` (Promise-based in MV3). This shim ensures `chrome.*` is
 * always the Promise-based variant regardless of browser.
 *
 * Must be loaded/imported before any other extension code.
 */
(function () {
  // If running in Firefox (browser.* exists) and chrome.* is absent or
  // is the legacy callback shim, swap in browser.* instead.
  if (typeof globalThis.chrome === 'undefined' && typeof globalThis.browser !== 'undefined') {
    globalThis.chrome = globalThis.browser;
    return;
  }

  // Firefox also exposes chrome.* but it may be callback-based in older builds.
  // Prefer browser.* when both exist so we get native Promise support.
  if (typeof globalThis.browser !== 'undefined' && typeof globalThis.chrome !== 'undefined') {
    // Only replace if browser.* has the core namespaces we rely on
    if (typeof globalThis.browser.storage !== 'undefined') {
      globalThis.chrome = globalThis.browser;
    }
  }
})();
