# Variant & Sibling — Chrome Extension Complete Documentation

> **Purpose:** Extract Amazon product variants (siblings) and create grouped CSV files for Dropy.in Shopify store's sibling system.
> 
> **This document contains:** Rules, flow, architecture, AND all source code. Share this single file with any AI to debug, improve, or rebuild.

---

## 1. WHAT THIS EXTENSION DOES

Takes a list of Amazon ASINs (uploaded as file or pasted), visits each ASIN on Amazon.com, detects if the product has variants (different sizes, colors, flavors, etc.), cross-references those variants against the uploaded ASIN list, and creates sibling groups. Output is a CSV with `GroupID, ASIN, Label`.

**Example:**
```
Upload: B00PF84ANA, B0GH9YWMFB, B08FD7JHJ9, B08FD7JHJ8

Step 1: Visit amazon.com/dp/B00PF84ANA
  → Amazon shows variants: B00PF84ANA (Pack of 1), B0GH9YWMFB (Pack of 2)
  → B0GH9YWMFB is in upload list → GROUP 1
  → Mark B0GH9YWMFB as SKIP

Step 2: B0GH9YWMFB → SKIP (already in Group 1)

Step 3: Visit amazon.com/dp/B08FD7JHJ9
  → Variants: B08FD7JHJ9, B08FD7JHJ8, B08FD83Z9B
  → B08FD7JHJ8 in upload → include
  → B08FD83Z9B NOT in upload → EXCLUDE
  → GROUP 2: [B08FD7JHJ9, B08FD7JHJ8]

Output CSV:
GroupID, ASIN, Label
1, B00PF84ANA, 1 Count (Pack of 1)
1, B0GH9YWMFB, 1 Count (Pack of 2)
2, B08FD7JHJ9, Blue/Grey - 6-18m
2, B08FD7JHJ8, Princess/Swans - 6-18m
```

---

## 2. RULES (USER-DEFINED — DO NOT CHANGE WITHOUT APPROVAL)

### Rule Set A: Variant Detection

| # | Rule | Example |
|---|------|---------|
| A1 | Only these Amazon variant dimensions are valid: Size, Color, Pack/Count, Flavor/Scent, Style/Pattern, Strength/Potency, Format/Form, Configuration/Bundle, Material, Set | "Color: Navy" ✓, "Brand: Stanley" ✗ |
| A2 | Only variant ASINs that ARE in the upload list get included in groups | Upload has [A,B,C]. Amazon shows variants [A,B,D]. Group = [A,B]. D excluded. |
| A3 | Variant ASINs NOT in upload list → completely excluded, never added to group | D is on Amazon but not in upload → skip |
| A4 | Grouped ASINs → skip future processing. Don't visit their page again as primary ASIN | B found as variant of A → when B comes up in queue → skip |
| A5 | If a variant ASIN is already in an existing group → MERGE current ASIN into that group, don't create duplicate group | A creates Group 1 with [A,B]. Later C finds B as variant → C merges into Group 1, not Group 2 |
| A6 | Standalone ASINs (no variants in upload list) → skip from output CSV. Only grouped ASINs appear in CSV | ASIN with no matching variants → not in output |

### Rule Set B: Label Format

| # | Rule | Example |
|---|------|---------|
| B1 | Label = real variant dimensions from Amazon, joined with ` - ` | "16 Ounces - Navy" |
| B2 | Order: Size/numeric FIRST, then Color/Flavor/Style/Set | "0.23 Ounce (Pack of 1) - Black" ✓, "Black - 0.23 Ounce" ✗ |
| B3 | If variant has BOTH Size and Color/Flavor → combine both | "6 Ounce (Pack of 1) - Bac'n Nutty" |
| B4 | If variant has ONLY Color/Flavor/Set (no numeric size) → check product title for numeric | variant = "Scented", title has "1.01 fl oz" → "1.01 fl oz - Scented" |
| B5 | Extract ONLY numeric+unit from title. NEVER non-numeric words | Title "Moisturizing Cleanser 5.07 Fl Oz" → extract "5.07 Fl Oz" only, NOT "Moisturizing Cleanser" |
| B6 | If title also has no numeric → keep only what variant has | variant = "OAT CINNAMON", title has no size → "OAT CINNAMON" |
| B7 | If variant already has numeric size → do NOT touch title, keep as-is | variant = "8.75 Ounce (Pack of 1)" → keep, don't add title numbers |
| B8 | Use hyphen ` - ` not em dash ` — ` between parts (encoding safe) | "Navy - 16 Ounces" ✓, "Navy — 16 Ounces" ✗ |
| B9 | Numeric units to detect from title: fl oz, oz, ounce, ml, L, g, gram, count, ct, pack, piece, tablet, capsule, gummies, mg, IU, x2/x3 | All valid extraction targets |

### Rule Set C: Garbage Filters (text that must NEVER appear in labels)

| # | Text to reject | Why |
|---|----------------|-----|
| C1 | `Currently unavailable.` | Stock status, not variant |
| C2 | `Temporarily out of stock.` | Stock status |
| C3 | `out of stock` | Stock status |
| C4 | `We don't know when or if this item will be back in stock` | Stock notice |
| C5 | `back in stock` | Stock notice |
| C6 | `X options from` / `1 option from` | Swatch availability text |
| C7 | `See available options` / `See N options` | Swatch text |
| C8 | `No featured offers` / `featured offers` | Buy box text |
| C9 | `Select Size` / `Select Color` / `Select Pattern Name` | Unselected dimension placeholder |
| C10 | `Add to cart` / `Add to List` / `Add to Registry` | Button text |
| C11 | `Subscribe & Save` | Subscription text |
| C12 | `Customers usually keep this item` | Amazon notice |
| C13 | `Click to select` | Swatch instruction |
| C14 | Any text longer than 50 characters | Sentences, descriptions, reviews |
| C15 | Text containing `$` (after price stripping fails) | Prices |
| C16 | Sentence-like text (`. [A-Z]` pattern with >6 words) | Review snippets |

### Rule Set D: Download & Output

| # | Rule | Detail |
|---|------|--------|
| D1 | Auto-download when processing completes | From background.js service worker, not popup |
| D2 | NO download when clicking extension icon | Popup shows results but doesn't trigger download |
| D3 | Multiple files uploaded → separate download per source file | Upload A.csv + B.txt → downloads A_variants.csv + B_variants.csv |
| D4 | Download filename = `{original_upload_filename}_variants.csv` | Upload "Grande_Cosmetics.csv" → "Grande_Cosmetics_variants.csv" |
| D5 | If group has ASINs from multiple source files → group appears in BOTH output CSVs | Cross-file variants included in each relevant file |
| D6 | CSV has UTF-8 BOM (`\uFEFF`) for Excel compatibility | First byte of CSV |
| D7 | CSV columns: `GroupID, ASIN, Label` | Header row always present |
| D8 | Only grouped ASINs in CSV, standalone ASINs skipped | No single-ASIN rows |

### Rule Set E: Processing Behavior

| # | Rule | Detail |
|---|------|--------|
| E1 | Delay between ASINs: 3 seconds default, configurable 1s-15s | User can adjust via UI |
| E2 | CAPTCHA detected → pause processing, alert user | User solves captcha manually, clicks Resume |
| E3 | Retry label fetch: 3 attempts with full page RELOAD | Re-reading same DOM gives same result, must reload |
| E4 | If all 3 retry attempts fail → empty label (acceptable) | Some Amazon pages are broken |
| E5 | Crash recovery: save state after every ASIN | If PC restarts, resume from last position |
| E6 | Service worker restart → auto-set status to 'paused', show resume banner | User clicks Resume to continue |
| E7 | Opens new tab for processing, not existing tab | Don't interfere with user's browsing |
| E8 | Processing continues even when popup is closed | Background service worker handles everything |

### Rule Set F: Variant Dimension Types (Amazon)

```
Size        → 250ml, 500ml, 1L, 30ct, 60ct, 90ct, 120ct, 240ct
Color       → Red, Blue, Black, White, Navy, 01 Matte Flax
Pack/Count  → Pack of 1, Pack of 2, Pack of 3, Pack of 6
Flavor/Scent → Vanilla, Chocolate, Lavender, Mint, Bac'n Nutty
Style/Pattern → Different design versions of the same product
Size+Color  → Multi-dimension: Small-Red, Large-Blue
Strength    → 500mg, 1000mg, 5000IU, 10000IU (supplements)
Format/Form → Capsules, Softgels, Gummies, Powder, Liquid
Configuration → "Bottle Only", "With Pump", "Starter Kit"
Material    → Cotton, Polyester, Leather
Set         → Original, K POP DEMON HUNTERS EDITION, Golden Honmoon
```

---

## 3. FILE ARCHITECTURE

```
variant-sibling/
├── manifest.json             → MV3 Chrome extension config
├── background.js (967 lines) → Service worker: processing engine, state, downloads
├── content.js (517 lines)    → Injected into Amazon pages: variant ASIN extraction
├── popup.html                → Extension popup UI
├── popup.css                 → Styling
├── popup.js (624 lines)      → UI logic, file parsing, state polling
├── icons/                    → Extension icons (16/48/128px)
└── libs/xlsx.mini.min.js     → SheetJS for XLSX parsing (download from cdn.sheetjs.com)
```

---

## 4. COMPLETE PROCESSING FLOW

### Phase 1: Input (popup.js)
```
User uploads file(s) or pastes ASINs
  → Parse TXT/CSV/XLSX, extract 10-char ASINs
  → Deduplicate
  → Track per-file mapping: { "filename": [ASINs] }
  → Send to background: { type:'START', asins, delay, fileName, fileAsinMap }
```

### Phase 2: Processing (background.js)
```
FOR EACH ASIN in list:
  ├─ SKIP if already in a group
  ├─ Navigate tab → amazon.com/dp/{ASIN}?th=1
  ├─ EXTRACT variants (Strategy 1: MAIN WORLD → Strategy 2: content.js)
  ├─ CAPTCHA → pause
  ├─ Cross-reference variants with upload list
  ├─ GROUP: merge into existing OR create new
  ├─ FETCH LABELS for group members with empty labels
  ├─ Save state to chrome.storage.local
  └─ Wait delay → next ASIN

ON COMPLETE: auto-download CSV(s)
```

### Phase 3: Variant Extraction (content.js)
```
6 strategies tried in order:
  1A.  asinVariationValues + dimensionValuesDisplayData (ASIN→index→label)
  1A2. DVd ASIN-keyed format (ASIN→label direct, newer Amazon pages)
  1B.  defined_asin_variations (older format)
  1C.  asinToDimensionIndexMap
  1D.  Generic ASIN→index scan (regex in script text)
  1E.  Brute-force ASIN scan (no labels, last resort)
  2.   DOM: data-defaultasin, data-asin, dropdowns, links
```

### Phase 4: Label Fetching (background.js)
```
For each ASIN with empty label:
  Visit amazon.com/dp/{ASIN}
  Read visible text line by line from #centerCol
  Match "Color: X", "Size: X", "Set name: Y" patterns
  Apply garbage filters
  If no numeric size found → extract from title (ONLY numeric+unit)
  Combine: [numeric] - [variant name]
  Retry up to 3x with page reload
```

---

## 5. KNOWN ISSUES

1. `asinVariationValues` missing on many newer Amazon pages
2. `#twister` DOM element often doesn't exist
3. `.selection` spans exist for some dimensions but not all
4. Color swatches show "3 options from $22.09" instead of color name
5. "Currently unavailable" pages have no variant selector
6. Amazon CSP blocks inline script injection
7. Title numeric extraction grabs ALL numbers (serving size, weight, volume)
8. "Set name" values sometimes contain product names not variant names
9. Multi-dimension variants (Color × Size × Pattern) create complex label combinations
10. Speed: each label fetch = full page load (~4s per ASIN)

---


## 6. SOURCE CODE


### 6.1 manifest.json
```json
{
  "manifest_version": 3,
  "name": "Variant & Sibling",
  "version": "1.0.0",
  "description": "Extract Amazon product variants and create sibling groups for Dropy",
  "permissions": ["activeTab", "tabs", "storage", "downloads", "scripting"],
  "host_permissions": ["*://www.amazon.com/*", "*://www.amazon.in/*"],
  "action": {
    "default_popup": "popup.html",
    "default_icon": { "16": "icons/icon16.png", "48": "icons/icon48.png", "128": "icons/icon128.png" }
  },
  "background": { "service_worker": "background.js" },
  "content_scripts": [{
    "matches": ["*://www.amazon.com/dp/*", "*://www.amazon.com/*/dp/*", "*://www.amazon.com/gp/product/*", "*://www.amazon.in/dp/*", "*://www.amazon.in/*/dp/*"],
    "js": ["content.js"],
    "run_at": "document_idle"
  }],
  "icons": { "16": "icons/icon16.png", "48": "icons/icon48.png", "128": "icons/icon128.png" }
}
```

