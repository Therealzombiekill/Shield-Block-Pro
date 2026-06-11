/**
 * ShieldBlock Pro — neutered AdSense (adsbygoogle.js) stub.
 * Pages push render commands into window.adsbygoogle; without this stub the
 * push throws or the array grows forever and "ad blocked" detectors trip.
 */
(function () {
  'use strict';
  try {
    var a = window.adsbygoogle = window.adsbygoogle || [];
    if (a._sbStub) return;
    a._sbStub = true;
    a.loaded = true;
    a.push = function () { return 0; };
  } catch (_) {}
})();
