/**
 * ShieldBlock Pro — Social Media Ad Remover v3.0
 * Covers: Facebook, Instagram, Reddit, Twitter/X, LinkedIn, TikTok
 *
 * Key improvements over v2:
 * - 30+ language "Sponsored" translations (was 4)
 * - Zero-width character stripping for Facebook obfuscated labels
 * - Facebook/Instagram Reels ad detection
 * - X "Suggested Post" removed alongside "Promoted"
 * - Dead sidebar code removed from cleanTwitter
 * - replaceState patched for full SPA nav coverage
 * - Debounce reduced 400ms → 150ms for faster visual removal
 */

(async () => {
  // If SW is waking up when this fires, sendMessage throws and the IIFE crashes
  // silently — no ad blocking runs at all. Retry once after 300ms.
  let settings;
  try {
    settings = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
  } catch (_) {
    await new Promise(r => setTimeout(r, 300));
    try { settings = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }); }
    catch (_) { settings = null; }
  }
  const _wl = settings?.whitelist ?? [];
  if (settings?.globalPause) return; // global pause active — skip all processing
  if (!settings?.social) return;

  const _host = location.hostname.replace(/^www\./, '');
  if (_host.includes('youtube.com') || _host.includes('youtu.be')) return;
  if (_wl.some(d => _host === d || _host.endsWith('.' + d))) return;

  const host = _host;
  const path = location.pathname;

  // Per-platform page guards
  if (host.includes('facebook.com')) {
    if (['/messages', '/marketplace', '/gaming', '/groups/work']
        .some(p => path.startsWith(p))) return;
  }
  if (host.includes('instagram.com')) {
    if (['/direct', '/accounts', '/api'].some(p => path.startsWith(p))) return;
  }
  if (host.includes('linkedin.com')) {
    if (['/messaging', '/learning'].some(p => path.startsWith(p))) return;
  }

  // ── "Sponsored" in 50+ languages ──────────────────────────────────────────
  // Covers every major market where Facebook/Instagram/X/LinkedIn run ads.
  // Duplicates removed (was 113 entries with 10 dupes → 103 unique).
  // Facebook/X obfuscate this text with invisible Unicode between letters —
  // cleanText() strips all known variants before Set lookup.
  const SPONSORED_LABELS = new Set([
    // ── English ─────────────────────────────────────────────────────────
    'Sponsored', 'Promoted', 'Advertisement', 'Ad', 'Paid', 'Suggested post',
    // ── Western European ────────────────────────────────────────────────
    'Gesponsert', 'Werbung', 'Anzeige',                        // German
    'Sponsorisé', 'Sponsorisée', 'Publicité',                  // French
    'Patrocinado', 'Patrocinada', 'Publicidad', 'Anuncio',     // Spanish
    'Publicidade',                                             // Portuguese (Patrocinado shared with ES)
    'Sponsorizzato', 'Sponsorizzata', 'Pubblicità',            // Italian
    'Gesponsord', 'Advertentie',                               // Dutch
    'Sponsrad', 'Sponsrat',                                    // Swedish (Reklam shared)
    'Sponset', 'Annonse',                                      // Norwegian
    'Sponsoreret', 'Annonce',                                  // Danish
    'Sponsoroitu', 'Mainos',                                   // Finnish
    'Patrocinat', 'Publicitat',                                // Catalan
    // ── Baltic ──────────────────────────────────────────────────────────
    'Sponsorēts', 'Reklāma',                                   // Latvian
    'Remiama',                                                 // Lithuanian (Reklama shared below)
    'Sponsoreeritud', 'Reklaam',                               // Estonian
    // ── Central / Eastern European ──────────────────────────────────────
    'Sponsorowane', 'Sponsorowany',                            // Polish (Reklama shared)
    'Sponzorováno', 'Sponzorované', 'Sponzorovaný',           // Czech / Slovak
    'Szponzorált', 'Hirdetés',                                 // Hungarian
    'Sponsorizat', 'Reclamă',                                  // Romanian
    'Sponzorirano', 'Oglašavano',                              // Croatian / Slovenian / Bosnian
    'Sponzorisano', 'Oglas',                                   // Serbian
    'Sponsorizuar',                                            // Albanian
    'Reklama', 'Reklam',                                       // Shared: PL/CZ/LT/TR/SV
    // ── Cyrillic ────────────────────────────────────────────────────────
    'Реклама',                                                 // Russian / Ukrainian (shared)
    'Спонсировано',                                            // Russian
    'Спонсоровано',                                            // Ukrainian
    'Спонсорирано',                                            // Bulgarian
    'Рекламное',                                               // Belarusian
    'Спонсорланган',                                           // Uzbek
    'Жарнама', 'Демеушілікпен',                                // Kazakh
    'Ирекле', 'Белешмә',                                       // Tatar
    // ── South Caucasus ──────────────────────────────────────────────────
    'სპონსორი', 'რეკლამა',                                     // Georgian
    'Sponsorlu',                                               // Turkish / Azerbaijani (Reklam shared)
    // ── Middle East / North Africa ──────────────────────────────────────
    'ممول', 'إعلان', 'مدفوع',                                  // Arabic
    'ממומן', 'פרסומת',                                         // Hebrew
    'تبلیغ', 'پشتیبانی شده',                                   // Persian/Farsi
    'اشتهار',                                                  // Urdu/Pashto
    // ── South Asia ──────────────────────────────────────────────────────
    'प्रायोजित', 'विज्ञापन',                                     // Hindi
    'স্পন্সর করা', 'বিজ্ঞাপন',                                   // Bengali
    'ਸਪਾਂਸਰ ਕੀਤਾ',                                             // Punjabi
    'ஸ்பான்சர்', 'விளம்பரம்',                                    // Tamil
    'ప్రాయోజితం', 'ప్రకటన',                                      // Telugu
    'ಸ್ಪಾನ್ಸರ್ ಮಾಡಲಾಗಿದೆ',                                     // Kannada
    'സ്പോൺസർ ചെയ്‌തത്',                                       // Malayalam
    'අනුග්‍රහය', 'දැන්වීම',                                     // Sinhala
    // ── Southeast Asia ──────────────────────────────────────────────────
    'Được tài trợ', 'Quảng cáo',                              // Vietnamese
    'Bersponsor', 'Iklan',                                     // Indonesian / Malay (Iklan shared)
    'Tajaan',                                                  // Malay alt
    'ผู้สนับสนุน', 'โฆษณา',                                     // Thai
    'ផ្សព្វផ្សាយ', 'ឧបត្ថម្ភ',                                   // Khmer
    'ໂຄສະນາ',                                                  // Lao
    'ကြော်ငြာ', 'ပံ့ပိုးသည်',                                   // Burmese
    // ── East Asia ───────────────────────────────────────────────────────
    'スポンサー付き', 'スポンサー', '広告', 'PR',               // Japanese
    '광고', '스폰서',                                            // Korean
    '赞助内容', '推广', '广告',                                  // Chinese Simplified
    '贊助', '廣告', '推廣',                                      // Chinese Traditional
    // ── Africa ──────────────────────────────────────────────────────────
    'Inisponsor',                                              // Filipino/Tagalog
    'Inayofadhiliwa', 'Tangazo',                               // Swahili
    'ስፖንሰር የሆነ', 'ማስታወቂያ',                                     // Amharic
    // ── Other ───────────────────────────────────────────────────────────
    'Χορηγούμενο', 'Διαφήμιση',                                // Greek
    'Ивээн тэтгэсэн', 'Зар сурталчилгаа',                      // Mongolian
  ]);

  // Strip ALL invisible/directional Unicode characters Facebook and X use to
  // obfuscate sponsored labels. Covers: zero-width space/non-joiner/joiner,
  // word-joiner, BOM, soft-hyphen, LTR/RTL marks, and other format chars.
  const _INVISIBLE_RE = /[\u00AD\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060-\u206F\uFEFF]/g;
  function cleanText(el) {
    return el.textContent
      .replace(_INVISIBLE_RE, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function isSponsored(el) {
    return SPONSORED_LABELS.has(cleanText(el));
  }

  let blocked = 0;
  let _lastSocialLog = 0;
  function report() {
    if (blocked > 0) {
      chrome.runtime.sendMessage({ type: 'INCREMENT_STAT', statType: 'social' }).catch(()=>{});
      const now = Date.now();
      if (now - _lastSocialLog > 5000) {
        _lastSocialLog = now;
        chrome.runtime.sendMessage({ type: 'LOG_EVENT', source: 'social',
          level: 'info', message: `Removed ${blocked} sponsored posts on ${host}` }).catch(()=>{});
      }
      blocked = 0;
    }
  }

  // Walk up from el to find an ancestor matching a predicate, up to maxDepth levels
  function walkUp(el, test, maxDepth = 12) {
    let node = el;
    for (let i = 0; i < maxDepth; i++) {
      node = node?.parentElement;
      if (!node) return null;
      if (test(node)) return node;
    }
    return null;
  }

  function removePost(el) {
    if (!el || !el.isConnected) return;
    el.remove();
    blocked++;
  }
  // ── Facebook ───────────────────────────────────────────────────────────────
  function cleanFacebook() {
    // 1. Right-rail ad units
    document.querySelectorAll('[data-pagelet^="RightRailAd"]').forEach(el => {
      removePost(el);
    });

    // 2. Right-rail "Sponsored" headings
    const rightRail = document.querySelector('[data-pagelet="RightRail"]');
    if (rightRail) {
      rightRail.querySelectorAll('span, h3, h4').forEach(heading => {
        if (heading.children.length === 0 && isSponsored(heading)) {
          const container = walkUp(heading, n => n.parentElement === rightRail) ?? heading;
          removePost(container);
        }
      });
    }

    // 3. Feed articles containing aria-label="Sponsored" or data-ad-preview
    const adSelectors = [
      '[aria-label="Sponsored"]',
      '[data-ad-preview]',
      '[data-adblockertest]',
    ];
    adSelectors.forEach(sel => {
      document.querySelectorAll(sel).forEach(el => {
        const article = walkUp(el, n =>
          n.getAttribute?.('role') === 'article' ||
          n.tagName === 'LI' ||
          n.dataset?.pagelet?.startsWith?.('FeedUnit')
        );
        removePost(article ?? el);
      });
    });

    // 4. Leaf-span "Sponsored" text inside feed articles (multi-language, zero-width stripped)
    document.querySelectorAll('[role="article"]').forEach(article => {
      if (!article.isConnected) return;
      for (const span of article.querySelectorAll('span')) {
        if (span.children.length === 0 && isSponsored(span)) {
          removePost(article); return;
        }
      }
    });

    // 5. FeedUnit pageletts with ad markers
    document.querySelectorAll('[data-pagelet^="FeedUnit"]').forEach(unit => {
      if (unit.querySelector('[data-ad-preview], [aria-label="Sponsored"]')) {
        removePost(unit);
      }
    });

    // 6. Facebook Reels ads — different structure from feed posts
    document.querySelectorAll('[data-pagelet^="ReelsUnit"]').forEach(reel => {
      if (reel.querySelector('[aria-label="Sponsored"]') ||
          [...reel.querySelectorAll('span')].some(s => s.children.length === 0 && isSponsored(s))) {
        removePost(reel);
      }
    });

    // 7. Stories ads (top-of-feed tray)
    document.querySelectorAll('[aria-label*="Sponsored story"]').forEach(el => {
      removePost(el.closest('li') ?? el);
    });

    if (blocked > 0) report();
  }

  // ── Instagram ──────────────────────────────────────────────────────────────
  function cleanInstagram() {
    // Feed posts
    document.querySelectorAll('article').forEach(article => {
      if (!article.isConnected) return;
      // Text label (multi-language)
      for (const span of article.querySelectorAll('span')) {
        if (span.children.length === 0 && isSponsored(span)) {
          removePost(article); return;
        }
      }
      if (article.querySelector('[aria-label="Sponsored"]')) {
        removePost(article); return;
      }
    });

    // Reels ads — Instagram Reels use a different container structure
    document.querySelectorAll('[class*="reel"]').forEach(reel => {
      if (reel.querySelector('[aria-label*="Sponsored"]') ||
          [...reel.querySelectorAll('span')].some(s => s.children.length === 0 && isSponsored(s))) {
        removePost(reel.closest('section') ?? reel.closest('li') ?? reel);
      }
    });

    // Stories ads
    document.querySelectorAll('[aria-label*="Sponsored"]').forEach(el => {
      const container = el.closest('[role="button"]') ??
                        el.closest('section') ??
                        el.closest('div[tabindex]');
      if (container) removePost(container);
    });

    // Explore grid ads
    document.querySelectorAll('[class*="x1lliihq"]').forEach(cell => {
      if (cell.querySelector('[aria-label="Sponsored"]')) {
        removePost(cell.closest('li') ?? cell);
      }
    });

    if (blocked > 0) report();
  }

  // ── Reddit ─────────────────────────────────────────────────────────────────
  function cleanReddit() {
    // Old Reddit
    document.querySelectorAll('.promotedlink, [data-promoted="true"], .promoted-tag').forEach(el => {
      removePost(el.closest('.thing') ?? el.closest('li') ?? el);
    });

    // New Reddit — shreddit custom elements
    document.querySelectorAll('shreddit-ad-post, [adtype]').forEach(el => removePost(el));

    // New Reddit — data attributes
    document.querySelectorAll('[data-adtype], [data-testid*="promoted"]').forEach(el => {
      removePost(el.closest('article') ?? el.closest('shreddit-post') ?? el);
    });

    // New Reddit — "Promoted" text in article spans/flairs (multi-language via isSponsored)
    document.querySelectorAll('article').forEach(article => {
      if (!article.isConnected) return;
      for (const el of article.querySelectorAll('[class*="flair"], [class*="label"], span')) {
        if (el.children.length === 0 && isSponsored(el)) {
          removePost(article); return;
        }
      }
    });

    // Reddit search page ads
    document.querySelectorAll('[data-testid="post-container"]').forEach(post => {
      if (post.querySelector('[class*="promoted"], [data-promoted]')) removePost(post);
    });

    if (blocked > 0) report();
  }

  // ── Twitter / X ────────────────────────────────────────────────────────────
  function cleanTwitter() {
    // Promoted tweets — [data-testid="promotedIndicator"] is the canonical selector
    document.querySelectorAll('[data-testid="promotedIndicator"]').forEach(el => {
      const tweet = el.closest('article') ??
                    el.closest('[data-testid="cellInnerDiv"]');
      if (tweet) removePost(tweet);
    });

    // Belt-and-suspenders: walk cells for promoted labels in any language
    // X uses "Suggested Post" for some ad types that don't get the promotedIndicator
    document.querySelectorAll('[data-testid="cellInnerDiv"]').forEach(cell => {
      if (!cell.isConnected) return;
      if (cell.querySelector('[data-testid="promotedIndicator"]')) {
        removePost(cell); return;
      }
      for (const span of cell.querySelectorAll('span')) {
        if (span.children.length === 0 &&
            (isSponsored(span) || span.textContent.trim() === 'Suggested Post')) {
          removePost(cell); return;
        }
      }
    });

    // Promoted trends in the sidebar
    document.querySelectorAll('[data-testid="trend"]').forEach(trend => {
      if (trend.querySelector('[aria-label*="Ad" i]') ||
          [...trend.querySelectorAll('span')].some(s => s.children.length === 0 && isSponsored(s))) {
        removePost(trend);
      }
    });

    if (blocked > 0) report();
  }

  // ── LinkedIn ───────────────────────────────────────────────────────────────
  function cleanLinkedIn() {
    // Feed "Promoted" posts — use data-urn (stable LinkedIn URN format) + isSponsored()
    // Removed [class*="actor-sub"] and .feed-shared-actor__sub-description — class names
    // change with every LinkedIn frontend deploy. Text matching is more durable.
    document.querySelectorAll('[data-urn*="ugcPost"], [data-urn*="share"]').forEach(post => {
      if (!post.isConnected) return;
      // Check aria-label (English, stable) and full span text scan (any language)
      if (post.querySelector('[aria-label*="Promoted"]')) { removePost(post); return; }
      for (const span of post.querySelectorAll('span')) {
        if (span.children.length === 0 && isSponsored(span)) { removePost(post); return; }
      }
    });

    // Sidebar and promoted cards via stable aria-label
    document.querySelectorAll('[aria-label*="Promoted"]').forEach(el => {
      removePost(el.closest('section') ?? el.closest('li') ?? el);
    });

    // Job promotion ads via data-view-name (LinkedIn's own stable attribute)
    document.querySelectorAll('[data-view-name*="promoted-job"]').forEach(el => {
      removePost(el.closest('li') ?? el);
    });
  }

  // ── TikTok ─────────────────────────────────────────────────────────────────
  // TikTok's CSS classes are fully obfuscated and change on every app deploy.
  // Only use data-e2e attributes (TikTok's own stable test IDs) + sponsored
  // text label matching. Removed all [class*="..."] selectors — too fragile.
  function cleanTikTok() {
    // data-e2e is TikTok's stable test attribute — used in their own test suite
    document.querySelectorAll(
      '[data-e2e*="ad-"], [data-e2e="for-you-ad"], ' +
      '[data-e2e="recommend-ad-card"], [data-e2e="search-ad-item"]'
    ).forEach(el => {
      removePost(el.closest('article') ?? el.closest('li') ?? el);
    });

    // Sponsored text labels via the universal isSponsored() check
    document.querySelectorAll('[data-e2e]').forEach(el => {
      for (const span of el.querySelectorAll('span')) {
        if (span.children.length === 0 && isSponsored(span)) {
          removePost(el.closest('article') ?? el.closest('li') ?? el);
          break;
        }
      }
    });
  }

  // ── Dispatch ───────────────────────────────────────────────────────────────
  function clean() {
    blocked = 0; // reset counter each cycle so report() fires correctly
    if (host.includes('facebook.com'))                    cleanFacebook();
    else if (host.includes('instagram.com'))              cleanInstagram();
    else if (host.includes('reddit.com'))                 cleanReddit();
    else if (host.includes('twitter.com') ||
             host.includes('x.com'))                      cleanTwitter();
    else if (host.includes('linkedin.com'))             { cleanLinkedIn(); if (blocked > 0) report(); }
    else if (host.includes('tiktok.com'))               { cleanTikTok();   if (blocked > 0) report(); }
  }

  // ── Observer + polling ─────────────────────────────────────────────────────
  let _debounce = null;
  const _observer = new MutationObserver(() => {
    clearTimeout(_debounce);
    _debounce = setTimeout(clean, 150); // was 400ms — reduced for faster visual removal
  });
  _observer.observe(document.body ?? document.documentElement, {
    childList: true, subtree: true,
  });

  let _interval = setInterval(clean, 3000);
  clean();

  chrome.storage.onChanged.addListener((changes) => {
    const _nv = changes.settings?.newValue;
    const _ov = changes.settings?.oldValue;
    if (_nv?.social === false) {
      clearInterval(_interval);
      _observer.disconnect();
      clearTimeout(_debounce);
    } else if (_nv?.social === true && _ov?.social === false) {
      _observer.observe(document.body ?? document.documentElement, { childList: true, subtree: true });
      _interval = setInterval(clean, 3000);
      clean();
    }
  });

  // SPA navigation — patch both pushState AND replaceState
  let _lastUrl = location.href;
  function onUrlChange() {
    if (location.href !== _lastUrl) {
      _lastUrl = location.href;
      setTimeout(clean, 600);
    }
  }
  window.addEventListener('popstate', onUrlChange);
  const _origPush    = history.pushState;
  const _origReplace = history.replaceState;
  history.pushState = function () {
    _origPush.apply(this, arguments);
    setTimeout(onUrlChange, 0);
  };
  history.replaceState = function () {
    _origReplace.apply(this, arguments);
    setTimeout(onUrlChange, 0);
  };

})().catch(e => console.warn('[SB:social] script error:', e?.message ?? e));