### 6.2 background.js
```javascript
/**
 * background.js — Variant & Sibling processing engine (v2)
 *
 * FLOW (with example):
 * ═══════════════════════════════════════════════════════════════
 * Upload list: [B00PF84ANA, B0GH9YWMFB, B08FD7JHJ9, B08FD7JHJ8]
 *
 * Step 1: Process B00PF84ANA
 *   → Open amazon.com/dp/B00PF84ANA
 *   → Content script finds variants: B00PF84ANA (Pack of 1), B0GH9YWMFB (Pack of 2)
 *   → Check each variant ASIN against upload list:
 *       B0GH9YWMFB → IN upload list → include in group
 *   → CREATE Group 1: [B00PF84ANA, B0GH9YWMFB]
 *   → Mark B0GH9YWMFB as SKIP (will not process again)
 *
 * Step 2: Process B0GH9YWMFB → SKIP (already in Group 1)
 *
 * Step 3: Process B08FD7JHJ9
 *   → Open amazon.com/dp/B08FD7JHJ9
 *   → Content script finds variants: B08FD7JHJ9, B08FD7JHJ8, B08FD83Z9B, ...
 *   → Check each against upload list:
 *       B08FD7JHJ8 → IN upload list → include
 *       B08FD83Z9B → NOT in upload list → EXCLUDE
 *   → CREATE Group 2: [B08FD7JHJ9, B08FD7JHJ8]
 *   → Mark B08FD7JHJ8 as SKIP
 *
 * Step 4: Process B08FD7JHJ8 → SKIP (already in Group 2)
 *
 * RULE: Only variant ASINs that are in the upload list are included in groups.
 *       Variant ASINs NOT in upload list → completely ignored.
 * ═══════════════════════════════════════════════════════════════
 */
'use strict';

/* ── Default State ─────────────────────────────────── */

const DEFAULT_STATE = {
  status: 'idle',        // idle | running | paused | stopped | complete
  asinList: [],          // original upload list (ordered, deduped)
  currentIndex: 0,       // which ASIN we're processing next
  skipped: {},           // { ASIN: groupId } — ASINs to skip (already grouped)
  groups: [],            // [{ id, asins: [{asin, label}] }]
  tabId: null,
  runId: null,
  startTime: null,
  delay: 3000,
  fileName: '',             // original upload filename
  fileAsinMap: {},          // { "filename": ["ASIN",...] } for per-file downloads
  logs: [],
  stats: { processed: 0, grouped: 0, skipped: 0, standalone: 0, errors: 0 }
};

let state = { ...DEFAULT_STATE };

/* ── Persistence ───────────────────────────────────── */

async function saveState() {
  try {
    const toSave = { ...state, logs: state.logs.slice(-200) };
    await chrome.storage.local.set({ vsState: toSave });
  } catch (e) { console.error('[VS] Save error:', e); }
}

async function loadState() {
  try {
    const { vsState } = await chrome.storage.local.get('vsState');
    if (vsState) {
      state = { ...DEFAULT_STATE, ...vsState };
      if (state.status === 'running') {
        state.status = 'paused';
        addLog('⚠ Extension restarted — paused. Click Resume to continue.', 'warn');
        await saveState();
      }
    }
  } catch (e) { console.error('[VS] Load error:', e); }
}

/* ── History ───────────────────────────────────────── */

async function saveToHistory() {
  try {
    const { vsHistory = [] } = await chrome.storage.local.get('vsHistory');
    vsHistory.unshift({
      id: state.runId,
      time: new Date().toISOString(),
      fileName: state.fileName,
      totalAsins: state.asinList.length,
      groups: state.groups.length,
      grouped: state.stats.grouped,
      skipped: state.stats.skipped,
      standalone: state.stats.standalone,
      errors: state.stats.errors,
      csvData: generateCSV()
    });
    if (vsHistory.length > 15) vsHistory.length = 15;
    await chrome.storage.local.set({ vsHistory });

    // Also save to cumulative groups (for multi-file download)
    const { vsCumulativeGroups = [] } = await chrome.storage.local.get('vsCumulativeGroups');
    const maxId = vsCumulativeGroups.length > 0
      ? Math.max(...vsCumulativeGroups.map(g => g.id))
      : 0;
    state.groups.forEach((g, i) => {
      vsCumulativeGroups.push({ id: maxId + i + 1, asins: g.asins });
    });
    await chrome.storage.local.set({ vsCumulativeGroups });
  } catch (e) { console.error('[VS] History error:', e); }
}

/* ── Logging ───────────────────────────────────────── */

function addLog(msg, type = 'info') {
  state.logs.push({ time: Date.now(), msg, type });
  if (state.logs.length > 500) state.logs = state.logs.slice(-300);
  broadcast();
}

function broadcast() {
  chrome.runtime.sendMessage({ type: 'STATE_UPDATE', state: getPublicState() }).catch(() => {});
}

function getPublicState() {
  return {
    status: state.status,
    totalAsins: state.asinList.length,
    currentIndex: state.currentIndex,
    groups: state.groups,
    skippedCount: Object.keys(state.skipped).length,
    stats: state.stats,
    logs: state.logs.slice(-100),
    runId: state.runId,
    startTime: state.startTime,
    delay: state.delay,
    fileName: state.fileName,
    fileAsinMap: state.fileAsinMap
  };
}

/* ── CSV ───────────────────────────────────────────── */

function generateCSV() {
  const rows = ['GroupID,ASIN,Label'];
  state.groups.forEach((g, idx) => {
    g.asins.forEach(a => {
      const label = (a.label || '').replace(/"/g, '""');
      rows.push(`${idx + 1},"${a.asin}","${label}"`);
    });
  });
  return rows.join('\n');
}

/* ── Tab Management ────────────────────────────────── */

async function navigateTab(url) {
  // Reuse existing tab or create new one
  if (state.tabId) {
    try {
      await chrome.tabs.get(state.tabId);
      await chrome.tabs.update(state.tabId, { url, active: false });
      return state.tabId;
    } catch {
      state.tabId = null;
    }
  }
  const tab = await chrome.tabs.create({ url, active: false });
  state.tabId = tab.id;
  return tab.id;
}

function waitForLoad(tabId, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error('Page load timeout'));
    }, timeout);

    function listener(id, info) {
      if (id === tabId && info.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function extractWithMainWorld(tabId) {
  // Runs in PAGE's JS context — can access defined_asin_variations, etc.
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: () => {
        const result = {
          asin: '', captcha: false, variants: [], title: '', error: null,
          debug: { source: 'MAIN_WORLD', methods: [] }
        };

        // Current ASIN
        try {
          const c = document.querySelector('link[rel="canonical"]');
          if (c) { const m = c.href.match(/\/dp\/([A-Z0-9]{10})/i); if (m) result.asin = m[1].toUpperCase(); }
          if (!result.asin) { const u = location.pathname.match(/\/dp\/([A-Z0-9]{10})/i); if (u) result.asin = u[1].toUpperCase(); }
        } catch(e) {}

        // Title
        try { const t = document.getElementById('productTitle'); result.title = t ? t.textContent.trim() : ''; } catch(e) {}

        // Captcha
        if (document.getElementById('captchacharacters') || document.title.toLowerCase().includes('robot check')) {
          result.captcha = true; return result;
        }

        const variants = {};

        // Method A: defined_asin_variations (global variable)
        try {
          if (typeof defined_asin_variations === 'object' && defined_asin_variations !== null) {
            result.debug.methods.push('defined_asin_variations');
            for (const [asin, dims] of Object.entries(defined_asin_variations)) {
              if (!/^[A-Z0-9]{10}$/.test(asin)) continue;
              const labels = {};
              if (dims && typeof dims === 'object') {
                for (const [dim, val] of Object.entries(dims)) {
                  if (typeof val === 'string') {
                    const cleanDim = dim.replace(/_name$/i, '').replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
                    labels[cleanDim] = val;
                  }
                }
              }
              variants[asin.toUpperCase()] = { asin: asin.toUpperCase(), labels };
            }
          }
        } catch(e) { result.debug.davError = e.message; }

        // Method B: data-a-state scripts (Amazon's state containers)
        try {
          document.querySelectorAll('script[data-a-state]').forEach(script => {
            try {
              const state = JSON.parse(script.textContent);
              if (!state || typeof state !== 'object') return;
              // Look for variant data patterns
              if (state.asinVariationValues && state.dimensionValuesDisplayData) {
                result.debug.methods.push('data-a-state');
                const dvd = state.dimensionValuesDisplayData;
                const avv = state.asinVariationValues;
                const dimNames = Object.keys(dvd);
                for (const [asin, indices] of Object.entries(avv)) {
                  if (!/^[A-Z0-9]{10}$/.test(asin)) continue;
                  const labels = {};
                  if (Array.isArray(indices)) {
                    indices.forEach((idx, dimIdx) => {
                      const dn = dimNames[dimIdx];
                      if (dn && dvd[dn] && dvd[dn][parseInt(idx)] !== undefined) {
                        const cleanDim = dn.replace(/_name$/i, '').replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
                        labels[cleanDim] = dvd[dn][parseInt(idx)];
                      }
                    });
                  }
                  variants[asin.toUpperCase()] = { asin: asin.toUpperCase(), labels };
                }
              }
            } catch(e) {}
          });
        } catch(e) {}

        // Method C: Read twister DOM (data-defaultasin buttons)
        try {
          const els = document.querySelectorAll('[data-defaultasin]');
          if (els.length > 0) result.debug.methods.push('DOM_defaultAsin');
          els.forEach(el => {
            const asin = (el.getAttribute('data-defaultasin') || '').trim().toUpperCase();
            if (!/^[A-Z0-9]{10}$/.test(asin)) return;
            if (variants[asin]) return; // already have from JS
            let dimName = '';
            const sec = el.closest('[id^="variation_"]');
            if (sec) { const m = sec.id.match(/variation_(.+?)(?:_name)?$/); if (m) dimName = m[1].replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()); }
            let label = '';
            const btn = el.querySelector('.a-button-text, .a-size-base, .twisterTextDiv');
            if (btn) label = btn.textContent.trim().replace(/\$[\d,.]+.*$/m, '').trim();
            if (!label) label = (el.getAttribute('title') || '').replace(/^Click to select\s*/i, '').trim();
            if (!label) { const img = el.querySelector('img'); if (img) label = (img.alt || '').trim(); }
            if (!variants[asin]) variants[asin] = { asin, labels: {} };
            if (dimName && label) variants[asin].labels[dimName] = label;
            else if (label) variants[asin].labels['Variant'] = label;
          });
        } catch(e) {}

        // Build output
        for (const [key, data] of Object.entries(variants)) {
          const vals = Object.values(data.labels).filter(v => v && v.trim());
          result.variants.push({
            asin: key,
            label: vals.length === 1 ? vals[0] : vals.join(' - '),
            isCurrent: key === result.asin
          });
        }

        result.debug.variantCount = result.variants.length;
        return result;
      }
    });

    if (results && results[0] && results[0].result) {
      return results[0].result;
    }
  } catch(e) {
    // MAIN world injection failed — log why
    console.log('[VS] MAIN_WORLD error:', e.message);
  }
  return null;
}

async function askContentScript(tabId) {
  // Wait for page to settle (Amazon loads variant data dynamically)
  await sleep(3000);

  // Strategy 1: MAIN world — reads page JS variables directly (best for labels)
  const mainResult = await extractWithMainWorld(tabId);
  if (mainResult && !mainResult.captcha && !mainResult.error && mainResult.variants.length > 0) {
    return mainResult;
  }
  // If MAIN found captcha, return immediately
  if (mainResult && mainResult.captcha) return mainResult;

  // Strategy 2: Content script (isolated world — parses script text + DOM)
  try {
    return await chrome.tabs.sendMessage(tabId, { type: 'EXTRACT_VARIANTS' });
  } catch {
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
      await sleep(600);
      return await chrome.tabs.sendMessage(tabId, { type: 'EXTRACT_VARIANTS' });
    } catch (e) {
      return { asin: '', captcha: false, variants: [], error: e.message };
    }
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/* ── Label Fetcher: visit each ASIN page and read selected variant ── */

async function fetchLabelForAsin(tabId, asin) {
  // Retry up to 3 times with page RELOAD (re-reading same DOM gives same result)
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await chrome.tabs.update(tabId, { url: `https://www.amazon.com/dp/${asin}?th=1` });
      await waitForLoad(tabId);
      await sleep(2500);
    } catch (e) {
      continue; // reload failed, try again
    }

    let label = '';
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        func: () => {
          const parts = [];
          const seen = new Set();
          const _v = 'LABEL_V6'; // version marker for debugging

          // ── Garbage filter ──
          function isGarbage(t) {
            if (!t || t.length > 50) return true;
            if (/currently\s*unavailable/i.test(t)) return true;
            if (/temporarily\s*out\s*of\s*stock/i.test(t)) return true;
            if (/out\s*of\s*stock/i.test(t)) return true;
            if (/back\s*in\s*stock/i.test(t)) return true;
            if (/we\s*don'?t\s*know/i.test(t)) return true;
            if (/options?\s*from/i.test(t)) return true;
            if (/see\s*(available|\d+|more)/i.test(t)) return true;
            if (/featured\s*offers?/i.test(t)) return true;
            if (/no\s*featured/i.test(t)) return true;
            if (/^select\s/i.test(t)) return true;
            if (/add\s*to\s*(cart|list|registry)/i.test(t)) return true;
            if (/subscribe\s*&?\s*save/i.test(t)) return true;
            if (/customers\s*usually/i.test(t)) return true;
            if (/click\s*to\s*select/i.test(t)) return true;
            if (t.includes('$')) return true;
            if (/\.\s*[A-Z]/.test(t) && t.split(' ').length > 6) return true;
            return false;
          }

          function addPart(text) {
            let t = (text || '').replace(/\s+/g, ' ').trim();
            const di = t.indexOf('$');
            if (di > 0) t = t.substring(0, di).trim();
            t = t.replace(/\s*\($/, '').trim();
            if (isGarbage(t)) return;
            const key = t.toLowerCase();
            if (seen.has(key)) return;
            seen.add(key);
            parts.push(t);
          }

          // ── SIMPLE APPROACH: Read visible text line by line ──
          // Search the ENTIRE visible page text for lines like:
          //   "Color: Navy"
          //   "Size: 16 Ounces"
          //   "Set name: Original"
          //   "Flavor Name: Bac'n Nutty"
          // This is the most reliable — works regardless of DOM structure.

          const dimNames = ['Size', 'Style', 'Color', 'Flavor', 'Scent', 'Pattern',
                           'Format', 'Count', 'Pack', 'Material', 'Configuration',
                           'Strength', 'Bundle', 'Set', 'Item Package Quantity'];
          const dimRe = new RegExp(
            '(?:' + dimNames.join('|') + ')\\s*(?:Name|name)?\\s*[:：]\\s*(.+)',
            'i'
          );

          // Get visible text from product info area
          const areas = [
            document.getElementById('centerCol'),
            document.getElementById('ppd'),
            document.getElementById('dp-container'),
            document.querySelector('#twister')
          ].filter(Boolean);

          const searchArea = areas.length > 0 ? areas[0] : document.body;
          const visibleText = searchArea.innerText || '';
          const lines = visibleText.split('\n');

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.length > 80) continue;
            const m = trimmed.match(dimRe);
            if (m) {
              let val = m[1].trim();
              // Stop at price or garbage
              const dIdx = val.indexOf('$');
              if (dIdx > 0) val = val.substring(0, dIdx).trim();
              val = val.replace(/\d+\s*options?\b.*$/i, '').trim();
              val = val.replace(/\bfrom\b.*$/i, '').trim();
              addPart(val);
            }
          }

          // Also try .selection spans (backup — sometimes innerText misses them)
          document.querySelectorAll('.selection').forEach(el => addPart(el.textContent));

          const realVariant = parts.join(' - ');

          // ── STEP 2: Check if we already have a numeric size ──
          // Real sizes look like: "6 Ounce", "1.05 Fl Oz", "120 Count", "Pack of 2", "250ml", "500mg"
          const numericUnitRe = /\d+\s*(?:\.\d+)?\s*(?:fl\.?\s*oz|fluid\s*ounce|ounce|oz|ml|l\b|gram|g\b|count|ct\b|pack|piece|pcs|tablet|capsule|gumm|mg|iu)/i;
          const hasNumericSize = numericUnitRe.test(realVariant) || /pack\s*of\s*\d+/i.test(realVariant);

          // ── STEP 3: If NO numeric size, pull numeric info from TITLE ──
          let titleNumeric = '';
          if (!hasNumericSize) {
            const titleEl = document.getElementById('productTitle') || document.getElementById('title');
            const title = titleEl ? titleEl.textContent.trim() : '';
            if (title) {
              // Extract ALL numeric+unit chunks from title
              const chunkRe = /\d+\s*(?:\.\d+)?\s*(?:fl\.?\s*oz|fluid\s*ounce|ounces?|oz|ml|l\b|grams?|g\b|counts?|ct\b|packs?|pieces?|pcs|tablets?|capsules?|gummies|mg|iu)(?:\s*(?:x|×|\(pack\s*of\)?)\s*\d+)?/gi;
              const matches = title.match(chunkRe);
              if (matches && matches.length > 0) {
                // Dedupe and clean
                const cleaned = [];
                const cSeen = new Set();
                matches.forEach(m => {
                  const c = m.trim().replace(/\s+/g, ' ');
                  const k = c.toLowerCase();
                  if (!cSeen.has(k)) { cSeen.add(k); cleaned.push(c); }
                });
                // Also catch "2 Pack" / "x 2" multipack patterns
                const packM = title.match(/(?:\b\d+\s*pack\b|\bx\s*\d+\b|\b\d+\s*×\s*\d+\b)/i);
                if (packM) {
                  const pk = packM[0].trim().replace(/\s+/g, ' ');
                  if (!cSeen.has(pk.toLowerCase())) cleaned.push(pk);
                }
                titleNumeric = cleaned.join(', ');
              }
            }
          }

          // ── STEP 4: Combine — numeric size first, then variant name ──
          if (titleNumeric && realVariant) {
            return titleNumeric + ' - ' + realVariant;
          }
          if (titleNumeric && !realVariant) {
            return titleNumeric;
          }
          return realVariant;
        }
      });

      if (results && results[0] && typeof results[0].result === 'string') {
        label = results[0].result.trim();
      }
    } catch (e) {
      // MAIN world failed — try content script fallback
      try {
        const r = await chrome.tabs.sendMessage(tabId, { type: 'EXTRACT_VARIANTS' });
        if (r && r.selectedLabel) label = r.selectedLabel;
      } catch (e2) { /* silent */ }
    }

    // If we got a label, return it. Otherwise retry (reload).
    if (label) return label;
  }

  // All 3 attempts found nothing → empty
  return '';
}

