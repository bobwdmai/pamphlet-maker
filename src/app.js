(function () {
'use strict';

const { PDFDocument, rgb, degrees } = PDFLib;
const {
  paddedCount,
  buildBalancedSignatures,
  computeHalfMargins,
  validateLayoutOptions,
  creepShiftForSheet,
  normalizeRotation,
  effectiveDimensions,
  computeRotatedPlacement,
} = BookMakerImposition;

const PAPER_SIZES_IN = {
  letter: [8.5, 11],
  a4: [8.2677, 11.6929],
  legal: [8.5, 14],
  tabloid: [11, 17],
  a3: [11.6929, 16.5354],
};
const IN_TO_PT = 72;

let sourceBytes = null;
let sourceFileName = '';
let sourcePageCount = 0;
let generatedFiles = [];

const fileInput = document.getElementById('fileInput');
const dropzone = document.getElementById('dropzone');
const summaryEl = document.getElementById('summary');
const errorBanner = document.getElementById('errorBanner');
const generateBtn = document.getElementById('generateBtn');
const paperSizeSel = document.getElementById('paperSize');
const customWidthField = document.getElementById('customWidthField');
const customHeightField = document.getElementById('customHeightField');
const logEl = document.getElementById('log');
const downloadsEl = document.getElementById('downloads');
const previewGridEl = document.getElementById('previewGrid');
const instructionsPanel = document.getElementById('instructions');
const instructionSteps = document.getElementById('instructionSteps');
const signatureTableEl = document.getElementById('signatureTable');
const progressEl = document.getElementById('progress');
const progressFillEl = document.getElementById('progressFill');
const progressLabelEl = document.getElementById('progressLabel');
const manualDuplexCheckbox = document.getElementById('manualDuplex');
const calibrationSection = document.getElementById('calibrationSection');
const calibrateBtn = document.getElementById('calibrateBtn');
const creepEnabledCheckbox = document.getElementById('creepEnabled');
const creepField = document.getElementById('creepField');

// ---------------------------------------------------------------------
// Options wiring
// ---------------------------------------------------------------------

paperSizeSel.addEventListener('change', () => {
  const isCustom = paperSizeSel.value === 'custom';
  customWidthField.style.display = isCustom ? '' : 'none';
  customHeightField.style.display = isCustom ? '' : 'none';
  updateSummary();
});

document.getElementById('signatureSize').addEventListener('change', updateSummary);
document.getElementById('customWidth').addEventListener('input', updateSummary);
document.getElementById('customHeight').addEventListener('input', updateSummary);
document.getElementById('outerMargin').addEventListener('input', updateSummary);
document.getElementById('gutterMargin').addEventListener('input', updateSummary);

manualDuplexCheckbox.addEventListener('change', () => {
  calibrationSection.style.display = manualDuplexCheckbox.checked ? '' : 'none';
});

creepEnabledCheckbox.addEventListener('change', () => {
  creepField.style.display = creepEnabledCheckbox.checked ? '' : 'none';
});

calibrateBtn.addEventListener('click', () => runGuarded(generateCalibrationSheet));

// ---------------------------------------------------------------------
// File loading — shared by the picker and drag-and-drop
// ---------------------------------------------------------------------

fileInput.addEventListener('change', () => loadFile(fileInput.files[0]));

['dragenter', 'dragover'].forEach((evt) => {
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  });
});
['dragleave', 'dragend'].forEach((evt) => {
  dropzone.addEventListener(evt, () => dropzone.classList.remove('dragover'));
});
dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropzone.classList.remove('dragover');
  const file = e.dataTransfer.files && e.dataTransfer.files[0];
  if (!file) return;
  try {
    const dt = new DataTransfer();
    dt.items.add(file);
    fileInput.files = dt.files;
  } catch (_error) {
    // Some browsers won't let us assign to input.files; that's fine, we
    // still have the dropped File object itself to work with.
  }
  loadFile(file);
});

