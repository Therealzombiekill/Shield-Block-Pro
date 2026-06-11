/**
 * ShieldBlock Pro — neutered Universal Analytics (analytics.js / ga.js) stub.
 * Sites gate navigation on hitCallback firing; a dead-blocked script means
 * links and forms hang. The stub accepts every call and fires callbacks.
 */
(function () {
  'use strict';
  try {
    if (window.ga && window.ga._sbStub) return;

    var fireCallbacks = function (args) {
      for (var i = 0; i < args.length; i++) {
        var o = args[i];
        if (typeof o === 'function') { try { o(); } catch (_) {} continue; }
        if (o && typeof o === 'object' && typeof o.hitCallback === 'function') {
          try { o.hitCallback(); } catch (_) {}
        }
      }
    };

    var tracker = {
      get: function () { return ''; },
      set: function (k, v) {
        if (k && typeof k === 'object' && typeof k.hitCallback === 'function') { try { k.hitCallback(); } catch (_) {} }
        if (typeof v === 'function') { try { v(); } catch (_) {} }
      },
      send: function () { fireCallbacks(arguments); },
    };

    var ga = function () {
      fireCallbacks(arguments);
      // ga(function(tracker){...}) ready callbacks
      if (typeof arguments[0] === 'function') { try { arguments[0](tracker); } catch (_) {} }
    };
    ga._sbStub = true;
    ga.create = function () { return tracker; };
    ga.getAll = function () { return [tracker]; };
    ga.getByName = function () { return tracker; };
    ga.remove = function () {};
    ga.loaded = true;
    ga.q = [];
    ga.l = Date.now();

    // Drain anything queued by the GA snippet before this stub loaded
    var pending = (window.ga && window.ga.q) ? Array.prototype.slice.call(window.ga.q) : [];
    window.ga = window.ga || ga;
    if (window.ga !== ga && !window.ga._sbStub) window.ga = ga;
    for (var i = 0; i < pending.length; i++) { try { ga.apply(null, pending[i]); } catch (_) {} }

    // Legacy ga.js queue
    window._gaq = window._gaq || {};
    window._gaq.push = function () { return 0; };
    window._gat = window._gat || {
      _getTracker: function () { return tracker; },
      _createTracker: function () { return tracker; },
    };
  } catch (_) {}
})();