async function fetchLabelsForGroup(tabId, groupAsins) {
  for (const a of groupAsins) {
    if (a.label) continue; // already has label
    try {
      const label = await fetchLabelForAsin(tabId, a.asin);
      if (label) {
        a.label = label;
        addLog(`     📝 ${a.asin}: "${label}" [V6]`, 'info');
      } else {
        addLog(`     ✗ ${a.asin}: no label found`, 'warn');
      }
    } catch (e) {
      addLog(`     ✗ ${a.asin}: error`, 'error');
    }
  }
}

/* ── Core Processing Loop ──────────────────────────── */

async function processQueue() {
  if (state.status !== 'running') return;

  // Build a Set of all upload ASINs for fast lookup
  const uploadSet = new Set(state.asinList.map(a => a.toUpperCase()));

  while (state.currentIndex < state.asinList.length) {
    // Check if paused/stopped between iterations
    if (state.status !== 'running') {
      await saveState();
      return;
    }

    const asin = state.asinList[state.currentIndex].toUpperCase();

    // ── SKIP CHECK: already in any group (as creator or member) ──
    if (state.skipped[asin]) {
      const gid = state.skipped[asin];
      addLog(`⏭ ${asin} — skipped (already in Group ${gid})`, 'skip');
      state.stats.skipped++;
      state.currentIndex++;
      await saveState();
      continue;
    }
    // Also check if this ASIN is already a group creator
    const existingCreatorGroup = state.groups.find(g => g.asins.some(a => a.asin === asin));
    if (existingCreatorGroup) {
      addLog(`⏭ ${asin} — skipped (already in Group ${existingCreatorGroup.id})`, 'skip');
      state.stats.skipped++;
      state.currentIndex++;
      await saveState();
      continue;
    }

    // ── OPEN AMAZON PAGE ──
    addLog(`🔍 ${asin} — opening Amazon page…`, 'info');
    const url = `https://www.amazon.com/dp/${asin}?th=1`;

    try {
      await navigateTab(url);
      await waitForLoad(state.tabId);
    } catch (e) {
      addLog(`⚠ ${asin} — page load failed: ${e.message}`, 'error');
      state.stats.errors++;
      state.stats.standalone++;
      state.currentIndex++;
      state.stats.processed++;
      await saveState();
      await sleep(state.delay);
      continue;
    }

    // ── EXTRACT VARIANTS FROM PAGE ──
    let result;
    try {
      result = await askContentScript(state.tabId);
    } catch (e) {
      result = { asin, captcha: false, variants: [], error: e.message };
    }

    // ── CAPTCHA → PAUSE ──
    if (result.captcha) {
      addLog(`🛑 CAPTCHA detected! Solve it in the Amazon tab, then click Resume.`, 'error');
      state.status = 'paused';
      await saveState();
      broadcast();
      return;
    }

    // ── ERROR → LOG AND CONTINUE ──
    if (result.error) {
      addLog(`⚠ ${asin} — error: ${result.error}`, 'error');
      state.stats.errors++;
      state.stats.standalone++;
      state.currentIndex++;
      state.stats.processed++;
      await saveState();
      await sleep(state.delay);
      continue;
    }

    // ── PROCESS FOUND VARIANTS ──
    const allVariants = result.variants || [];
    const debugInfo = result.debug || {};

    // Log debug info
    const dbg = debugInfo;
    const src = dbg.source || 'content_script';
    const methods = dbg.methods ? dbg.methods.join(',') : '';
    const scriptKeys = dbg.scripts?.keysFound ? dbg.scripts.keysFound.join(',') : '';
    const domInfo = dbg.dom ? `defaultAsin:${dbg.dom.defaultAsinCount||0}` : '';
    addLog(
      `   ↳ [${src}] methods=[${methods||scriptKeys}] DOM=[${domInfo}] total=${dbg.totalMerged||dbg.variantCount||allVariants.length}`,
      'info'
    );
    // Show DVd content and ASIN context for debugging labels
    const scriptDbg = dbg.scripts || dbg;
    if (scriptDbg.dvdSample) {
      addLog(`   ↳ DVd: ${JSON.stringify(scriptDbg.dvdSample)}`, 'info');
    }
    if (scriptDbg.asinContext) {
      addLog(`   ↳ ASIN in scripts: …${scriptDbg.asinContext}…`, 'info');
    }

    if (allVariants.length <= 1) {
      // No variants at all (standalone product)
      addLog(`📦 ${asin} — no variants found (standalone)`, 'info');
      state.stats.standalone++;
    } else {
      // Build set of ALL ASINs already in any group (creators + members)
      const allGroupedAsins = new Set();
      state.groups.forEach(g => g.asins.forEach(a => allGroupedAsins.add(a.asin)));

      // Variants found! Check which ones are in our upload list
      // RULE: Only include variants that ARE in the upload list
      const matchesInUpload = allVariants.filter(v =>
        v.asin !== asin && uploadSet.has(v.asin)
      );

      if (matchesInUpload.length > 0) {
        // Check if any matched ASIN is already in an existing group → MERGE
        let existingGroup = null;
        for (const v of matchesInUpload) {
          existingGroup = state.groups.find(g => g.asins.some(a => a.asin === v.asin));
          if (existingGroup) break;
        }
        // Also check if current ASIN is already in a group
        if (!existingGroup) {
          existingGroup = state.groups.find(g => g.asins.some(a => a.asin === asin));
        }

        // Excluded count (variants on Amazon but NOT in upload list)
        const excludedCount = allVariants.filter(v =>
          v.asin !== asin && !uploadSet.has(v.asin)
        ).length;

        if (existingGroup) {
          // ── MERGE into existing group ──
          const existingAsinSet = new Set(existingGroup.asins.map(a => a.asin));
          let addedCount = 0;

          // Add current ASIN if not already there
          if (!existingAsinSet.has(asin)) {
            const selfVariant = allVariants.find(v => v.asin === asin);
            existingGroup.asins.push({ asin, label: selfVariant?.label || '' });
            state.skipped[asin] = existingGroup.id;
            addedCount++;
          }

          // Add fresh matched variants (not already in this group)
          matchesInUpload.forEach(v => {
            if (!existingAsinSet.has(v.asin)) {
              existingGroup.asins.push({ asin: v.asin, label: v.label });
              state.skipped[v.asin] = existingGroup.id;
              addedCount++;
            }
          });

          state.stats.grouped += addedCount;

          addLog(
            `🔗 ${asin} → merged into Group ${existingGroup.id} (added ${addedCount} new)` +
            ` → now ${existingGroup.asins.map(a => a.asin).join(', ')}` +
            (excludedCount > 0 ? ` (${excludedCount} not in list)` : ''),
            'success'
          );

          // ── FETCH LABELS for newly added ASINs ──
          const needLabels = existingGroup.asins.filter(a => !a.label);
          if (needLabels.length > 0) {
            addLog(`   📝 Fetching labels for ${needLabels.length} ASINs…`, 'info');
            await fetchLabelsForGroup(state.tabId, needLabels);
          }
        } else {
          // ── CREATE new group ──
          const groupId = state.groups.length + 1;
          const groupAsins = [];

          // Add current ASIN with its label
          const selfVariant = allVariants.find(v => v.asin === asin);
          groupAsins.push({ asin, label: selfVariant ? selfVariant.label : '' });

          // Add matched variants (exclude already-grouped ones)
          matchesInUpload.forEach(v => {
            if (!allGroupedAsins.has(v.asin)) {
              groupAsins.push({ asin: v.asin, label: v.label });
              state.skipped[v.asin] = groupId;
            }
          });

          state.groups.push({ id: groupId, asins: groupAsins });
          state.stats.grouped += groupAsins.length;

          addLog(
            `✅ ${asin} → Group ${groupId}: ${groupAsins.map(a => a.asin).join(', ')}` +
            (excludedCount > 0 ? ` (${excludedCount} not in list)` : ''),
            'success'
          );

          // ── FETCH LABELS: visit each ASIN page and read selected variant ──
          const needLabels = groupAsins.filter(a => !a.label);
          if (needLabels.length > 0) {
            addLog(`   📝 Fetching labels for ${needLabels.length} ASINs…`, 'info');
            await fetchLabelsForGroup(state.tabId, groupAsins);
          }
        }
      } else {
        // Has variants on Amazon but NONE are in our upload list
        addLog(`📦 ${asin} — ${allVariants.length} variants on Amazon, but none in your upload list`, 'info');
        state.stats.standalone++;
      }
    }

    state.currentIndex++;
    state.stats.processed++;
    await saveState();
    broadcast();

    // Delay before next ASIN
    if (state.currentIndex < state.asinList.length && state.status === 'running') {
      await sleep(state.delay);
    }
  }

  // ── ALL DONE ──
  if (state.status === 'running') {
    state.status = 'complete';

    const totalGrouped = state.groups.reduce((s, g) => s + g.asins.length, 0);
    addLog(
      `🎉 Done! ${state.stats.processed} ASINs processed → ` +
      `${state.groups.length} groups (${totalGrouped} ASINs), ` +
      `${state.stats.skipped} skipped, ` +
      `${state.stats.standalone} standalone`,
      'success'
    );
    await saveState();
    await saveToHistory();
    broadcast();

    // AUTO-DOWNLOAD results immediately
    if (state.groups.length > 0) {
      addLog('📥 Downloading files…', 'info');
      await autoDownloadResults();
      addLog('📥 Download complete ✓', 'success');
      broadcast();
    }
  }
}