async function loadFile(file) {
  generatedFiles.forEach((f) => URL.revokeObjectURL(f.url));
  generatedFiles = [];
  downloadsEl.innerHTML = '';
  previewGridEl.innerHTML = '';
  instructionsPanel.style.display = 'none';
  logEl.textContent = '';
  hideError();
  if (!file) {
    sourceBytes = null;
    sourceFileName = '';
    sourcePageCount = 0;
    summaryEl.innerHTML = '';
    generateBtn.disabled = true;
    calibrateBtn.disabled = true;
    return;
  }
  try {
    const buf = await file.arrayBuffer();
    sourceBytes = new Uint8Array(buf);
    sourceFileName = file.name || '';
    const doc = await PDFDocument.load(sourceBytes);
    sourcePageCount = doc.getPageCount();
    generateBtn.disabled = sourcePageCount === 0;
    calibrateBtn.disabled = sourcePageCount === 0;
    updateSummary();
  } catch (err) {
    summaryEl.innerHTML = `<span class="warn">Could not read that PDF: ${escapeHtml(err.message)}</span>`;
    generateBtn.disabled = true;
    calibrateBtn.disabled = true;
  }
}

function outputBaseName() {
  const stripped = sourceFileName.replace(/\.pdf$/i, '').trim();
  return stripped || 'booklet';
}

// ---------------------------------------------------------------------
// Summary / preview
// ---------------------------------------------------------------------

function updateSummary() {
  if (!sourcePageCount) { summaryEl.innerHTML = ''; previewGridEl.innerHTML = ''; return; }
  const n = paddedCount(sourcePageCount);
  const blanks = n - sourcePageCount;
  const sigSize = parseInt(document.getElementById('signatureSize').value, 10);
  const effectiveSig = sigSize > 0 ? sigSize : n;
  const signatures = buildBalancedSignatures(n, effectiveSig);
  const totalSheets = n / 4;
  summaryEl.innerHTML = `
    <div><span class="ok">${sourcePageCount} pages</span> detected.</div>
    <div>${blanks > 0 ? blanks + ' blank page(s) will be added at the end so the booklet folds evenly.' : 'Page count is already a multiple of 4 — no blank pages needed.'}</div>
    <div>${totalSheets} physical sheet(s) total${signatures.length > 1 ? `, split into ${signatures.length} balanced signatures` : ''}.</div>
  `;
  renderLayoutPreview(signatures);
}

/**
 * A schematic layout preview: which page numbers land on which half of
 * which sheet, front and back. This is not a rendering of the actual page
 * content (that would need a PDF rasterizer like pdf.js, which this
 * build-free, single-purpose tool doesn't vendor) — it's a diagram of the
 * imposition plan, useful for sanity-checking before printing.
 */
function renderLayoutPreview(signatures) {
  previewGridEl.innerHTML = '';
  const opts = readOptionsQuiet();
  if (!opts) return;
  const aspect = opts.sheetWidthPt / opts.sheetHeightPt;
  const w = 200;
  const h = Math.round(w / aspect);

  let sheetNumber = 0;
  for (const sig of signatures) {
    for (const sheet of sig.sheets) {
      sheetNumber += 1;
      ['front', 'back'].forEach((side) => {
        const [left, right] = sheet[side];
        const wrap = document.createElement('div');
        wrap.className = 'preview-sheet';
        wrap.innerHTML = `
          <svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Sheet ${sheetNumber} ${side}: page ${left} on the left, page ${right} on the right">
            <rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" fill="none" stroke="currentColor" stroke-width="1" opacity="0.35"/>
            <line x1="${w / 2}" y1="0" x2="${w / 2}" y2="${h}" stroke="currentColor" stroke-width="1" stroke-dasharray="3,3" opacity="0.35"/>
            <text x="${w / 4}" y="${h / 2}" text-anchor="middle" dominant-baseline="middle" font-size="16" fill="currentColor">${left > sourcePageCount ? '—' : left}</text>
            <text x="${3 * w / 4}" y="${h / 2}" text-anchor="middle" dominant-baseline="middle" font-size="16" fill="currentColor">${right > sourcePageCount ? '—' : right}</text>
          </svg>
        `;
        const label = document.createElement('div');
        label.className = 'preview-sheet-label';
        label.textContent = `Sheet ${sheetNumber} · ${side}`;
        wrap.appendChild(label);
        previewGridEl.appendChild(wrap);
      });
    }
  }
}

