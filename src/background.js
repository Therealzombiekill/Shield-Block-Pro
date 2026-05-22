 * ShieldBlock Pro — Background Service Worker
 */

import './browser-compat.js';
import { parseFilterList } from './filter-parser.js';

const MAX_DYNAMIC_RULES = 5000;
// ID reserved for the global pause-all DNR allow rule. Must be outside all filter
// ID ranges: static rules 1–9999, dynamic filter rules 10000–20249.
const PAUSE_ALL_RULE_ID = 49999;