/* ── Auto Download (runs from background — works even when popup closed) ── */

async function autoDownloadResults() {
  const fMap = state.fileAsinMap || {};
  const fileNames = Object.keys(fMap);

  if (fileNames.length <= 1) {
    // Single file or paste mode
    const fname = fileNames[0] || state.fileName || 'variant_sibling';
    await bgDownloadCSV(state.groups, fname);
  } else {
    // Multiple files — separate download per source file
    for (const fname of fileNames) {
      const sourceAsins = new Set((fMap[fname] || []).map(a => a.toUpperCase()));
      const fileGroups = state.groups.filter(g =>
        g.asins.some(a => sourceAsins.has(a.asin.toUpperCase()))
      );
      if (fileGroups.length > 0) {
        await bgDownloadCSV(fileGroups, fname);
        await sleep(700);
      }
    }
  }
}

function bgDownloadCSV(groups, fileName) {
  return new Promise(resolve => {
    const rows = ['GroupID,ASIN,Label'];
    groups.forEach((g, idx) => {
      g.asins.forEach(a => {
        const label = (a.label || '').replace(/"/g, '""');
        rows.push(`${idx + 1},"${a.asin}","${label}"`);
      });
    });
    const csv = '\uFEFF' + rows.join('\n');
    const dataUrl = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);

    chrome.downloads.download({
      url: dataUrl,
      filename: `${fileName}_variants.csv`,
      saveAs: false
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        console.error('[VS] Download error:', chrome.runtime.lastError.message);
      }
      resolve(downloadId);
    });
  });
}

/* ── Message Handler ───────────────────────────────── */

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.type) {

    case 'GET_STATE':
      sendResponse(getPublicState());
      return true;

    case 'GET_HISTORY':
      chrome.storage.local.get('vsHistory').then(({ vsHistory = [] }) => {
        sendResponse({ history: vsHistory });
      });
      return true;

    case 'START': {
      const asins = msg.asins || [];
      if (!asins.length) { sendResponse({ ok: false, error: 'No ASINs' }); return true; }

      // Fresh run — reset state
      state = { ...DEFAULT_STATE };
      state.asinList = [...new Set(asins.map(a => a.toUpperCase()))];
      state.status = 'running';
      state.runId = `run_${Date.now()}`;
      state.startTime = Date.now();
      state.delay = msg.delay || 3000;
      state.fileName = msg.fileName || '';
      state.fileAsinMap = msg.fileAsinMap || {};

      addLog(`▶ Starting: ${state.asinList.length} ASINs (delay: ${state.delay / 1000}s) [v4-merge]${state.fileName ? ' — ' + state.fileName : ''}`, 'info');
      saveState().then(() => processQueue());
      sendResponse({ ok: true });
      return true;
    }

    case 'PAUSE':
      if (state.status === 'running') {
        state.status = 'paused';
        addLog('⏸ Paused', 'warn');
        saveState();
        broadcast();
      }
      sendResponse({ ok: true });
      return true;

    case 'RESUME':
      if (state.status === 'paused') {
        state.status = 'running';
        addLog('▶ Resumed', 'info');
        saveState().then(() => processQueue());
        broadcast();
      }
      sendResponse({ ok: true });
      return true;

    case 'STOP':
      state.status = 'stopped';
      addLog('⏹ Stopped', 'warn');
      saveState().then(() => saveToHistory());
      broadcast();
      sendResponse({ ok: true });
      return true;

    case 'DOWNLOAD_CSV': {
      const csv = msg.csvData || generateCSV();
      if (!csv || csv.split('\n').length <= 1) {
        sendResponse({ ok: false, error: 'No data' });
        return true;
      }
      const dataUrl = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
      const ts = new Date().toISOString().slice(0, 10);
      chrome.downloads.download({
        url: dataUrl,
        filename: `variant_sibling_${ts}.csv`,
        saveAs: true
      }, (id) => sendResponse({ ok: true, downloadId: id }));
      return true;
    }

    case 'DOWNLOAD_HISTORY_CSV': {
      const csv = msg.csvData;
      if (!csv) { sendResponse({ ok: false }); return true; }
      const dataUrl = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
      chrome.downloads.download({
        url: dataUrl,
        filename: `variant_sibling_${msg.runId || 'export'}.csv`,
        saveAs: true
      });
      sendResponse({ ok: true });
      return true;
    }

    case 'CLEAR_HISTORY':
      chrome.storage.local.set({ vsHistory: [] });
      sendResponse({ ok: true });
      return true;

    case 'GET_CUMULATIVE':
      chrome.storage.local.get('vsCumulativeGroups').then(({ vsCumulativeGroups = [] }) => {
        sendResponse({ groups: vsCumulativeGroups });
      });
      return true;

    case 'CLEAR_CUMULATIVE':
      chrome.storage.local.set({ vsCumulativeGroups: [] });
      sendResponse({ ok: true });
      return true;

    case 'RESET':
      state = { ...DEFAULT_STATE };
      saveState();
      broadcast();
      sendResponse({ ok: true });
      return true;

    case 'SET_DELAY':
      state.delay = msg.delay || 3000;
      saveState();
      sendResponse({ ok: true });
      return true;
  }
});

/* ── Tab Close Detection ───────────────────────────── */

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === state.tabId) {
    state.tabId = null;
    if (state.status === 'running') {
      addLog('⚠ Processing tab closed. Will open new one for next ASIN.', 'warn');
    }
  }
});

/* ── Init ──────────────────────────────────────────── */

loadState();

```

### 6.3 content.js
```javascript
/**
 * content.js — Amazon variant extractor (v3)
 * 
 * Fixes: v2 found 0 variants because:
 *   - Amazon loads variant data DYNAMICALLY after page load
 *   - DOM search was limited to #twister which may not exist yet
 *   - JS data keys might differ across Amazon page versions
 *
 * v3 approach:
 *   1. WAIT for variant elements to appear in DOM (up to 8s)
 *   2. Search ENTIRE document for data-defaultasin, data-asin, etc.
 *   3. Parse ALL inline scripts for ANY ASIN mapping patterns
 *   4. Include debug info so we can see what was found/missed
 */
