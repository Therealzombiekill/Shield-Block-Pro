/**
 * ShieldBlock Pro — neutered Amazon Publisher Services (apstag.js) stub.
 * Publishers wait on fetchBids callbacks before rendering; firing them with an
 * empty bid set keeps page layouts moving when the real script is blocked.
 */
(function () {
  'use strict';
  try {
    if (window.apstag && window.apstag._sbStub) return;
    var noop = function () {};
    window.apstag = {
      _sbStub: true,
      init: noop,
      fetchBids: function (cfg, cb) {
        try { if (typeof cb === 'function') setTimeout(function () { cb([]); }, 1); } catch (_) {}
      },
      setDisplayBids: noop,
      targetingKeys: function () { return []; },
      debug: noop,
    };
  } catch (_) {}
})();