// ---------------------------------------------------------------------
// Options reading + validation
// ---------------------------------------------------------------------

function currentPaperSizeIn() {
  if (paperSizeSel.value === 'custom') {
    const widthIn = parseFloat(document.getElementById('customWidth').value);
    const heightIn = parseFloat(document.getElementById('customHeight').value);
    return [widthIn, heightIn];
  }
  return PAPER_SIZES_IN[paperSizeSel.value];
}

function readOptions() {
  const [widthIn, heightIn] = currentPaperSizeIn();
  // Sheet is printed landscape: physical long dimension becomes width.
  const sheetWidthIn = Math.max(widthIn, heightIn);
  const sheetHeightIn = Math.min(widthIn, heightIn);

  const creepEnabled = creepEnabledCheckbox.checked;
  const creepAmountIn = parseFloat(document.getElementById('creepAmount').value);

  return {
    sheetWidthPt: sheetWidthIn * IN_TO_PT,
    sheetHeightPt: sheetHeightIn * IN_TO_PT,
    outerMarginPt: parseFloat(document.getElementById('outerMargin').value) * IN_TO_PT,
    gutterMarginPt: parseFloat(document.getElementById('gutterMargin').value) * IN_TO_PT,
    foldLine: document.getElementById('foldLine').checked,
    manualDuplex: manualDuplexCheckbox.checked,
    signatureSize: parseInt(document.getElementById('signatureSize').value, 10),
    backRotate180: document.getElementById('backRotate180').checked,
    backReverseOrder: document.getElementById('backReverseOrder').checked,
    creepTotalPt: creepEnabled && Number.isFinite(creepAmountIn) ? creepAmountIn * IN_TO_PT : 0,
  };
}

/** Same as readOptions but never throws / never used for generation — for live preview only. */
function readOptionsQuiet() {
  try {
    const opts = readOptions();
    if (!Number.isFinite(opts.sheetWidthPt) || !Number.isFinite(opts.sheetHeightPt)) return null;
    if (opts.sheetWidthPt <= 0 || opts.sheetHeightPt <= 0) return null;
    return opts;
  } catch (_error) {
    return null;
  }
}

function showError(errors) {
  errorBanner.innerHTML = `<strong>Please fix the following before generating:</strong><ul>${errors.map((e) => `<li>${escapeHtml(e)}</li>`).join('')}</ul>`;
  errorBanner.classList.add('show');
}
function hideError() {
  errorBanner.classList.remove('show');
  errorBanner.innerHTML = '';
}

// ---------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------

function showProgress(label) {
  progressEl.classList.add('show');
  progressFillEl.style.width = '0%';
  progressLabelEl.textContent = label || '';
}
function setProgress(fraction, label) {
  progressFillEl.style.width = `${Math.round(Math.max(0, Math.min(1, fraction)) * 100)}%`;
  if (label) progressLabelEl.textContent = label;
}
function hideProgress() {
  progressEl.classList.remove('show');
}
/** Yield to the event loop so the browser can repaint the progress bar. */
function yieldToUi() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// ---------------------------------------------------------------------
// Source page preparation — cropBox and rotation handling
// ---------------------------------------------------------------------

/**
 * pdf-lib's drawPage() composites a source page's raw content and ignores
 * both its /Rotate flag and its cropBox entirely (verified empirically: a
 * rotated page draws unrotated, and content outside a smaller cropBox still
 * shows through). Rotation is corrected for at draw time in
 * drawImposedSide() via computeRotatedPlacement(). Cropping with a
 * zero-origin cropBox — by far the common case, e.g. a page with bleed
 * trimmed off starting at (0, 0) — is corrected here by flattening the
 * cropBox into the mediaBox before embedding, so pdf-lib and everything
 * downstream just sees the cropped size. A cropBox with a *non-zero*
 * origin hits a separate pdf-lib quirk (setMediaBox with an inset origin
 * doesn't shift page content to compensate), so that rarer case is left
 * alone rather than applying a fix that would make alignment worse.
 */
