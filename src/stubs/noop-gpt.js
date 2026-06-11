/**
 * ShieldBlock Pro — neutered Google Publisher Tag (gpt.js) stub.
 * Served via DNR redirect when a filter rule blocks the real script, so pages
 * that call googletag.* don't throw and adblock detectors see a "loaded" tag.
 * Page-world script: no chrome.* APIs available or used.
 */
(function () {
  'use strict';
  try {
    var g = window.googletag = window.googletag || {};
    if (g._sbStub) return;
    g._sbStub = true;

    // Generic chainable no-op: returns the same object for any registered name
    function chain(obj, names) {
      for (var i = 0; i < names.length; i++) {
        (function (n) { obj[n] = function () { return obj; }; })(names[i]);
      }
      return obj;
    }

    var sizeMapping = chain({}, ['addSize']);
    sizeMapping.build = function () { return []; };

    var slot = {};
    chain(slot, ['addService', 'clearCategoryExclusions', 'clearTargeting',
      'defineSizeMapping', 'setCategoryExclusion', 'setClickUrl',
      'setCollapseEmptyDiv', 'setForceSafeFrame', 'setSafeFrameConfig',
      'setTargeting', 'updateTargetingFromMap', 'setConfig']);
    slot.get = function () { return null; };
    slot.getAdUnitPath = function () { return ''; };
    slot.getAttributeKeys = function () { return []; };
    slot.getCategoryExclusions = function () { return []; };
    slot.getDomId = function () { return ''; };
    slot.getSlotElementId = function () { return ''; };
    slot.getSlotId = function () { return { getDomId: function () { return ''; }, getId: function () { return ''; } }; };
    slot.getTargeting = function () { return []; };
    slot.getTargetingKeys = function () { return []; };
    slot.getResponseInformation = function () { return null; };

    var pubads = {};
    chain(pubads, ['clear', 'clearCategoryExclusions', 'clearTagForChildDirectedTreatment',
      'clearTargeting', 'collapseEmptyDivs', 'disableInitialLoad', 'display',
      'enableAsyncRendering', 'enableLazyLoad', 'enableSingleRequest',
      'enableSyncRendering', 'enableVideoAds', 'refresh', 'set',
      'setCategoryExclusion', 'setCentering', 'setCookieOptions',
      'setForceSafeFrame', 'setLocation', 'setPrivacySettings',
      'setPublisherProvidedId', 'setRequestNonPersonalizedAds',
      'setSafeFrameConfig', 'setTagForChildDirectedTreatment',
      'setTagForUnderAgeOfConsent', 'setTargeting', 'setVideoContent',
      'updateCorrelator']);
    pubads.addEventListener = function (type, listener) {
      // Fire renderEnded-style listeners asynchronously so "did the ad render?"
      // detectors complete instead of hanging forever.
      try {
        if (typeof listener === 'function') {
          setTimeout(function () {
            try { listener({ slot: slot, isEmpty: true, size: null }); } catch (_) {}
          }, 1);
        }
      } catch (_) {}
      return pubads;
    };
    pubads.removeEventListener = function () { return pubads; };
    pubads.get = function () { return null; };
    pubads.getAttributeKeys = function () { return []; };
    pubads.getTargeting = function () { return []; };
    pubads.getTargetingKeys = function () { return []; };
    pubads.getSlots = function () { return []; };
    pubads.isInitialLoadDisabled = function () { return false; };

    var companion = { addEventListener: pubads.addEventListener, setRefreshUnfilledSlots: function () {} };
    var content   = { addEventListener: pubads.addEventListener, setContent: function () {} };

    g.apiReady = true;
    g.pubadsReady = true;
    g.companionAds = function () { return companion; };
    g.content = function () { return content; };
    g.pubads = function () { return pubads; };
    g.defineOutOfPageSlot = function () { return slot; };
    g.defineSlot = function () { return slot; };
    g.destroySlots = function () { return true; };
    g.disablePublisherConsole = function () {};
    g.display = function () {};
    g.enableServices = function () {};
    g.getVersion = function () { return '202'; };
    g.setAdIframeTitle = function () {};
    g.setConfig = function () {};
    g.sizeMapping = function () { return sizeMapping; };
    g.openConsole = function () {};

    // Drain the command queue the page built before this stub loaded, and run
    // anything pushed later immediately.
    var queued = (g.cmd && typeof g.cmd.length === 'number') ? Array.prototype.slice.call(g.cmd) : [];
    g.cmd = {
      push: function () {
        for (var i = 0; i < arguments.length; i++) {
          try { if (typeof arguments[i] === 'function') arguments[i](); } catch (_) {}
        }
        return arguments.length;
      },
    };
    for (var i = 0; i < queued.length; i++) {
      try { if (typeof queued[i] === 'function') queued[i](); } catch (_) {}
    }
  } catch (_) {}
})();
