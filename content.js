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
