ShieldBlock Pro
Privacy Policy
Last updated: May 11, 2026  ·  Effective immediately

Short version: ShieldBlock Pro processes everything locally on your device. We do not collect, transmit, or sell any personal data. No account is required. No analytics. No tracking.

1. Who we are
ShieldBlock Pro ("the Extension") is a browser extension developed and maintained by Bronson Bissell. Questions can be directed to the support page linked in the Chrome Web Store listing.

2. What data the Extension handles
The Extension stores the following data exclusively on your local device using browser-provided storage APIs (chrome.storage.local and the browser's built-in IndexedDB). None of this data ever leaves your device.

Settings & preferences — which features are enabled, your whitelist of sites, and toggle states. Stored in chrome.storage.local.
Ad block statistics — counts of ads blocked per platform (YouTube, Twitch, Spotify, etc.) and an estimate of time saved. Stored in chrome.storage.local.
Event logs — a rolling debug log (last 7 days) of extension activity used for in-popup diagnostics. Stored in IndexedDB on your device. Logs are never sent anywhere.
Filter list cache — downloaded filter list files (EasyList, uBlock filters, etc.) are cached locally so the extension works without re-downloading on every page. Stored in chrome.storage.local.
3. Data we do NOT collect
Browsing history or URLs you visit
Page content or form data
Personally identifiable information of any kind
Crash reports or telemetry
Information about which ads were blocked on which sites
4. Network requests made by the Extension
The Extension makes outbound network requests only for the following purposes:

Filter list updates — the Extension periodically downloads ad-blocking filter lists from public CDNs (e.g., EasyList, uBlock Origin filter repositories, AdGuard servers). These requests carry no user identifiers. The downloaded content is cached locally.
No other network requests are made. The Extension does not connect to any ShieldBlock-owned server, analytics service, or third-party data broker.

5. Permissions and why we need them
declarativeNetRequest — to block ads and trackers at the network level without reading page content.
storage — to save your settings and statistics locally.
tabs / webNavigation — to detect navigation events so the extension can apply rules per-page and update the popup badge count.
scripting — to inject ad-removal scripts into YouTube, Twitch, Spotify, Hulu, and Kick pages.
alarms — to schedule periodic filter list refreshes.
contextMenus — to provide the right-click "Hide this element" picker.
host_permissions (<all_urls>) — required so declarativeNetRequest rules can apply to any website and so content scripts can run on streaming platforms.
6. Data sharing and third parties
We do not share, sell, rent, or trade any data with any third party. The Extension has no backend server and no telemetry pipeline. The only external parties involved are the operators of the public filter list repositories the Extension downloads from (EasyList, uBlock, AdGuard), and those downloads carry no user-identifying information.

7. Children's privacy
The Extension does not knowingly collect any information from children under 13 (or the applicable age in your jurisdiction). No personal data is collected from any user regardless of age.

8. Data retention and deletion
All data is stored locally on your device. You can delete it at any time by:

Opening the extension popup → Settings → "Reset Stats" or "Clear Logs"
Uninstalling the Extension — this removes all chrome.storage.local and IndexedDB data automatically
9. Changes to this policy
If we make material changes to this policy, we will update the "Last updated" date above. Continued use of the Extension after changes constitutes acceptance of the updated policy. Given that we collect no personal data, changes are expected to be infrequent.

10. Contact
If you have questions about this privacy policy, please open an issue on the Chrome Web Store support page or contact the developer via the link in the store listing.

© 2026 ShieldBlock Pro · Bronson Bissell · Home