async function loadPreparedSource(bytes) {
  const doc = await PDFDocument.load(bytes);
  for (const page of doc.getPages()) {
    const media = page.getMediaBox();
    const crop = page.getCropBox();
    const differs = Math.abs(media.x - crop.x) > 0.01 || Math.abs(media.y - crop.y) > 0.01 ||
      Math.abs(media.width - crop.width) > 0.01 || Math.abs(media.height - crop.height) > 0.01;
    const zeroOrigin = Math.abs(crop.x) < 0.01 && Math.abs(crop.y) < 0.01;
    if (differs && zeroOrigin) {
      page.setMediaBox(crop.x, crop.y, crop.width, crop.height);
    }
  }
  return doc;
}

// ---------------------------------------------------------------------
// Drawing a single sheet side
// ---------------------------------------------------------------------

/**
 * slot = [leftPageNum, rightPageNum], 1-indexed actual page numbers (may
 * exceed sourcePageCount => blank). `srcDoc` is the prepared source
 * document (for page size/rotation lookups); `embeddedPages` are that same
 * document's pages already embedded into `doc`.
 */
function drawImposedSide(doc, opts, slot, srcDoc, embeddedPages, creepShiftPt) {
  const page = doc.addPage([opts.sheetWidthPt, opts.sheetHeightPt]);
  const halfWidth = opts.sheetWidthPt / 2;
  const positions = [
    { pageNum: slot[0], x0: 0, x1: halfWidth, isLeft: true },
    { pageNum: slot[1], x0: halfWidth, x1: opts.sheetWidthPt, isLeft: false },
  ];

  for (const pos of positions) {
    if (pos.pageNum > sourcePageCount) continue; // blank padding page
    const embedded = embeddedPages[pos.pageNum - 1];
    const srcPage = srcDoc.getPage(pos.pageNum - 1);
    const rotationAngle = srcPage.getRotation().angle;
    const { width: pageBoxW, height: pageBoxH } = srcPage.getSize();

    const margins = computeHalfMargins(pos.isLeft, opts.outerMarginPt, opts.gutterMarginPt);
    // Creep only ever pushes content further from the spine, regardless of
    // which physical side (left/right) the spine happens to be on.
    if (pos.isLeft) margins.right += creepShiftPt; else margins.left += creepShiftPt;

    const top = opts.outerMarginPt, bottom = opts.outerMarginPt;
    const availW = (pos.x1 - pos.x0) - margins.left - margins.right;
    const availH = opts.sheetHeightPt - top - bottom;
    if (availW <= 0 || availH <= 0) continue; // guarded by validateLayoutOptions before generation

    const eff = effectiveDimensions(pageBoxW, pageBoxH, rotationAngle);
    const scale = Math.min(availW / eff.width, availH / eff.height);
    const drawW = eff.width * scale, drawH = eff.height * scale;
    const targetX = pos.x0 + margins.left + (availW - drawW) / 2;
    const targetY = bottom + (availH - drawH) / 2;

    const placement = computeRotatedPlacement({
      pageWidth: pageBoxW, pageHeight: pageBoxH, rotationAngle, targetX, targetY, scale,
    });

    page.drawPage(embedded, {
      x: placement.x,
      y: placement.y,
      xScale: scale,
      yScale: scale,
      rotate: degrees(placement.rotateDegrees),
    });
  }

  if (opts.foldLine) {
    page.drawLine({
      start: { x: halfWidth, y: 0 },
      end: { x: halfWidth, y: opts.sheetHeightPt },
      thickness: 0.5,
      color: rgb(0.75, 0.75, 0.75),
      dashArray: [4, 4],
      opacity: 0.6,
    });
  }

  return page;
}

// ---------------------------------------------------------------------
// Generation — sequential, one output document in memory at a time
// ---------------------------------------------------------------------

generateBtn.addEventListener('click', () => runGuarded(generate));

async function runGuarded(fn) {
  generateBtn.disabled = true;
  calibrateBtn.disabled = true;
  hideError();
  try {
    await fn();
  } catch (err) {
    console.error(err);
    logEl.textContent = 'Error: ' + err.message;
  } finally {
    generateBtn.disabled = sourcePageCount === 0;
    calibrateBtn.disabled = sourcePageCount === 0;
    hideProgress();
  }
}