(function () {
  'use strict';

  /* ── Helpers ──────────────────────────────────────── */

  function getCurrentAsin() {
    const canon = document.querySelector('link[rel="canonical"]');
    if (canon) {
      const m = canon.href.match(/\/dp\/([A-Z0-9]{10})/i);
      if (m) return m[1].toUpperCase();
    }
    const um = location.pathname.match(/\/dp\/([A-Z0-9]{10})/i);
    if (um) return um[1].toUpperCase();
    const inp = document.getElementById('ASIN') || document.querySelector('input[name="ASIN"]');
    if (inp) return inp.value.toUpperCase();
    return '';
  }

  function isCaptcha() {
    return !!(
      document.getElementById('captchacharacters') ||
      document.title.toLowerCase().includes('robot check') ||
      document.querySelector('form[action*="validateCaptcha"]')
    );
  }

  function isErrorPage() {
    const hasdog = document.getElementById('g') && document.querySelector('img[alt*="dog"]');
    const has404 = document.getElementById('404_content');
    const titleErr = document.title.toLowerCase().includes('page not found');
    return !!(hasdog || has404 || titleErr);
  }

  function getProductTitle() {
    const el = document.getElementById('productTitle') || document.getElementById('title');
    return el ? el.textContent.trim() : '';
  }

  function isValidAsin(s) {
    return /^[A-Z0-9]{10}$/.test(s);
  }

  /* ── Wait for variant data to load ──────────────── */

  function waitForVariants(maxWait) {
    return new Promise(resolve => {
      const start = Date.now();
      function check() {
        const found =
          document.querySelector('[data-defaultasin]') ||
          document.getElementById('twister') ||
          document.querySelector('[id^="variation_"]') ||
          document.querySelector('.a-button-toggle[data-defaultasin]');
        
        if (found) { resolve(true); return; }
        if (Date.now() - start > maxWait) { resolve(false); return; }
        setTimeout(check, 400);
      }
      check();
    });
  }

  /* ── Bracket-matching JSON extractor ──────────────── */

  function extractJSONAfterKey(text, key) {
    const idx = text.indexOf(key);
    if (idx === -1) return null;

    let start = -1;
    let openChar = '';
    for (let i = idx + key.length; i < Math.min(idx + key.length + 50, text.length); i++) {
      if (text[i] === '{') { start = i; openChar = '{'; break; }
      if (text[i] === '[') { start = i; openChar = '['; break; }
    }
    if (start === -1) return null;

    const closeChar = openChar === '{' ? '}' : ']';
    let depth = 1;
    let i = start + 1;
    let inString = false;
    let escaped = false;

    while (i < text.length && depth > 0) {
      const ch = text[i];
      if (escaped) { escaped = false; i++; continue; }
      if (ch === '\\') { escaped = true; i++; continue; }
      if (ch === '"') { inString = !inString; i++; continue; }
      if (!inString) {
        if (ch === openChar) depth++;
        else if (ch === closeChar) depth--;
      }
      i++;
    }
    if (depth !== 0) return null;

    try {
      return JSON.parse(text.substring(start, i));
    } catch {
      return null;
    }
  }

  /* ── Strategy 1: Parse ALL inline scripts for variant data ── */

  function extractFromScripts() {
    const variants = {};
    const debug = { scriptCount: 0, keysFound: [] };

    // Collect ALL inline script text
    const scripts = document.querySelectorAll('script:not([src])');
    debug.scriptCount = scripts.length;

    let allText = '';
    scripts.forEach(s => { allText += s.textContent + '\n'; });

    // DEBUG: capture what DVd contains and what's near the ASIN
    const curAsin = getCurrentAsin();

    // 1A. asinVariationValues + dimensionValuesDisplayData
    // Try both quoted and unquoted key names (Amazon uses both)
    const avv = extractJSONAfterKey(allText, '"asinVariationValues"')
      || extractJSONAfterKey(allText, 'asinVariationValues')
      || extractJSONAfterKey(allText, "'asinVariationValues'");
    const dvd = extractJSONAfterKey(allText, '"dimensionValuesDisplayData"')
      || extractJSONAfterKey(allText, 'dimensionValuesDisplayData')
      || extractJSONAfterKey(allText, "'dimensionValuesDisplayData'");

    if (avv) debug.keysFound.push('asinVariationValues');
    if (dvd) debug.keysFound.push('dimensionValuesDisplayData');

    // DEBUG: show what DVd contains (dimension names + first 3 values each)
    if (dvd) {
      debug.dvdSample = {};
      for (const [k, v] of Object.entries(dvd)) {
        debug.dvdSample[k] = Array.isArray(v) ? v.slice(0, 4).join(' | ') : String(v).substring(0, 80);
      }
    }
    // DEBUG: show what's around the current ASIN in script text (reveals the mapping format)
    if (curAsin && allText.includes(curAsin)) {
      const idx = allText.indexOf(curAsin);
      debug.asinContext = allText.substring(Math.max(0, idx - 20), Math.min(allText.length, idx + 40)).replace(/\s+/g, ' ');
    }

    if (avv && dvd) {
      const dimNames = Object.keys(dvd);
      for (const [asin, indices] of Object.entries(avv)) {
        if (!isValidAsin(asin)) continue;
        const key = asin.toUpperCase();
        const labels = {};
        if (Array.isArray(indices)) {
          indices.forEach((idx, dimIdx) => {
            const dimName = dimNames[dimIdx];
            if (dimName && dvd[dimName]) {
              labels[dimName] = dvd[dimName][parseInt(idx)] || '';
            }
          });
        }
        variants[key] = { asin: key, labels };
      }
    }

    // 1A-2. DVd keyed directly by ASIN with STRING values
    //       Format: {"B0GP6Z542W":"OAT CINNAMON","B0GP6KW533":"GUAVA CRUSH"}
    //       Amazon sometimes puts final labels directly here keyed by ASIN.
    if (dvd && Object.keys(variants).length === 0) {
      const dvdKeys = Object.keys(dvd);
      // Check if keys look like ASINs and values are strings
      const asinKeyedCount = dvdKeys.filter(k => isValidAsin(k) && typeof dvd[k] === 'string').length;
      if (asinKeyedCount >= 2) {
        debug.keysFound.push('dvd_asin_keyed');
        for (const [asin, labelStr] of Object.entries(dvd)) {
          if (!isValidAsin(asin)) continue;
          if (typeof labelStr !== 'string' || !labelStr.trim()) continue;
          const key = asin.toUpperCase();
          variants[key] = { asin: key, labels: { 'Variant': labelStr.trim() } };
        }
      }
    }

    // 1B. defined_asin_variations (older format)
    const dav = extractJSONAfterKey(allText, 'defined_asin_variations');
    if (dav) {
      debug.keysFound.push('defined_asin_variations');
      for (const [asin, dims] of Object.entries(dav)) {
        if (!isValidAsin(asin)) continue;
        const key = asin.toUpperCase();
        if (!variants[key]) variants[key] = { asin: key, labels: {} };
        if (dims && typeof dims === 'object') {
          for (const [dim, val] of Object.entries(dims)) {
            if (typeof val === 'string') variants[key].labels[dim] = val;
          }
        }
      }
    }

    // 1C. asinToDimensionIndexMap (alternative key name)
    const atdim = extractJSONAfterKey(allText, '"asinToDimensionIndexMap"')
      || extractJSONAfterKey(allText, 'asinToDimensionIndexMap');
    if (atdim) {
      debug.keysFound.push('asinToDimensionIndexMap');
      if (dvd) {
        const dimNames = Object.keys(dvd);
        for (const [asin, indices] of Object.entries(atdim)) {
          if (!isValidAsin(asin)) continue;
          const key = asin.toUpperCase();
          if (!variants[key]) variants[key] = { asin: key, labels: {} };
          if (Array.isArray(indices)) {
            indices.forEach((idx, dimIdx) => {
              const dimName = dimNames[dimIdx];
              if (dimName && dvd[dimName]) {
                variants[key].labels[dimName] = dvd[dimName][parseInt(idx)] || '';
              }
            });
          }
        }
      }
    }

    // 1D. Generic ASIN→index scan: when DVd found but no ASIN mapping key matched
    //     Searches for ANY pattern like "B0XXXXXXXX":["0","1"] or "B0XXXXXXXX":[0,1]
    //     and maps indices to DVd labels
    if (dvd && Object.keys(variants).length === 0) {
      debug.keysFound.push('generic_asin_index_scan');
      const dimNames = Object.keys(dvd);
      const dimCount = dimNames.length;
      // Find all ASIN: [...] patterns
      const asinArrRe = /["']?(B0[A-Z0-9]{8})["']?\s*:\s*\[/g;
      let match;
      while ((match = asinArrRe.exec(allText)) !== null) {
        const asin = match[1].toUpperCase();
        // Extract the array using bracket matching
        const arrStart = allText.indexOf('[', match.index + match[0].length - 1);
        if (arrStart === -1) continue;
        let depth = 1, j = arrStart + 1;
        while (j < allText.length && depth > 0) {
          if (allText[j] === '[') depth++;
          else if (allText[j] === ']') depth--;
          j++;
        }
        if (depth !== 0) continue;
        try {
          const arr = JSON.parse(allText.substring(arrStart, j));
          if (!Array.isArray(arr)) continue;
          // Must match dimension count exactly
          if (arr.length !== dimCount) continue;
          const indices = arr.map(x => parseInt(String(x)));
          if (indices.some(isNaN)) continue;
          // Validate: each index must be within dimension bounds
          let valid = true;
          for (let d = 0; d < dimCount; d++) {
            if (indices[d] < 0 || indices[d] >= (dvd[dimNames[d]]?.length || 0)) {
              valid = false; break;
            }
          }
          if (!valid) continue;
          // Build labels
          const labels = {};
          indices.forEach((idx, dimIdx) => {
            const dimName = dimNames[dimIdx];
            labels[dimName] = dvd[dimName][idx];
          });
          variants[asin] = { asin, labels };
        } catch { continue; }
      }
    }

    // 1E. Brute-force: find ASIN-like patterns near variation keywords (no labels, last resort)
    if (Object.keys(variants).length === 0) {
      // Look for patterns like "B0XXXXXXXX" in variation-related contexts
      const variationChunk = allText.match(/variation[^]*?(?=function\s|var\s|const\s|let\s|\n\n)/gi);
      if (variationChunk) {
        debug.keysFound.push('brute_force_variation');
        variationChunk.forEach(chunk => {
          const asinMatches = chunk.match(/\b(B0[A-Z0-9]{8})\b/g);
          if (asinMatches) {
            asinMatches.forEach(a => {
              const key = a.toUpperCase();
              if (!variants[key]) variants[key] = { asin: key, labels: {} };
            });
          }
        });
      }
    }

    return { variants, debug };
  }

  /* ── Strategy 2: DOM extraction (search ENTIRE document) ── */

  function extractFromDOM() {
    const variants = {};
    const debug = { defaultAsinCount: 0, dataAsinCount: 0, dpUrlCount: 0, dropdownCount: 0 };

    // 2A. ALL elements with data-defaultasin ANYWHERE on the page
    const defaultAsinEls = document.querySelectorAll('[data-defaultasin]');
    debug.defaultAsinCount = defaultAsinEls.length;

    defaultAsinEls.forEach(el => {
      const asin = (el.getAttribute('data-defaultasin') || '').trim().toUpperCase();
      if (!isValidAsin(asin)) return;

      // Find dimension name
      let dimName = '';
      const section = el.closest('[id^="variation_"]');
      if (section) {
        const m = section.id.match(/variation_(.+?)(?:_name)?$/);
        if (m) dimName = m[1].replace(/_/g, ' ');
      }
      if (!dimName) {
        const labelEl = el.closest('.a-section, .a-row')
          ?.querySelector('.a-form-label, .a-color-secondary, [class*="label"]');
        if (labelEl) dimName = labelEl.textContent.replace(/[:\s]+$/g, '').trim();
      }

      // Get label text
      let label = '';
      const btnText = el.querySelector('.a-button-text, .a-size-base, .twisterTextDiv');
      if (btnText) label = btnText.textContent.trim();
      if (!label) label = (el.getAttribute('title') || '').replace(/^Click to select\s*/i, '').trim();
      if (!label) {
        const img = el.querySelector('img');
        if (img) label = (img.alt || '').trim();
      }
      if (!label) label = (el.getAttribute('aria-label') || '').trim();
      // Clean label: remove price info that sometimes appears
      label = label.replace(/\$[\d,.]+.*$/m, '').trim();

      if (!variants[asin]) variants[asin] = { asin, labels: {} };
      if (dimName && label) variants[asin].labels[dimName] = label;
      else if (label) variants[asin].labels['Variant'] = label;
    });

    // 2B. Elements with data-asin (sometimes used instead of data-defaultasin)
    const dataAsinEls = document.querySelectorAll('#twister [data-asin], [id^="variation_"] [data-asin]');
    debug.dataAsinCount = dataAsinEls.length;

    dataAsinEls.forEach(el => {
      const asin = (el.getAttribute('data-asin') || '').trim().toUpperCase();
      if (!isValidAsin(asin)) return;
      if (!variants[asin]) {
        let label = el.textContent.trim().substring(0, 100);
        variants[asin] = { asin, labels: { 'Variant': label } };
      }
    });

    // 2C. data-dp-url links containing /dp/ASIN
    const dpUrlEls = document.querySelectorAll('[data-dp-url]');
    debug.dpUrlCount = dpUrlEls.length;

    dpUrlEls.forEach(el => {
      const url = el.getAttribute('data-dp-url') || '';
      const m = url.match(/\/dp\/([A-Z0-9]{10})/i);
      if (!m) return;
      const asin = m[1].toUpperCase();
      if (!variants[asin]) {
        let label = (el.getAttribute('title') || '').replace(/^Click to select\s*/i, '').trim();
        if (!label) {
          const txt = el.querySelector('.a-button-text, .a-size-base');
          if (txt) label = txt.textContent.trim();
        }
        variants[asin] = { asin, labels: label ? { 'Variant': label } : {} };
      }
    });

    // 2D. Dropdown selects with ASIN values
    const selects = document.querySelectorAll('select');
    selects.forEach(sel => {
      // Only process selects that look variant-related
      const id = sel.id || '';
      const isVariant = id.includes('dropdown') || id.includes('variation') || id.includes('twister')
        || sel.closest('#twister, [id^="variation_"]');
      if (!isVariant) return;

      let dimName = '';
      const m = id.match(/native_dropdown_selected_(.+)/);
      if (m) dimName = m[1].replace(/_/g, ' ').trim();

      sel.querySelectorAll('option').forEach(opt => {
        const val = opt.value || '';
        let asin = '';
        if (val.includes(',')) {
          const candidate = val.split(',')[1]?.trim().toUpperCase();
          if (isValidAsin(candidate)) asin = candidate;
        } else if (isValidAsin(val.trim().toUpperCase())) {
          asin = val.trim().toUpperCase();
        }
        if (!asin) return;
        debug.dropdownCount++;

        const label = opt.textContent.trim();
        if (!variants[asin]) variants[asin] = { asin, labels: {} };
        if (dimName && label) variants[asin].labels[dimName] = label;
        else if (label) variants[asin].labels['Variant'] = label;
      });
    });

    // 2E. Links that go to /dp/ASIN inside variant areas
    const variantLinks = document.querySelectorAll(
      '#twister a[href*="/dp/"], [id^="variation_"] a[href*="/dp/"], .twisterSwatchWrapper a[href*="/dp/"]'
    );
    variantLinks.forEach(a => {
      const m = a.href.match(/\/dp\/([A-Z0-9]{10})/i);
      if (!m) return;
      const asin = m[1].toUpperCase();
      if (!variants[asin]) {
        const label = a.textContent.trim() || (a.querySelector('img')?.alt || '').trim();
        variants[asin] = { asin, labels: label ? { 'Variant': label } : {} };
      }
    });

    return { variants, debug };
  }

  /* ── Build Label ─────────────────────────────────── */

  function buildLabel(labels) {
    const entries = Object.entries(labels).filter(([k, v]) => v && v.trim() && v !== '-');
    if (entries.length === 0) return '';
    if (entries.length === 1) return entries[0][1].trim();
    return entries.map(([, v]) => v.trim()).join(' - ');
  }

  /* ── Main ────────────────────────────────────────── */

  async function extractVariants() {
    const asin = getCurrentAsin();

    if (isCaptcha()) {
      return { asin, captcha: true, variants: [], title: '', error: null, debug: {} };
    }
    if (isErrorPage()) {
      return { asin, captcha: false, variants: [], title: '', error: 'Page not found', debug: {} };
    }

    // Wait for variant elements to appear (Amazon loads them dynamically)
    const found = await waitForVariants(6000);

    // Run extraction strategies
    const scriptResult = extractFromScripts();
    const domResult = extractFromDOM();

    // Merge: DOM first, scripts overlay (higher priority)
    const merged = {};
    for (const source of [domResult.variants, scriptResult.variants]) {
      for (const [key, data] of Object.entries(source)) {
        if (!merged[key]) merged[key] = { asin: key, labels: {} };
        Object.assign(merged[key].labels, data.labels);
      }
    }

    // Build final array
    const variants = [];
    for (const [key, data] of Object.entries(merged)) {
      variants.push({
        asin: key,
        label: buildLabel(data.labels),
        isCurrent: key === asin
      });
    }

    const title = getProductTitle();

    return {
      asin,
      captcha: false,
      variants,
      title,
      error: null,
      debug: {
        waitFound: found,
        scripts: scriptResult.debug,
        dom: domResult.debug,
        totalMerged: variants.length
      }
    };
  }

  /* ── Message Handler ────────────────────────────── */

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'EXTRACT_VARIANTS') {
      extractVariants()
        .then(result => sendResponse(result))
        .catch(e => {
          sendResponse({
            asin: getCurrentAsin(),
            captcha: false,
            variants: [],
            title: '',
            error: 'Extraction error: ' + e.message,
            debug: { exception: e.message }
          });
        });
      return true; // async
    }

    if (msg.type === 'PING') {
      sendResponse({ ok: true, url: location.href });
      return true;
    }
  });

})();

