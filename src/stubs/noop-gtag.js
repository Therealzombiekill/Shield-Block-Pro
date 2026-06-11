/**
 * ShieldBlock Pro — neutered gtag.js / gtm.js stub.
 * Fires event_callback handlers so checkout/outbound-link flows that wait on
 * Google Tag Manager don't hang when the real script is blocked.
 */
(function () {
  'use strict';
  try {
    if (window._sbGtagStub) return;
    window._sbGtagStub = true;

    var scan = function (o) {
      if (!o || typeof o !== 'object') return;
      if (typeof o.event_callback === 'function') { try { o.event_callback(); } catch (_) {} }
      if (typeof o.eventCallback  === 'function') { try { o.eventCallback();  } catch (_) {} }
    };
    var scanDeep = function (item) {
      scan(item);
      // gtag() pushes its `arguments` object — scan array-like contents too
      if (item && typeof item === 'object' && typeof item.length === 'number') {
        for (var j = 0; j < item.length; j++) scan(item[j]);
      }
    };

    var dl = window.dataLayer = window.dataLayer || [];
    // Fire callbacks for entries queued before the stub loaded
    for (var i = 0; i < dl.length; i++) scanDeep(dl[i]);

    var origPush = dl.push.bind(dl);
    dl.push = function () {
      for (var k = 0; k < arguments.length; k++) scanDeep(arguments[k]);
      return origPush.apply(null, arguments);
    };

    window.gtag = window.gtag || function () { dl.push(arguments); };
    window.google_tag_manager = window.google_tag_manager || {};
  } catch (_) {}
})();