function creepShiftForSheetInSignature(sheetIndex, sig, opts) {
  return creepShiftForSheet(sheetIndex, sig.sheets.length, opts.creepTotalPt);
}

async function generate() {
  logEl.textContent = 'Working…';
  downloadsEl.innerHTML = '';
  generatedFiles.forEach((f) => URL.revokeObjectURL(f.url));
  generatedFiles = [];

  const opts = readOptions();
  const validation = validateLayoutOptions(opts);
  if (!validation.valid) {
    showError(validation.errors);
    logEl.textContent = '';
    return;
  }

  const n = paddedCount(sourcePageCount);
  const effectiveSig = opts.signatureSize > 0 ? opts.signatureSize : n;
  const signatures = buildBalancedSignatures(n, effectiveSig);
  const totalSheets = signatures.reduce((sum, s) => sum + s.sheets.length, 0);
  const baseName = outputBaseName();

  // Each output document is built, saved, and discarded before the next one
  // starts, so at most one PDFDocument (plus its embedded pages) is live in
  // memory at a time — important for large books, where holding 3-4 full
  // copies of every embedded page simultaneously (the previous approach)
  // could exhaust browser memory.
  const outputsNeeded = opts.manualDuplex ? 3 : 1; // combined, fronts, backs
  let unitsDone = 0;
  const totalUnits = totalSheets * (opts.manualDuplex ? 4 : 2); // 2 sides for combined; +2 for fronts+backs
  showProgress('Preparing…');

  async function renderPass(label, sideSelector, sheetOrder) {
    const doc = await PDFDocument.create();
    const srcDoc = await loadPreparedSource(sourceBytes);
    const embeddedPages = await doc.embedPdf(srcDoc, srcDoc.getPageIndices());
    for (const { sig, sheet, sheetIndex } of sheetOrder) {
      const creepShiftPt = creepShiftForSheetInSignature(sheetIndex, sig, opts);
      for (const side of sideSelector(sheet)) {
        drawImposedSide(doc, opts, side.slot, srcDoc, embeddedPages, creepShiftPt);
        if (side.rotate180) {
          const p = doc.getPage(doc.getPageCount() - 1);
          p.setRotation(degrees((p.getRotation().angle + 180) % 360));
        }
        unitsDone += 1;
        setProgress(unitsDone / totalUnits, `${label}: sheet side ${unitsDone}`);
        await yieldToUi();
      }
    }
    const bytes = await doc.save();
    return bytes;
  }

  // Flat sheet list with signature context, used by both combined & split passes.
  const flatSheets = [];
  for (const sig of signatures) {
    sig.sheets.forEach((sheet, sheetIndex) => flatSheets.push({ sig, sheet, sheetIndex }));
  }

  const combinedBytes = await renderPass(
    'Combined',
    (sheet) => [{ slot: sheet.front, rotate180: false }, { slot: sheet.back, rotate180: false }],
    flatSheets,
  );
  addDownload(`${baseName}-booklet.pdf`, combinedBytes, 'Main file — for auto-duplex printers');

  if (opts.manualDuplex) {
    const frontsBytes = await renderPass(
      'Fronts',
      (sheet) => [{ slot: sheet.front, rotate180: false }],
      flatSheets,
    );
    addDownload(`${baseName}-fronts.pdf`, frontsBytes, 'Fronts only (print first)');

    const backOrder = opts.backReverseOrder ? [...flatSheets].reverse() : flatSheets;
    const backsBytes = await renderPass(
      'Backs',
      (sheet) => [{ slot: sheet.back, rotate180: opts.backRotate180 }],
      backOrder,
    );
    addDownload(`${baseName}-backs.pdf`, backsBytes, 'Backs (print second, after flipping the stack)');
  }

  renderInstructions(opts, signatures, n);
  logEl.textContent = 'Done.';
  hideProgress();
}

