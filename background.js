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