```

### 6.4 popup.html
```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Variant & Sibling</title>
  <link rel="stylesheet" href="popup.css">
</head>
<body>
  <div class="app">

    <!-- Header -->
    <div class="header">
      <div class="logo">
        <span class="logo-icon">VS</span>
        <div>
          <h1>Variant & Sibling</h1>
          <p class="sub">Amazon variant grouper for Dropy</p>
        </div>
      </div>
      <div class="header-actions">
        <button class="icon-btn" id="historyBtn" title="History">📂</button>
        <button class="icon-btn" id="resetBtn" title="Reset">🔄</button>
      </div>
    </div>

    <!-- Upload Section -->
    <div class="section" id="uploadSection">
      <div class="section-label">Load ASINs</div>

      <div class="upload-zone" id="dropZone">
        <div class="upload-icon">📁</div>
        <div class="upload-text">Drop file here or click to browse</div>
        <div class="upload-hint">TXT · CSV · XLSX</div>
        <input type="file" id="fileInput" accept=".txt,.csv,.xlsx,.xls" hidden multiple>
      </div>

      <div class="divider"><span>or paste</span></div>

      <textarea id="pasteArea" class="paste-area" placeholder="Paste ASINs here — one per line or comma-separated&#10;&#10;B07YPX9N6X&#10;B0719WNNK4&#10;B0GCLGMVTN"></textarea>

      <div class="asin-status" id="asinStatus" style="display:none">
        <span class="asin-count" id="asinCount">0</span>
        <span>ASINs loaded</span>
        <button class="clear-btn" id="clearAsinsBtn">✕ Clear</button>
      </div>
    </div>

    <!-- Settings -->
    <div class="section" id="settingsSection" style="display:none">
      <div class="settings-row">
        <label>Delay between ASINs</label>
        <div class="delay-control">
          <button class="delay-btn" onclick="adjustDelay(-500)">−</button>
          <span id="delayVal">3.0s</span>
          <button class="delay-btn" onclick="adjustDelay(500)">+</button>
        </div>
      </div>
    </div>

    <!-- Controls -->
    <div class="controls" id="controlsSection">
      <button class="btn btn-start" id="startBtn" disabled>
        <span class="btn-icon">▶</span> Start
      </button>
      <button class="btn btn-pause" id="pauseBtn" style="display:none">
        <span class="btn-icon">⏸</span> Pause
      </button>
      <button class="btn btn-resume" id="resumeBtn" style="display:none">
        <span class="btn-icon">▶</span> Resume
      </button>
      <button class="btn btn-stop" id="stopBtn" style="display:none">
        <span class="btn-icon">⏹</span> Stop
      </button>
    </div>

    <!-- Progress -->
    <div class="section" id="progressSection" style="display:none">
      <div class="progress-header">
        <span id="progressText">0 / 0</span>
        <span id="etaText" class="eta"></span>
      </div>
      <div class="progress-track">
        <div class="progress-fill" id="progressFill" style="width:0%"></div>
      </div>
      <div class="stats-grid">
        <div class="stat-item">
          <span class="stat-val" id="statGroups">0</span>
          <span class="stat-label">Groups</span>
        </div>
        <div class="stat-item">
          <span class="stat-val stat-skip" id="statSkipped">0</span>
          <span class="stat-label">Skipped</span>
        </div>
        <div class="stat-item">
          <span class="stat-val stat-solo" id="statSolo">0</span>
          <span class="stat-label">Solo</span>
        </div>
        <div class="stat-item">
          <span class="stat-val stat-err" id="statErrors">0</span>
          <span class="stat-label">Errors</span>
        </div>
      </div>
    </div>

    <!-- Live Log -->
    <div class="section" id="logSection" style="display:none">
      <div class="section-label">
        Live Log
        <button class="clear-log-btn" id="clearLogBtn">Clear</button>
      </div>
      <div class="log-container" id="logContainer"></div>
    </div>

    <!-- Output -->
    <div class="section" id="outputSection" style="display:none">
      <div class="section-label">Output</div>
      <div class="output-summary" id="outputSummary"></div>
      <div id="fileSummaryList"></div>
      <div class="output-actions">
        <button class="btn btn-copy" id="copyBtn">
          📋 Copy CSV
        </button>
      </div>
      <div class="csv-preview" id="csvPreview"></div>
    </div>

    <!-- History Panel (hidden by default) -->
    <div class="section" id="historySection" style="display:none">
      <div class="section-label">
        Run History
        <button class="clear-log-btn" id="clearHistoryBtn">Clear All</button>
      </div>
      <div id="historyList" class="history-list"></div>
    </div>

    <!-- Resume Banner -->
    <div class="resume-banner" id="resumeBanner" style="display:none">
      <div class="resume-text">
        <strong>⚠ Incomplete run found</strong>
        <span id="resumeInfo"></span>
      </div>
      <div class="resume-actions">
        <button class="btn btn-resume" id="resumeBannerBtn">▶ Resume</button>
        <button class="btn btn-stop" id="discardBtn" style="font-size:11px;padding:6px 10px">Discard</button>
      </div>
    </div>

  </div>

  <script src="libs/xlsx.mini.min.js"></script>
  <script src="popup.js"></script>
</body>
</html>

```

### 6.5 popup.css
```css
/* ── Variant & Sibling — Popup Styles ───────────── */

:root {
  --bg: #faf7f2;
  --surface: #fff;
  --surface-2: #f4f0e8;
  --surface-3: #ebe6db;
  --border: #ece6da;
  --border-strong: #ddd5c4;
  --text: #2a2620;
  --text-2: #5a544a;
  --text-muted: #8a8478;
  --text-subtle: #b3ad9f;
  --accent: #d97757;
  --accent-soft: #fbeee4;
  --accent-strong: #b45a3a;
  --sage: #7a9d6f;
  --sage-soft: #eaf1e3;
  --sage-strong: #5f8255;
  --danger: #c47373;
  --danger-soft: #f7e7e3;
  --warn: #c9a249;
  --warn-soft: #f6ecd0;
  --info: #6f8aa9;
  --info-soft: #e8edf3;
  --r: 12px;
  --rs: 8px;
  --shadow: 0 1px 3px rgba(60, 46, 28, .06);
  --shadow-lg: 0 4px 16px rgba(60, 46, 28, .1);
}

* { margin: 0; padding: 0; box-sizing: border-box; }

body {
  width: 420px;
  min-height: 300px;
  max-height: 600px;
  overflow-y: auto;
  background: var(--bg);
  color: var(--text);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif;
  font-size: 13px;
  line-height: 1.45;
  -webkit-font-smoothing: antialiased;
}

::-webkit-scrollbar { width: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: #dad3c4; border-radius: 6px; }

.app { padding: 16px; display: flex; flex-direction: column; gap: 12px; }

/* ── Header ──────────────────────────────────────── */

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 4px;
}

.logo { display: flex; align-items: center; gap: 10px; }

.logo-icon {
  width: 34px; height: 34px;
  border-radius: 9px;
  background: linear-gradient(135deg, var(--accent), #e89568);
  color: #fff;
  font-size: 13px;
  font-weight: 800;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 1px 3px rgba(217, 119, 87, .3);
}

.logo h1 {
  font-size: 16px;
  font-weight: 800;
  letter-spacing: -.02em;
  color: var(--text);
}

.logo .sub {
  font-size: 10.5px;
  color: var(--text-muted);
  font-weight: 500;
  margin-top: 1px;
}

.header-actions { display: flex; gap: 4px; }

.icon-btn {
  width: 32px; height: 32px;
  border: 1px solid var(--border);
  border-radius: var(--rs);
  background: var(--surface);
  cursor: pointer;
  font-size: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all .12s;
}
.icon-btn:hover { border-color: var(--accent); background: var(--accent-soft); }

/* ── Sections ────────────────────────────────────── */

.section {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r);
  padding: 14px;
  box-shadow: var(--shadow);
}

.section-label {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: .08em;
  color: var(--text-muted);
  margin-bottom: 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

/* ── Upload Zone ─────────────────────────────────── */

.upload-zone {
  border: 2px dashed var(--border-strong);
  border-radius: var(--r);
  padding: 20px;
  text-align: center;
  cursor: pointer;
  transition: all .15s;
  background: var(--surface-2);
}
.upload-zone:hover, .upload-zone.dragover {
  border-color: var(--accent);
  background: var(--accent-soft);
}

.upload-icon { font-size: 28px; margin-bottom: 6px; }
.upload-text { font-size: 12px; font-weight: 600; color: var(--text-2); }
.upload-hint { font-size: 10.5px; color: var(--text-subtle); margin-top: 4px; }

.divider {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 12px 0;
  color: var(--text-subtle);
  font-size: 10.5px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: .06em;
}
.divider::before, .divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--border);
}

.paste-area {
  width: 100%;
  min-height: 80px;
  max-height: 140px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--rs);
  background: var(--surface);
  color: var(--text);
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
  font-size: 12px;
  line-height: 1.5;
  resize: vertical;
  transition: border-color .15s;
}
.paste-area:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px rgba(217, 119, 87, .12); }
.paste-area::placeholder { color: var(--text-subtle); font-family: inherit; }

.asin-status {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  background: var(--sage-soft);
  border-radius: var(--rs);
  margin-top: 10px;
  font-size: 12px;
  font-weight: 600;
  color: var(--sage-strong);
}

.asin-count {
  font-family: 'SFMono-Regular', Consolas, monospace;
  font-size: 16px;
  font-weight: 800;
}

.clear-btn {
  margin-left: auto;
  background: none;
  border: none;
  color: var(--text-subtle);
  font-size: 11px;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 4px;
  transition: all .12s;
}
.clear-btn:hover { color: var(--danger); background: var(--danger-soft); }

/* ── Settings ────────────────────────────────────── */

.settings-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-2);
}

.delay-control {
  display: flex;
  align-items: center;
  gap: 8px;
}

.delay-btn {
  width: 26px; height: 26px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface-2);
  color: var(--text-2);
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all .12s;
}
.delay-btn:hover { border-color: var(--accent); color: var(--accent); }

#delayVal {
  font-family: 'SFMono-Regular', Consolas, monospace;
  font-size: 13px;
  font-weight: 700;
  color: var(--text);
  min-width: 36px;
  text-align: center;
}

/* ── Controls ────────────────────────────────────── */

.controls {
  display: flex;
  gap: 8px;
}

.btn {
  flex: 1;
  padding: 10px 14px;
  border: 1px solid var(--border);
  border-radius: var(--rs);
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  font-family: inherit;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  transition: all .12s;
}

.btn:disabled { opacity: .45; cursor: not-allowed; }
.btn-icon { font-size: 11px; }

.btn-start {
  background: linear-gradient(135deg, var(--accent), var(--accent-strong));
  color: #fff;
  border-color: var(--accent);
}
.btn-start:hover:not(:disabled) { opacity: .9; }

.btn-pause {
  background: var(--warn-soft);
  color: var(--warn);
  border-color: #e0c8a0;
}
.btn-pause:hover { background: #f0e4c0; }

.btn-resume {
  background: var(--sage-soft);
  color: var(--sage-strong);
  border-color: #b0c8a0;
}
.btn-resume:hover { background: #dde8d4; }

.btn-stop {
  background: var(--danger-soft);
  color: var(--danger);
  border-color: #e0c8c8;
}
.btn-stop:hover { background: #f0d8d8; }

.btn-download {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
}
.btn-download:hover { opacity: .9; }

.btn-copy {
  background: var(--surface-2);
  color: var(--text-2);
  border-color: var(--border);
}
.btn-copy:hover { background: var(--surface-3); }

/* ── Progress ────────────────────────────────────── */

.progress-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
  font-size: 12px;
  font-weight: 600;
}

#progressText {
  font-family: 'SFMono-Regular', Consolas, monospace;
  font-weight: 700;
  color: var(--accent);
}

.eta { color: var(--text-muted); font-weight: 500; }

.progress-track {
  height: 8px;
  background: var(--surface-2);
  border-radius: 10px;
  overflow: hidden;
  box-shadow: inset 0 1px 2px rgba(60, 46, 28, .08);
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--accent), #e89568);
  border-radius: 10px;
  transition: width .3s ease;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  margin-top: 10px;
}