/**
 * A single physical sheet (front + back of just the first sheet of the
 * book) with large FRONT/BACK labels, an orientation arrow, and corner
 * registration marks — so a manual-duplex printer's actual rotation/order
 * behavior can be checked on one sheet of paper instead of the whole job.
 */
async function generateCalibrationSheet() {
  logEl.textContent = 'Building calibration sheet…';
  hideError();

  const opts = readOptions();
  const validation = validateLayoutOptions(opts);
  if (!validation.valid) {
    showError(validation.errors);
    logEl.textContent = '';
    return;
  }

  const n = paddedCount(sourcePageCount);
  const sheets = BookMakerImposition.sheetsForRange(1, Math.min(n, 4) || 4);
  const firstSheet = sheets[0];

  const doc = await PDFDocument.create();
  const srcDoc = await loadPreparedSource(sourceBytes);
  const embeddedPages = await doc.embedPdf(srcDoc, srcDoc.getPageIndices());

  const frontPage = drawImposedSide(doc, opts, firstSheet.front, srcDoc, embeddedPages, 0);
  annotateCalibrationPage(frontPage, opts, 'FRONT');

  const backPage = drawImposedSide(doc, opts, firstSheet.back, srcDoc, embeddedPages, 0);
  if (opts.backRotate180) {
    backPage.setRotation(degrees((backPage.getRotation().angle + 180) % 360));
  }
  annotateCalibrationPage(backPage, opts, 'BACK');

  const bytes = await doc.save();
  addDownload(`${outputBaseName()}-calibration.pdf`, bytes, 'One-sheet calibration test');
  logEl.textContent = 'Calibration sheet ready. Print it, flip the paper the way you normally would, and check alignment.';
}

function annotateCalibrationPage(page, opts, labelText) {
  const w = opts.sheetWidthPt, h = opts.sheetHeightPt;
  const markSize = 10;
  const corners = [[0, 0], [w - markSize, 0], [0, h - markSize], [w - markSize, h - markSize]];
  for (const [x, y] of corners) {
    page.drawRectangle({ x, y, width: markSize, height: markSize, color: rgb(0, 0, 0) });
  }
  page.drawText(labelText, { x: 16, y: h - 34, size: 20, color: rgb(0.8, 0, 0) });
  page.drawText('^ this edge is UP', { x: 16, y: h - 54, size: 10, color: rgb(0.8, 0, 0) });
}

// ---------------------------------------------------------------------
// Downloads
// ---------------------------------------------------------------------

function addDownload(filename, bytes, label) {
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  generatedFiles.push({ url });
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.textContent = `⬇ ${filename}`;
  a.title = label;
  downloadsEl.appendChild(a);
}

// ---------------------------------------------------------------------
// Instructions panel
// ---------------------------------------------------------------------

