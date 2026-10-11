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

// On popup open: get current state
chrome.runtime.sendMessage({ type: 'GET_STATE' }, (resp) => {
  if (chrome.runtime.lastError) return;
  if (resp) {
    if (resp.status === 'paused') {
      checkResume(resp);
    } else if (resp.status === 'running') {
      updateUI(resp);
    } else if (resp.status === 'complete' || resp.status === 'stopped') {
      updateUI(resp);
    }
    if (resp.delay) {
      currentDelay = resp.delay;
      els.delayVal.textContent = (currentDelay / 1000).toFixed(1) + 's';
    }
  }
});

// Start polling
startPolling();