.stat-item {
  text-align: center;
  padding: 6px 4px;
  background: var(--surface-2);
  border-radius: 6px;
}

.stat-val {
  display: block;
  font-family: 'SFMono-Regular', Consolas, monospace;
  font-size: 18px;
  font-weight: 800;
  color: var(--sage-strong);
}

.stat-skip { color: var(--info); }
.stat-solo { color: var(--text-muted); }
.stat-err { color: var(--danger); }

.stat-label {
  display: block;
  font-size: 9.5px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: .04em;
  color: var(--text-subtle);
  margin-top: 2px;
}

/* ── Log ─────────────────────────────────────────── */

.log-container {
  max-height: 180px;
  overflow-y: auto;
  font-family: 'SFMono-Regular', Consolas, monospace;
  font-size: 11px;
  line-height: 1.7;
  padding: 8px 10px;
  background: var(--surface-2);
  border-radius: var(--rs);
  border: 1px solid var(--border);
}

.log-entry { padding: 1px 0; word-break: break-all; }
.log-info { color: var(--text-2); }
.log-success { color: var(--sage-strong); }
.log-warn { color: var(--warn); }
.log-error { color: var(--danger); }
.log-skip { color: var(--info); }

.clear-log-btn {
  background: none;
  border: none;
  font-size: 10px;
  color: var(--text-subtle);
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 4px;
  font-family: inherit;
  font-weight: 600;
}
.clear-log-btn:hover { color: var(--danger); }

/* ── Output ──────────────────────────────────────── */

.output-summary {
  padding: 10px 12px;
  background: var(--sage-soft);
  border-radius: var(--rs);
  font-size: 12px;
  font-weight: 600;
  color: var(--sage-strong);
  margin-bottom: 10px;
  line-height: 1.6;
}

/* ── File Summary Cards ──────────────────────────── */

#fileSummaryList {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 10px;
}

.file-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--rs);
  font-size: 11.5px;
}

.file-card .fc-icon { font-size: 14px; flex-shrink: 0; }

.file-card .fc-info { flex: 1; min-width: 0; }

.file-card .fc-name {
  font-weight: 700;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.file-card .fc-stats {
  font-size: 10.5px;
  color: var(--text-muted);
  font-weight: 500;
  margin-top: 1px;
}

.file-card .fc-status {
  font-size: 10px;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 4px;
  white-space: nowrap;
  flex-shrink: 0;
}

.file-card .fc-status.ok {
  background: var(--sage-soft);
  color: var(--sage-strong);
}

.file-card .fc-status.empty {
  background: var(--surface-3);
  color: var(--text-muted);
}

.output-actions {
  display: flex;
  gap: 8px;
  margin-bottom: 10px;
}

.csv-preview {
  max-height: 140px;
  overflow-y: auto;
  font-family: 'SFMono-Regular', Consolas, monospace;
  font-size: 10.5px;
  line-height: 1.6;
  padding: 8px 10px;
  background: var(--surface-2);
  border-radius: var(--rs);
  border: 1px solid var(--border);
  color: var(--text-2);
  white-space: pre;
  display: none;
}

/* ── History ──────────────────────────────────────── */

.history-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.history-item {
  padding: 10px 12px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--rs);
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 11.5px;
}

.history-item .h-info { flex: 1; }
.history-item .h-date { font-size: 10px; color: var(--text-subtle); font-weight: 500; }

.history-item .h-stats {
  font-weight: 600;
  color: var(--text-2);
  margin-top: 2px;
}

.history-item .h-dl {
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: 6px;
  padding: 5px 10px;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  font-family: inherit;
  transition: opacity .12s;
}
.history-item .h-dl:hover { opacity: .85; }

.history-empty {
  text-align: center;
  padding: 20px;
  color: var(--text-subtle);
  font-size: 12px;
}

/* ── Resume Banner ───────────────────────────────── */

.resume-banner {
  background: var(--warn-soft);
  border: 1px solid #e0c890;
  border-radius: var(--r);
  padding: 12px 14px;
  box-shadow: var(--shadow);
}

.resume-text {
  font-size: 12px;
  color: var(--warn);
  margin-bottom: 8px;
  line-height: 1.5;
}
.resume-text strong { display: block; font-size: 13px; margin-bottom: 2px; }
.resume-text span { font-size: 11px; color: var(--text-muted); }

.resume-actions { display: flex; gap: 8px; }

```

### 6.6 popup.js
```javascript
/**
 * popup.js — Variant & Sibling UI controller
 * Handles file parsing, state display, controls, and history.
 */
'use strict';

/* ── Globals ───────────────────────────────────────── */

let parsedAsins = [];
let currentDelay = 3000;
let pollTimer = null;
let lastLogCount = 0;
let showingHistory = false;
let uploadedFileName = '';
let fileAsinMap = {};  // { "filename": ["ASIN1","ASIN2",...] } for per-file downloads
let autoDownloaded = false;  // Prevent double auto-download

/* ── DOM Refs ──────────────────────────────────────── */

const $ = id => document.getElementById(id);

const els = {
  dropZone: $('dropZone'), fileInput: $('fileInput'),
  pasteArea: $('pasteArea'), asinStatus: $('asinStatus'),
  asinCount: $('asinCount'), clearAsinsBtn: $('clearAsinsBtn'),
  startBtn: $('startBtn'), pauseBtn: $('pauseBtn'),
  resumeBtn: $('resumeBtn'), stopBtn: $('stopBtn'),
  progressSection: $('progressSection'), progressText: $('progressText'),
  etaText: $('etaText'), progressFill: $('progressFill'),
  statGroups: $('statGroups'), statSkipped: $('statSkipped'),
  statSolo: $('statSolo'), statErrors: $('statErrors'),
  logSection: $('logSection'), logContainer: $('logContainer'),
  clearLogBtn: $('clearLogBtn'),
  outputSection: $('outputSection'), outputSummary: $('outputSummary'),
  copyBtn: $('copyBtn'),
  fileSummaryList: $('fileSummaryList'),
  csvPreview: $('csvPreview'),
  historyBtn: $('historyBtn'), historySection: $('historySection'),
  historyList: $('historyList'), clearHistoryBtn: $('clearHistoryBtn'),
  resetBtn: $('resetBtn'),
  uploadSection: $('uploadSection'), settingsSection: $('settingsSection'),
  controlsSection: $('controlsSection'), delayVal: $('delayVal'),
  resumeBanner: $('resumeBanner'), resumeBannerBtn: $('resumeBannerBtn'),
  discardBtn: $('discardBtn'), resumeInfo: $('resumeInfo')
};

/* ── ASIN Parsing ──────────────────────────────────── */

function parseAsinsFromText(text) {
  // Extract anything that looks like a 10-char ASIN (starts with B0 usually)
  const raw = text.split(/[\s,;\n\r\t]+/).map(s => s.trim().toUpperCase()).filter(s => s.length >= 10);
  const asins = [];
  for (const s of raw) {
    // Extract ASIN from potential URL: amazon.com/dp/B0XXXXXXXX
    const urlMatch = s.match(/\/dp\/([A-Z0-9]{10})/i);
    if (urlMatch) { asins.push(urlMatch[1].toUpperCase()); continue; }
    // Direct 10-char alphanumeric
    const directMatch = s.match(/^([A-Z0-9]{10})$/);
    if (directMatch) { asins.push(directMatch[1]); continue; }
    // Partial match (ASIN embedded in longer string)
    const partialMatch = s.match(/\b([A-Z0-9]{10})\b/);
    if (partialMatch) { asins.push(partialMatch[1]); }
  }
  return [...new Set(asins)];
}