function renderInstructions(opts, signatures, totalPages) {
  instructionsPanel.style.display = '';
  const paperLabel = paperSizeSel.options[paperSizeSel.selectedIndex].text;
  const steps = [];
  steps.push(`Load <strong>${escapeHtml(paperLabel)}</strong> paper in your printer.`);
  if (opts.manualDuplex) {
    steps.push(`Print <code>${escapeHtml(outputBaseName())}-fronts.pdf</code> first, at <strong>Actual size / 100% scale</strong> (not "fit to page").`);
    steps.push(`Flip the printed stack the way your calibration test showed works, and print <code>${escapeHtml(outputBaseName())}-backs.pdf</code> onto the back.`);
    steps.push(`If you haven't already, use the calibration sheet above to work out the right rotation/order combination before printing the whole job.`);
  } else {
    steps.push(`Open <code>${escapeHtml(outputBaseName())}-booklet.pdf</code> and print with <strong>two-sided / duplex</strong> printing turned on.`);
    steps.push(`Set the duplex "flip" option to <strong>Flip on Short Edge</strong> (sometimes called "short-edge binding") — this is the setting for landscape, side-by-side booklet pages. Print a 2-sheet test first to confirm the back lines up before running the whole file.`);
    steps.push(`Print at <strong>Actual size / 100% scale</strong>, not "fit to page", so the imposed pages stay full size.`);
  }
  steps.push(`Fold each sheet in half vertically along the center guide line.`);
  if (signatures.length > 1) {
    steps.push(`Nest the sheets of each signature inside one another in sheet order, then staple along the fold. Repeat per signature (see table below), then stack the signatures in order and bind (tape, glue, or sew the folds) to form the full book.`);
  } else {
    steps.push(`Nest all the folded sheets inside one another in sheet order and staple along the fold (saddle-stitch).`);
  }
  instructionSteps.innerHTML = steps.map((s) => `<li>${s}</li>`).join('');

  if (signatures.length > 1) {
    const rows = signatures.map((sig, idx) => {
      const realEnd = Math.min(sig.endPage, sourcePageCount);
      const blankCount = sig.endPage - realEnd;
      const blankNote = blankCount > 0 ? ` <span class="hint" style="margin:0">(incl. ${blankCount} blank)</span>` : '';
      return `<tr><td>${idx + 1}</td><td>${sig.startPage}–${realEnd}${blankNote}</td><td>${sig.sheets.length}</td></tr>`;
    }).join('');
    signatureTableEl.innerHTML = `
      <table>
        <thead><tr><th>Signature</th><th>Original page range</th><th>Sheets</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p class="hint">Each signature is an independent mini-booklet in the combined PDF, one after another. Fold and staple each one separately, then gather them in order.</p>
    `;
  } else {
    signatureTableEl.innerHTML = '';
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------

function getThemeOverride() {
  try {
    const saved = localStorage.getItem('bookMakerTheme');
    return saved === 'light' || saved === 'dark' ? saved : 'system';
  } catch (_error) {
    return 'system';
  }
}
function applyPageTheme(theme) {
  if (theme === 'light' || theme === 'dark') {
    document.documentElement.setAttribute('data-theme', theme);
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
}
function setPageTheme(theme) {
  try { localStorage.setItem('bookMakerTheme', theme); } catch (_error) { /* choice just won't stick */ }
  applyPageTheme(theme);
}
applyPageTheme(getThemeOverride());

const themeCycle = document.getElementById('themeCycle');
const themeCycleTitles = {
  system: 'Theme: Auto (click for Light)',
  light: 'Theme: Light (click for Dark)',
  dark: 'Theme: Dark (click for Auto)',
};
function updateThemeCycleTitle() {
  const label = themeCycleTitles[getThemeOverride()];
  themeCycle.title = label;
  themeCycle.setAttribute('aria-label', label);
}
themeCycle.addEventListener('click', () => {
  const next = { system: 'light', light: 'dark', dark: 'system' }[getThemeOverride()];
  setPageTheme(next);
  updateThemeCycleTitle();
});
updateThemeCycleTitle();

// ---------------------------------------------------------------------
// Help popover — with focus trap and focus restoration
// ---------------------------------------------------------------------

const helpBtn = document.getElementById('helpBtn');
const helpPopover = document.getElementById('helpPopover');
const helpCloseTop = document.getElementById('helpCloseTop');
const helpCloseBtn = document.getElementById('helpCloseBtn');
let helpPreviouslyFocused = null;

function focusableElements(container) {
  return Array.from(container.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'))
    .filter((el) => el.offsetParent !== null);
}

function openHelp() {
  helpPreviouslyFocused = document.activeElement;
  helpPopover.classList.add('open');
  helpCloseTop.focus();
}
function closeHelp() {
  helpPopover.classList.remove('open');
  (helpPreviouslyFocused || helpBtn).focus();
  helpPreviouslyFocused = null;
}
helpBtn.addEventListener('click', openHelp);
helpCloseTop.addEventListener('click', closeHelp);
helpCloseBtn.addEventListener('click', closeHelp);
helpPopover.addEventListener('click', (event) => {
  if (event.target === helpPopover) closeHelp();
});
document.addEventListener('keydown', (event) => {
  if (!helpPopover.classList.contains('open')) return;
  if (event.key === 'Escape') {
    closeHelp();
    return;
  }
  if (event.key === 'Tab') {
    const focusable = focusableElements(helpPopover);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    } else if (!helpPopover.contains(document.activeElement)) {
      event.preventDefault();
      first.focus();
    }
  }
});

})();
