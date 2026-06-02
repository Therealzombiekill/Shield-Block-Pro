/**
 * TikTok ad detection — src/tiktok-ads.js
 *
 * Proof that TikTok ad removal actually works. The real shipping logic is loaded
 * in a vm sandbox and driven against fixture DOM nodes shaped like TikTok's feed.
 * The two things that matter:
 *   1. ad items are removed at the FEED-ITEM container, not the tiny label (the
 *      old bug left the ad video playing), and
 *   2. organic videos are never removed (a false positive is worse than a miss).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

// Load the actual content-script logic the same way the browser would evaluate it.
const code = readFileSync(fileURLToPath(new URL('../src/tiktok-ads.js', import.meta.url)), 'utf8');
const sandbox = {};
sandbox.globalThis = sandbox;
vm.runInNewContext(code, sandbox);
const TT = sandbox.__sbTikTok;

// ── Minimal DOM fixture ──────────────────────────────────────────────────────
function el(tag, { e2e, text = '', children } = {}) {
  const node = {
    tagName: tag.toUpperCase(),
    _attrs: e2e == null ? {} : { 'data-e2e': e2e },
    _text: text,
    children: [],
    parentElement: null,
    isConnected: true,
    getAttribute(k) { return k in this._attrs ? this._attrs[k] : null; },
    get textContent() {
      return this.children.length ? this.children.map(c => c.textContent).join(' ') : this._text;
    },
    closest() { return null; }, // fixtures rely on findContainer, not closest
    remove() {
      if (this.parentElement) {
        const a = this.parentElement.children, i = a.indexOf(this);
        if (i >= 0) a.splice(i, 1);
      }
      this.isConnected = false;
    },
  };
  for (const c of children ?? []) { c.parentElement = node; node.children.push(c); }
  return node;
}
const flatten = (root) => [root, ...root.children.flatMap(flatten)];

// Mirror of cleanTikTok's wiring (content-social.js) over the fixture tree.
function simulateClean(root) {
  const removed = [], seen = new Set();
  const removeAdAt = (node) => {
    const container = TT.findContainer(node) || node.closest('article') || node.closest('li');
    if (container && container.isConnected && !seen.has(container)) {
      seen.add(container); container.remove(); removed.push(container);
    }
  };
  const all = flatten(root);
  all.filter(n => n.getAttribute('data-e2e') != null && TT.e2eMarksAd(n)).forEach(removeAdAt);
  all.filter(n => n.children.length === 0 && TT.isAdLabelText(n.textContent)).forEach(removeAdAt);
  return removed;
}

// ── Label matching ───────────────────────────────────────────────────────────

test('exact ad labels are recognized across casing, padding, and languages', () => {
  const labels = [
    'Sponsored', '  sponsored ', 'SPONSORED', 'Promoted', 'Paid partnership',
    'Advertisement', '广告' /* 广告 */, '광고' /* 광고 */,
  ];
  for (const t of labels) assert.equal(TT.isAdLabelText(t), true, `should match: ${JSON.stringify(t)}`);
});

test('organic captions that merely mention sponsorship are NOT labels', () => {
  for (const t of ['my sponsored trip to Bali', 'sponsorship inquiries in bio', 'sponge cake recipe', '', '   ']) {
    assert.equal(TT.isAdLabelText(t), false, `should NOT match: ${JSON.stringify(t)}`);
  }
});

test('zero-width characters spliced into a label are stripped before matching', () => {
  const zwsp = '\u200B';
  assert.equal(TT.isAdLabelText('Spon' + zwsp + 'sored'), true);
  assert.equal(TT.isAdLabelText('S\u200Bp\u200Bo\u200Bn\u200Bs\u200Bo\u200Br\u200Be\u200Bd'), true);
});

// ── data-e2e markers ─────────────────────────────────────────────────────────

