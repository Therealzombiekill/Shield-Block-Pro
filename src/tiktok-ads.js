/**
 * ShieldBlock Pro — TikTok ad detection (shared logic)
 *
 * Loaded as a classic content script (no import/export) BEFORE content-social.js,
 * exposing globalThis.__sbTikTok. The decision logic is isolated here so it can be
 * exercised directly in tests (test/tiktok.test.js runs this file in a vm and
 * drives the functions against fixture DOM nodes) — content-social.js only does
 * the querySelectorAll wiring around it.
 *
 * Why this exists: the previous cleanTikTok removed `el.closest('article') ?? el`,
 * but TikTok's feed uses neither <article> nor <li>, so it deleted the tiny
 * "Sponsored" label and left the ad video playing. findContainer() walks up to the
 * actual feed-item block instead, and label matching is exact-on-leaf so organic
 * videos whose captions merely mention sponsorship are never removed.
 */
(function () {
  'use strict';

  // Exact ad labels (lowercased). Kept tight on purpose — a substring match would
  // nuke organic videos. Covers the common TikTok caption languages.
  var AD_LABELS = [
    'sponsored', 'sponsor', 'promoted', 'advertisement', 'ad',
    'paid partnership', 'paid promotion',
    'gesponsert', 'sponsorise', 'sponsorisee', 'sponsorisé', 'sponsorisée',
    'patrocinado', 'patrocinada', 'sponsorizzato', 'gesponsord', 'sponsrad',
    'sponsorowane', 'sponsorlu', '广告', '赞助',
    'スポンサー', '광고',
  ];

  // data-e2e values TikTok puts directly on an ad unit.
  var AD_E2E = ['for-you-ad', 'recommend-ad-card', 'search-ad-item', 'feed-ad', 'ad-cover'];

  // data-e2e values that identify a per-item feed container (the node to remove).
  var CONTAINER_E2E = [
    'recommend-list-item-container', 'feed-video', 'video-feed-item',
    'search_top-item', 'search-card-item', 'recommend-list-item',
  ];

  // Zero-width / directional format chars TikTok can splice into labels.
  var INVISIBLE_RE = /[\u00AD\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060-\u206F\uFEFF]/g;

  function norm(s) {
    return String(s == null ? '' : s)
      .replace(INVISIBLE_RE, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  // True only when an element's OWN text equals an ad label (used on leaf nodes).
  function isAdLabelText(text) {
    return AD_LABELS.indexOf(norm(text)) !== -1;
  }

  function attr(node, name) {
    return (node && typeof node.getAttribute === 'function') ? (node.getAttribute(name) || '') : '';
  }

  // True when a node's data-e2e directly marks it (or its content) as an ad.
  function e2eMarksAd(node) {
    var v = attr(node, 'data-e2e');
    if (!v) return false;
    if (AD_E2E.indexOf(v) !== -1) return true;
    return v.indexOf('ad-') !== -1 || v.indexOf('-ad') !== -1;
  }

  // True when a node is a per-item feed/search container worth removing.
  function isContainer(node) {
    if (!node) return false;
    var v = attr(node, 'data-e2e');
    if (v && CONTAINER_E2E.indexOf(v) !== -1) return true;
    if (v && /(item|video)-?container$/.test(v)) return true;
    var tag = (node.tagName || '').toLowerCase();
    return tag === 'article' || tag === 'li';
  }

  // Walk up to the feed-item container to remove. Returns null if none is found
  // within maxDepth — callers must NOT fall back to removing the label itself.
  function findContainer(node, maxDepth) {
    if (maxDepth == null) maxDepth = 15;
    var n = node, steps = 0;
    while (n && steps < maxDepth) {
      if (isContainer(n)) return n;
      n = n.parentElement;
      steps++;
    }
    return null;
  }

  globalThis.__sbTikTok = {
    AD_LABELS: AD_LABELS,
    AD_E2E: AD_E2E,
    CONTAINER_E2E: CONTAINER_E2E,
    norm: norm,
    isAdLabelText: isAdLabelText,
    e2eMarksAd: e2eMarksAd,
    isContainer: isContainer,
    findContainer: findContainer,
  };
})();
