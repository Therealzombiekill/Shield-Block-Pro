/**
 * ShieldBlock Pro — i18n runtime (classic script, no import/export)
 *
 * Loaded first in popup.html / welcome.html / blocked.html. On load it walks the
 * DOM and replaces the text of [data-i18n] elements (and selected attributes of
 * [data-i18n-attr] elements) with chrome.i18n.getMessage(key). Crucially it falls
 * back to the element's existing markup if a key is missing or chrome.i18n isn't
 * available, so a missing translation degrades to the baked-in English — never to
 * a blank UI. For the default `en` locale the catalog mirrors the English text, so
 * the rendered result is identical to the pre-i18n build.
 *
 * Also exposes a global t(key, fallback, subs) for dynamic strings in popup.js.
 */
(function () {
  'use strict';

  function getMessage(key, subs) {
    try {
      if (globalThis.chrome && chrome.i18n && typeof chrome.i18n.getMessage === 'function') {
        return chrome.i18n.getMessage(key, subs) || '';
      }
    } catch (_) {}
    return '';
  }

  function apply(root) {
    var scope = root || document;
    scope.querySelectorAll('[data-i18n]').forEach(function (el) {
      var m = getMessage(el.getAttribute('data-i18n'));
      if (m) el.textContent = m; // else keep the existing English fallback
    });
    scope.querySelectorAll('[data-i18n-attr]').forEach(function (el) {
      el.getAttribute('data-i18n-attr').split(';').forEach(function (pair) {
        var i = pair.indexOf(':');
        if (i < 0) return;
        var attr = pair.slice(0, i).trim();
        var key = pair.slice(i + 1).trim();
        var m = getMessage(key);
        if (attr && m) el.setAttribute(attr, m);
      });
    });
  }

  // t('key', 'English fallback'[, subs]) — for strings built in JS.
  globalThis.t = function (key, fallback, subs) {
    return getMessage(key, subs) || (fallback != null ? fallback : key);
  };
  globalThis.__sbI18nApply = apply;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { apply(document); });
  } else {
    apply(document);
  }
})();