test('e2eMarksAd flags ad units but not containers or organic nodes', () => {
  assert.equal(TT.e2eMarksAd(el('div', { e2e: 'for-you-ad' })), true);
  assert.equal(TT.e2eMarksAd(el('div', { e2e: 'recommend-ad-card' })), true);
  assert.equal(TT.e2eMarksAd(el('div', { e2e: 'video-ad-cover' })), true); // contains "ad-"
  assert.equal(TT.e2eMarksAd(el('div', { e2e: 'recommend-list-item-container' })), false);
  assert.equal(TT.e2eMarksAd(el('div', { e2e: 'video-author-uniqueid' })), false);
  assert.equal(TT.e2eMarksAd(el('div')), false);
});

// ── Container targeting (the core fix) ───────────────────────────────────────

test('findContainer walks up to the feed-item container from a deep leaf', () => {
  const label = el('span', { text: 'Sponsored' });
  const container = el('div', { e2e: 'recommend-list-item-container', children: [
    el('div', { children: [ el('div', { children: [label] }) ] }),
  ]});
  assert.equal(TT.findContainer(label), container);
});

test('findContainer returns null when there is no container (never remove the label)', () => {
  const orphanLabel = el('span', { text: 'Sponsored', children: [] });
  el('div', { e2e: 'some-wrapper', children: [ el('div', { children: [orphanLabel] }) ] });
  // 'some-wrapper' is not a recognized container, and there is no article/li above
  assert.equal(TT.findContainer(orphanLabel, 4), null);
});

// ── End-to-end proof over a realistic feed ───────────────────────────────────

function buildFeed() {
  const adByCaption = el('div', { e2e: 'recommend-list-item-container', children: [
    el('div', { e2e: 'video-author-uniqueid', children: [
      el('span', { text: '@brand' }), el('span', { text: 'Sponsored' }),
    ]}),
  ]});
  const organic = el('div', { e2e: 'recommend-list-item-container', children: [
    el('div', { e2e: 'video-desc', children: [ el('span', { text: 'funny cats compilation' }) ] }),
  ]});
  const adByMarker = el('div', { e2e: 'recommend-list-item-container', children: [
    el('div', { e2e: 'feed-ad', children: [ el('span', { text: 'Download now' }) ] }),
  ]});
  const feed = el('div', { e2e: 'recommend-list', children: [adByCaption, organic, adByMarker] });
  return { feed, adByCaption, organic, adByMarker };
}

test('removes exactly the ad feed items and leaves organic videos intact', () => {
  const { feed, adByCaption, organic, adByMarker } = buildFeed();
  const removed = simulateClean(feed);
  assert.equal(removed.length, 2);
  assert.ok(removed.includes(adByCaption), 'ad detected by Sponsored caption should be removed');
  assert.ok(removed.includes(adByMarker), 'ad detected by data-e2e marker should be removed');
  assert.equal(adByCaption.isConnected, false);
  assert.equal(adByMarker.isConnected, false);
  assert.equal(organic.isConnected, true);          // ← the stability guarantee
  assert.ok(feed.children.includes(organic));
  assert.equal(feed.children.length, 1);
});

test('an item flagged by BOTH a marker and a caption is removed only once', () => {
  const item = el('div', { e2e: 'recommend-list-item-container', children: [
    el('div', { e2e: 'feed-ad', children: [ el('span', { text: 'Sponsored' }) ] }),
  ]});
  const feed = el('div', { e2e: 'recommend-list', children: [item] });
  const removed = simulateClean(feed);
  assert.equal(removed.length, 1);
});

test('a feed with no ads is left completely untouched (stability)', () => {
  const a = el('div', { e2e: 'recommend-list-item-container', children: [ el('span', { text: 'travel vlog' }) ] });
  const b = el('div', { e2e: 'recommend-list-item-container', children: [ el('span', { text: 'cooking tips' }) ] });
  const feed = el('div', { e2e: 'recommend-list', children: [a, b] });
  assert.equal(simulateClean(feed).length, 0);
  assert.equal(feed.children.length, 2);
});