function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 1) return [];
  // Try to find ASIN column
  const header = lines[0].split(',').map(h => h.replace(/"/g, '').trim().toLowerCase());
  const asinIdx = header.findIndex(h => h === 'asin' || h === 'asins' || h === 'asin/isbn');
  const asins = [];
  const startRow = asinIdx >= 0 ? 1 : 0;
  const col = Math.max(asinIdx, 0);
  for (let i = startRow; i < lines.length; i++) {
    const cells = lines[i].split(',').map(c => c.replace(/"/g, '').trim());
    if (cells[col]) {
      const m = cells[col].match(/[A-Z0-9]{10}/i);
      if (m) asins.push(m[0].toUpperCase());
    }
  }
  return [...new Set(asins)];
}

function parseXLSX(data) {
  try {
    const wb = XLSX.read(data, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false });
    if (!rows.length) return [];
    // Find ASIN column
    const header = (rows[0] || []).map(h => String(h || '').trim().toLowerCase());
    const asinIdx = header.findIndex(h => h === 'asin' || h === 'asins' || h === 'asin/isbn');
    const asins = [];
    const startRow = asinIdx >= 0 ? 1 : 0;
    const col = Math.max(asinIdx, 0);
    for (let i = startRow; i < rows.length; i++) {
      const val = String(rows[i]?.[col] || '').trim();
      const m = val.match(/[A-Z0-9]{10}/i);
      if (m) asins.push(m[0].toUpperCase());
    }
    return [...new Set(asins)];
  } catch (e) {
    console.error('XLSX parse error:', e);
    return [];
  }
}

function loadAsins(asins) {
  parsedAsins = asins;
  if (asins.length > 0) {
    els.asinStatus.style.display = 'flex';
    els.asinCount.textContent = asins.length;
    els.startBtn.disabled = false;
    els.settingsSection.style.display = '';
  } else {
    els.asinStatus.style.display = 'none';
    els.startBtn.disabled = true;
    els.settingsSection.style.display = 'none';
  }
}

/* ── File Handling ──────────────────────────────────── */

function handleFile(file) {
  fileAsinMap = {};
  handleFiles([file]);
}

function handleFiles(files) {
  if (!files || files.length === 0) return;
  fileAsinMap = {};
  const names = [];
  let pending = files.length;
  let allAsins = [];

  Array.from(files).forEach(file => {
    const fname = file.name.replace(/\.[^.]+$/, '');
    names.push(fname);
    const ext = file.name.split('.').pop().toLowerCase();
    const reader = new FileReader();

    function onParsed(asins) {
      fileAsinMap[fname] = asins;  // Track per-file ASINs
      allAsins = allAsins.concat(asins);
      pending--;
      if (pending === 0) {
        const deduped = [...new Set(allAsins)];
        uploadedFileName = names.length === 1 ? names[0] : names.join('_');
        els.pasteArea.value = deduped.join('\n');
        loadAsins(deduped);
      }
    }

    if (ext === 'txt') {
      reader.onload = e => onParsed(parseAsinsFromText(e.target.result));
      reader.readAsText(file);
    } else if (ext === 'csv') {
      reader.onload = e => onParsed(parseCSV(e.target.result));
      reader.readAsText(file);
    } else if (ext === 'xlsx' || ext === 'xls') {
      reader.onload = e => onParsed(parseXLSX(new Uint8Array(e.target.result)));
      reader.readAsArrayBuffer(file);
    } else {
      onParsed([]);
    }
  });
}

/* ── UI State Management ───────────────────────────── */

function updateUI(st) {
  if (!st) return;
  const status = st.status;

  // Controls visibility
  const isIdle = status === 'idle';
  const isRunning = status === 'running';
  const isPaused = status === 'paused';
  const isDone = status === 'complete' || status === 'stopped';

  els.startBtn.style.display = isIdle ? '' : 'none';
  els.pauseBtn.style.display = isRunning ? '' : 'none';
  els.resumeBtn.style.display = isPaused ? '' : 'none';
  els.stopBtn.style.display = (isRunning || isPaused) ? '' : 'none';

  // Upload section: hide when running/paused
  els.uploadSection.style.display = (isRunning || isPaused) ? 'none' : '';
  els.settingsSection.style.display = isIdle && parsedAsins.length > 0 ? '' : 'none';

  // Progress
  if (!isIdle) {
    els.progressSection.style.display = '';
    const total = st.totalAsins || 1;
    const current = st.currentIndex || 0;
    const pct = Math.round((current / total) * 100);
    els.progressText.textContent = `${current} / ${total}`;
    els.progressFill.style.width = pct + '%';

    // ETA
    if (isRunning && st.startTime && current > 0) {
      const elapsed = Date.now() - st.startTime;
      const perItem = elapsed / current;
      const remaining = (total - current) * perItem;
      els.etaText.textContent = `ETA: ${formatDuration(remaining)}`;
    } else if (isDone) {
      els.etaText.textContent = st.startTime ? `Done in ${formatDuration(Date.now() - st.startTime)}` : 'Done';
    } else {
      els.etaText.textContent = '';
    }

    // Stats
    els.statGroups.textContent = (st.groups || []).length;
    els.statSkipped.textContent = st.skippedCount || 0;
    els.statSolo.textContent = st.stats?.standalone || 0;
    els.statErrors.textContent = st.stats?.errors || 0;
  } else {
    els.progressSection.style.display = 'none';
  }

  // Logs
  if (!isIdle && st.logs && st.logs.length > 0) {
    els.logSection.style.display = '';
    // Only append new logs
    const logs = st.logs;
    if (logs.length !== lastLogCount) {
      renderLogs(logs);
      lastLogCount = logs.length;
    }
  }

  // Output
  if (isDone && st.groups && st.groups.length > 0) {
    els.outputSection.style.display = '';
    const totalGrouped = st.groups.reduce((s, g) => s + g.asins.length, 0);
    const totalTime = st.startTime ? formatDuration(Date.now() - st.startTime) : '';
    els.outputSummary.textContent = `✅ ${st.groups.length} groups (${totalGrouped} ASINs)${totalTime ? ' — ' + totalTime : ''}`;

    // Per-file summary cards
    renderFileSummary(st);

    // CSV preview
    const previewLines = ['GroupID, ASIN, Label'];
    st.groups.forEach((g, idx) => {
      g.asins.forEach(a => {
        previewLines.push(`${idx + 1}, ${a.asin}, ${a.label || '-'}`);
      });
    });
    els.csvPreview.textContent = previewLines.slice(0, 30).join('\n') + (previewLines.length > 30 ? '\n...' : '');
    els.csvPreview.style.display = '';

    // Download triggered when popup opens (not here)
  } else if (isDone) {
    els.outputSection.style.display = '';
    els.outputSummary.textContent = '📦 No variant groups found in the uploaded ASINs.';
    els.fileSummaryList.innerHTML = '';
    els.csvPreview.style.display = 'none';
  } else {
    els.outputSection.style.display = 'none';
  }
}

function renderLogs(logs) {
  const container = els.logContainer;
  container.innerHTML = '';
  logs.forEach(log => {
    const div = document.createElement('div');
    div.className = `log-entry log-${log.type || 'info'}`;
    div.textContent = log.msg;
    container.appendChild(div);
  });
  container.scrollTop = container.scrollHeight;
}

/* ── Per-File Summary + Auto Download ──────────────── */

function renderFileSummary(st) {
  const fMap = st.fileAsinMap || {};
  const fileNames = Object.keys(fMap);
  const container = els.fileSummaryList;

  if (fileNames.length === 0) {
    // Paste mode — single summary
    const total = st.totalAsins || 0;
    const groups = (st.groups || []).length;
    container.innerHTML = `<div class="file-card">
      <span class="fc-icon">📋</span>
      <div class="fc-info">
        <div class="fc-name">Pasted ASINs</div>
        <div class="fc-stats">${total} ASINs → ${groups} groups</div>
      </div>
      <span class="fc-status ok">✅ downloaded</span>
    </div>`;
    return;
  }

  container.innerHTML = fileNames.map(fname => {
    const sourceAsins = new Set((fMap[fname] || []).map(a => a.toUpperCase()));
    const asinCount = sourceAsins.size;
    const fileGroups = (st.groups || []).filter(g =>
      g.asins.some(a => sourceAsins.has(a.asin.toUpperCase()))
    );
    const groupCount = fileGroups.length;
    const groupedAsins = fileGroups.reduce((s, g) => s + g.asins.length, 0);

    return `<div class="file-card">
      <span class="fc-icon">📁</span>
      <div class="fc-info">
        <div class="fc-name">${fname}</div>
        <div class="fc-stats">${asinCount} ASINs → ${groupCount} groups (${groupedAsins} ASINs grouped)</div>
      </div>
      <span class="fc-status ${groupCount > 0 ? 'ok' : 'empty'}">${groupCount > 0 ? '✅ downloaded' : '— no groups'}</span>
    </div>`;
  }).join('');
}

function autoDownloadFiles(st) {
  const fMap = st.fileAsinMap || {};
  const fileNames = Object.keys(fMap);

  if (fileNames.length <= 1) {
    // Single file or paste mode — one download
    const fname = fileNames[0] || st.fileName || 'variant_sibling';
    downloadCSV(st.groups, fname);
    return;
  }

  // Multiple files — separate download per source file
  let downloadIdx = 0;
  fileNames.forEach(fname => {
    const sourceAsins = new Set((fMap[fname] || []).map(a => a.toUpperCase()));
    const fileGroups = (st.groups || []).filter(g =>
      g.asins.some(a => sourceAsins.has(a.asin.toUpperCase()))
    );
    if (fileGroups.length === 0) return;
    setTimeout(() => downloadCSV(fileGroups, fname), downloadIdx * 700);
    downloadIdx++;
  });
}

function downloadCSV(groups, fileName) {
  const rows = ['GroupID,ASIN,Label'];
  groups.forEach((g, idx) => {
    g.asins.forEach(a => {
      const label = (a.label || '').replace(/"/g, '""');
      rows.push(`${idx + 1},"${a.asin}","${label}"`);
    });
  });
  const csv = '\uFEFF' + rows.join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${fileName}_variants.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function formatDuration(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) return `${m}m ${rs}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

/* ── Delay Control ─────────────────────────────────── */

window.adjustDelay = function (delta) {
  currentDelay = Math.max(1000, Math.min(15000, currentDelay + delta));
  els.delayVal.textContent = (currentDelay / 1000).toFixed(1) + 's';
  chrome.runtime.sendMessage({ type: 'SET_DELAY', delay: currentDelay });
};

/* ── History ───────────────────────────────────────── */

function toggleHistory() {
  showingHistory = !showingHistory;
  els.historySection.style.display = showingHistory ? '' : 'none';
  if (showingHistory) loadHistory();
}

function loadHistory() {
  chrome.runtime.sendMessage({ type: 'GET_HISTORY' }, (resp) => {
    if (!resp) return;
    const list = resp.history || [];
    if (list.length === 0) {
      els.historyList.innerHTML = '<div class="history-empty">No past runs yet</div>';
      return;
    }
    els.historyList.innerHTML = list.map((h, i) => {
      const date = new Date(h.time);
      const dateStr = date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const fname = h.fileName || 'export';
      return `<div class="history-item">
        <div class="h-info">
          <div class="h-date">${dateStr} — ${fname}</div>
          <div class="h-stats">${h.totalAsins} ASINs → ${h.groups} groups</div>
        </div>
        <button class="h-dl" data-idx="${i}">📥 ${fname}_variants.csv</button>
      </div>`;
    }).join('');

    // Wire download buttons
    els.historyList.querySelectorAll('.h-dl').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.idx);
        const entry = list[idx];
        if (entry && entry.csvData) {
          const csv = '\uFEFF' + entry.csvData;
          const fname = entry.fileName || 'export';
          const blob = new Blob([csv], { type: 'text/csv' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `${fname}_variants.csv`;
          document.body.appendChild(a);
          a.click();
          a.remove();
          URL.revokeObjectURL(url);
        }
      });
    });
  });
}

/* ── Resume Banner ─────────────────────────────────── */

function checkResume(st) {
  if (st && st.status === 'paused' && st.totalAsins > 0) {
    els.resumeBanner.style.display = '';
    els.resumeInfo.textContent = `${st.currentIndex}/${st.totalAsins} processed, ${(st.groups || []).length} groups found`;
    // Show running UI
    updateUI(st);
  } else {
    els.resumeBanner.style.display = 'none';
  }
}

/* ── Polling ───────────────────────────────────────── */

function pollState() {
  chrome.runtime.sendMessage({ type: 'GET_STATE' }, (resp) => {
    if (chrome.runtime.lastError) return;
    if (resp) updateUI(resp);
  });
}

function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(pollState, 600);
}

/* ── Event Listeners ───────────────────────────────── */

// File upload
els.dropZone.addEventListener('click', () => els.fileInput.click());
els.fileInput.addEventListener('change', (e) => {
  if (e.target.files.length > 0) handleFiles(e.target.files);
});
els.dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  els.dropZone.classList.add('dragover');
});
els.dropZone.addEventListener('dragleave', () => {
  els.dropZone.classList.remove('dragover');
});
els.dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  els.dropZone.classList.remove('dragover');
  if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files);
});

// Paste area
els.pasteArea.addEventListener('input', () => {
  const asins = parseAsinsFromText(els.pasteArea.value);
  loadAsins(asins);
});

// Clear
els.clearAsinsBtn.addEventListener('click', () => {
  parsedAsins = [];
  els.pasteArea.value = '';
  loadAsins([]);
});

// Start
els.startBtn.addEventListener('click', () => {
  if (!parsedAsins.length) return;
  lastLogCount = 0;
  els.logContainer.innerHTML = '';
  autoDownloaded = false;
  chrome.runtime.sendMessage({
    type: 'START',
    asins: parsedAsins,
    delay: currentDelay,
    fileName: uploadedFileName || 'variant_sibling',
    fileAsinMap: fileAsinMap
  }, (resp) => {
    if (resp && resp.ok) {
      pollState();
    }
  });
});

// Pause
els.pauseBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'PAUSE' });
});

// Resume
els.resumeBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'RESUME' });
  els.resumeBanner.style.display = 'none';
});

els.resumeBannerBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'RESUME' });
  els.resumeBanner.style.display = 'none';
});

// Stop
els.stopBtn.addEventListener('click', () => {
  if (confirm('Stop processing? You can download partial results.')) {
    chrome.runtime.sendMessage({ type: 'STOP' });
  }
});

// Discard resume
els.discardBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'RESET' });
  els.resumeBanner.style.display = 'none';
  updateUI({ status: 'idle' });
});

// Copy CSV — full CSV from current state
els.copyBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'GET_STATE' }, (resp) => {
    if (!resp || !resp.groups || !resp.groups.length) return;
    const rows = ['GroupID,ASIN,Label'];
    resp.groups.forEach((g, idx) => {
      g.asins.forEach(a => {
        const label = (a.label || '').replace(/"/g, '""');
        rows.push(`${idx + 1},"${a.asin}","${label}"`);
      });
    });
    navigator.clipboard.writeText(rows.join('\n')).then(() => {
      els.copyBtn.textContent = '✅ Copied!';
      setTimeout(() => { els.copyBtn.textContent = '📋 Copy CSV'; }, 1500);
    });
  });
});

// Clear cumulative results
els.clearHistoryBtn.addEventListener('click', () => {
  if (confirm('Clear all run history and cumulative results?')) {
    chrome.runtime.sendMessage({ type: 'CLEAR_HISTORY' });
    chrome.runtime.sendMessage({ type: 'CLEAR_CUMULATIVE' });
    els.historyList.innerHTML = '<div class="history-empty">No past runs yet</div>';
  }
});

// Reset
els.resetBtn.addEventListener('click', () => {
  if (confirm('Reset everything? This clears current progress.')) {
    chrome.runtime.sendMessage({ type: 'RESET' });
    parsedAsins = [];
    els.pasteArea.value = '';
    loadAsins([]);
    lastLogCount = 0;
    els.logContainer.innerHTML = '';
    els.logSection.style.display = 'none';
    els.outputSection.style.display = 'none';
    els.progressSection.style.display = 'none';
    els.resumeBanner.style.display = 'none';
    updateUI({ status: 'idle' });
  }
});

// Clear log
els.clearLogBtn.addEventListener('click', () => {
  els.logContainer.innerHTML = '';
  lastLogCount = 0;
});

// Listen for state broadcasts from background
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'STATE_UPDATE') {
    updateUI(msg.state);
  }
});

/* ── Init ──────────────────────────────────────────── */

// On popup open: get current state + auto-download if complete
chrome.runtime.sendMessage({ type: 'GET_STATE' }, (resp) => {
  if (chrome.runtime.lastError) return;
  if (resp) {
    if (resp.status === 'paused') {
      checkResume(resp);
    } else if (resp.status === 'running') {
      updateUI(resp);
    } else if (resp.status === 'complete' || resp.status === 'stopped') {
      updateUI(resp);
      // Auto-download when popup opens after completion
      if (resp.status === 'complete' && !autoDownloaded && resp.groups && resp.groups.length > 0) {
        autoDownloaded = true;
        setTimeout(() => autoDownloadFiles(resp), 500);
      }
    }
    if (resp.delay) {
      currentDelay = resp.delay;
      els.delayVal.textContent = (currentDelay / 1000).toFixed(1) + 's';
    }
  }
});

// Start polling
startPolling();

```
