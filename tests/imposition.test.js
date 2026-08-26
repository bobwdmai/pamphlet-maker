const test = require('node:test');
const assert = require('node:assert/strict');
const imposition = require('../src/imposition.js');

const {
  paddedCount,
  sheetsForRange,
  buildSignatures,
  balanceSignatureSizes,
  buildBalancedSignatures,
  computeHalfMargins,
  validateLayoutOptions,
  creepShiftForSheet,
  normalizeRotation,
  effectiveDimensions,
  computeRotatedPlacement,
  estimateFitScale,
  suggestFullScalePaper,
  multiplyMatrix,
  computeAppearanceMatrix,
} = imposition;

// ---------------------------------------------------------------------
// paddedCount
// ---------------------------------------------------------------------

test('paddedCount rounds up to the next multiple of 4', () => {
  assert.equal(paddedCount(0), 0);
  assert.equal(paddedCount(1), 4);
  assert.equal(paddedCount(4), 4);
  assert.equal(paddedCount(5), 8);
  assert.equal(paddedCount(8), 8);
  assert.equal(paddedCount(9), 12);
  assert.equal(paddedCount(12), 12);
  assert.equal(paddedCount(13), 16);
});

// ---------------------------------------------------------------------
// sheetsForRange — saddle-stitch ordering, uniqueness/completeness
// ---------------------------------------------------------------------

function assertCompleteAndUnique(sheets, expectedStart, expectedCount) {
  const seen = new Set();
  for (const sheet of sheets) {
    for (const p of [...sheet.front, ...sheet.back]) {
      assert.ok(!seen.has(p), `page ${p} appears more than once`);
      seen.add(p);
    }
  }
  for (let p = expectedStart; p < expectedStart + expectedCount; p++) {
    assert.ok(seen.has(p), `page ${p} is missing from the imposition`);
  }
  assert.equal(seen.size, expectedCount);
}

test('sheetsForRange: 4-page booklet matches the known saddle-stitch pattern', () => {
  const sheets = sheetsForRange(1, 4);
  assert.deepEqual(sheets, [
    { front: [4, 1], back: [2, 3] },
  ]);
  assertCompleteAndUnique(sheets, 1, 4);
});

test('sheetsForRange: 8-page booklet matches the known saddle-stitch pattern', () => {
  const sheets = sheetsForRange(1, 8);
  assert.deepEqual(sheets, [
    { front: [8, 1], back: [2, 7] },
    { front: [6, 3], back: [4, 5] },
  ]);
  assertCompleteAndUnique(sheets, 1, 8);
});

test('sheetsForRange: 12-page booklet matches the known saddle-stitch pattern', () => {
  const sheets = sheetsForRange(1, 12);
  assert.deepEqual(sheets, [
    { front: [12, 1], back: [2, 11] },
    { front: [10, 3], back: [4, 9] },
    { front: [8, 5], back: [6, 7] },
  ]);
  assertCompleteAndUnique(sheets, 1, 12);
});

test('sheetsForRange: offsets correctly for a non-first signature', () => {
  // A second signature starting at actual page 13, 8 local pages.
  const sheets = sheetsForRange(13, 8);
  assertCompleteAndUnique(sheets, 13, 8);
  assert.deepEqual(sheets[0].front, [20, 13]);
});

test('sheetsForRange rejects a count that is not a positive multiple of 4', () => {
  assert.throws(() => sheetsForRange(1, 0));
  assert.throws(() => sheetsForRange(1, 5));
  assert.throws(() => sheetsForRange(1, -4));
});

// ---------------------------------------------------------------------
// buildSignatures — multi-signature documents, padding interplay
// ---------------------------------------------------------------------

test('buildSignatures: single signature covers the whole padded document', () => {
  const sigs = buildSignatures(12, 12);
  assert.equal(sigs.length, 1);
  assert.equal(sigs[0].startPage, 1);
  assert.equal(sigs[0].endPage, 12);
  assertCompleteAndUnique(sigs.flatMap((s) => s.sheets), 1, 12);
});

test('buildSignatures: naive fill can leave a small trailing signature', () => {
  const total = paddedCount(70); // -> 72
  const sigs = buildSignatures(total, 32);
  const sizes = sigs.map((s) => s.endPage - s.startPage + 1);
  assert.deepEqual(sizes, [32, 32, 8]);
  assertCompleteAndUnique(sigs.flatMap((s) => s.sheets), 1, total);
});

test('buildSignatures: many-signature document stays complete and unique', () => {
  const total = paddedCount(130); // -> 132
  const sigs = buildSignatures(total, 16);
  assertCompleteAndUnique(sigs.flatMap((s) => s.sheets), 1, total);
  // every signature is a positive multiple of 4, none exceed the cap
  for (const sig of sigs) {
    const size = sig.endPage - sig.startPage + 1;
    assert.ok(size > 0 && size % 4 === 0);
    assert.ok(size <= 16);
  }
});

// ---------------------------------------------------------------------
// balanceSignatureSizes / buildBalancedSignatures
// ---------------------------------------------------------------------

test('balanceSignatureSizes spreads pages evenly instead of a tiny leftover', () => {
  // Naive buildSignatures(68, 32) would produce [32, 32, 4].
  const sizes = balanceSignatureSizes(68, 32);
  assert.deepEqual(sizes, [24, 24, 20]);
  assert.equal(sizes.reduce((a, b) => a + b, 0), 68);
  const spread = Math.max(...sizes) - Math.min(...sizes);
  assert.ok(spread <= 4, `sizes should differ by at most one 4-page unit, got spread ${spread}`);
});

test('balanceSignatureSizes matches naive signature count exactly', () => {
  const total = paddedCount(70); // 72
  const naiveCount = buildSignatures(total, 32).length;
  const balancedCount = balanceSignatureSizes(total, 32).length;
  assert.equal(balancedCount, naiveCount);
});

test('buildBalancedSignatures stays complete, unique, and internally valid', () => {
  const total = paddedCount(130); // 132
  const sigs = buildBalancedSignatures(total, 32);
  assertCompleteAndUnique(sigs.flatMap((s) => s.sheets), 1, total);
  for (const sig of sigs) {
    const size = sig.endPage - sig.startPage + 1;
    assert.ok(size % 4 === 0);
  }
});

test('balanceSignatureSizes rejects a non-multiple-of-4 total', () => {
  assert.throws(() => balanceSignatureSizes(70, 32));
});

// ---------------------------------------------------------------------
// computeHalfMargins — the gutter-calculation fix
// ---------------------------------------------------------------------

test('computeHalfMargins: spine-side margin is outer + gutter, not gutter alone', () => {
  const outer = 25.2; // 0.35in in points
  const gutter = 10.8; // 0.15in in points
  const leftHalf = computeHalfMargins(true, outer, gutter);
  assert.equal(leftHalf.left, outer);
  assert.equal(leftHalf.right, outer + gutter);

  const rightHalf = computeHalfMargins(false, outer, gutter);
  assert.equal(rightHalf.left, outer + gutter);
  assert.equal(rightHalf.right, outer);
});

test('computeHalfMargins: zero gutter means both edges equal the outer margin', () => {
  const half = computeHalfMargins(true, 20, 0);
  assert.equal(half.left, 20);
  assert.equal(half.right, 20);
});

// ---------------------------------------------------------------------
// validateLayoutOptions
// ---------------------------------------------------------------------

test('validateLayoutOptions accepts a normal Letter-sheet configuration', () => {
  const result = validateLayoutOptions({
    sheetWidthPt: 11 * 72,
    sheetHeightPt: 8.5 * 72,
    outerMarginPt: 0.35 * 72,
    gutterMarginPt: 0.15 * 72,
  });
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

test('validateLayoutOptions rejects negative or zero sheet dimensions', () => {
  const negWidth = validateLayoutOptions({ sheetWidthPt: -10, sheetHeightPt: 400, outerMarginPt: 10, gutterMarginPt: 5 });
  assert.equal(negWidth.valid, false);
  assert.ok(negWidth.errors.some((e) => /width/i.test(e)));

  const zeroHeight = validateLayoutOptions({ sheetWidthPt: 400, sheetHeightPt: 0, outerMarginPt: 10, gutterMarginPt: 5 });
  assert.equal(zeroHeight.valid, false);
  assert.ok(zeroHeight.errors.some((e) => /height/i.test(e)));
});

test('validateLayoutOptions rejects an absurdly oversized sheet', () => {
  const result = validateLayoutOptions({
    sheetWidthPt: 500 * 72,
    sheetHeightPt: 8.5 * 72,
    outerMarginPt: 10,
    gutterMarginPt: 5,
  });
  assert.equal(result.valid, false);
});

test('validateLayoutOptions rejects negative margins', () => {
  const result = validateLayoutOptions({
    sheetWidthPt: 11 * 72,
    sheetHeightPt: 8.5 * 72,
    outerMarginPt: -5,
    gutterMarginPt: 5,
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => /outer margin/i.test(e)));
});

test('validateLayoutOptions rejects margins that swallow a small custom sheet', () => {
  // A 4x3in sheet (within the allowed size range) with 1in margins on every
  // side leaves negative usable width per half — oversized margins, not an
  // oversized/undersized sheet, should be what triggers this error.
  const result = validateLayoutOptions({
    sheetWidthPt: 4 * 72,
    sheetHeightPt: 3 * 72,
    outerMarginPt: 1 * 72,
    gutterMarginPt: 1 * 72,
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => /width/i.test(e)));
});

// ---------------------------------------------------------------------
// creepShiftForSheet
// ---------------------------------------------------------------------

test('creepShiftForSheet: no compensation requested means no shift', () => {
  assert.equal(creepShiftForSheet(0, 5, 0), 0);
  assert.equal(creepShiftForSheet(3, 5, -1), 0);
});

test('creepShiftForSheet: single-sheet signature never shifts', () => {
  assert.equal(creepShiftForSheet(0, 1, 10), 0);
});

test('creepShiftForSheet: outermost sheet gets no shift, innermost gets the full budget', () => {
  const total = 10;
  assert.equal(creepShiftForSheet(0, total, 18), 0);
  assert.equal(creepShiftForSheet(total - 1, total, 18), 18);
});

test('creepShiftForSheet: monotonically increases from outer to inner', () => {
  const total = 6;
  const budget = 12;
  let prev = -Infinity;
  for (let i = 0; i < total; i++) {
    const shift = creepShiftForSheet(i, total, budget);
    assert.ok(shift >= prev, `shift should not decrease (index ${i})`);
    prev = shift;
  }
});

test('creepShiftForSheet: clamps an out-of-range index', () => {
  assert.equal(creepShiftForSheet(-3, 5, 10), 0);
  assert.equal(creepShiftForSheet(99, 5, 10), 10);
});

// ---------------------------------------------------------------------
// Rotated / cropped source pages
// ---------------------------------------------------------------------

test('normalizeRotation reduces any angle to 0/90/180/270', () => {
  assert.equal(normalizeRotation(0), 0);
  assert.equal(normalizeRotation(90), 90);
  assert.equal(normalizeRotation(-90), 270);
  assert.equal(normalizeRotation(450), 90);
  assert.equal(normalizeRotation(360), 0);
  assert.equal(normalizeRotation(-450), 270);
});

test('effectiveDimensions swaps width/height for 90 and 270 but not 0 or 180', () => {
  assert.deepEqual(effectiveDimensions(300, 500, 0), { width: 300, height: 500 });
  assert.deepEqual(effectiveDimensions(300, 500, 180), { width: 300, height: 500 });
  assert.deepEqual(effectiveDimensions(300, 500, 90), { width: 500, height: 300 });
  assert.deepEqual(effectiveDimensions(300, 500, 270), { width: 500, height: 300 });
  assert.deepEqual(effectiveDimensions(300, 500, -90), { width: 500, height: 300 });
});

/**
 * Independent check of computeRotatedPlacement: apply the textbook 2D CCW
 * rotation matrix to the page's four local corners around the (x, y) anchor
 * computeRotatedPlacement returns, and confirm the resulting bounding box
 * lands exactly on the intended target box. This does not reuse
 * computeRotatedPlacement's own derivation, so it would catch a sign or
 * offset error in that function, not just confirm it agrees with itself.
 */
function boundingBoxAfterRotation(pageWidth, pageHeight, scale, anchorX, anchorY, rotateDegrees) {
  const w = pageWidth * scale;
  const h = pageHeight * scale;
  const theta = (rotateDegrees * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const corners = [
    [0, 0],
    [w, 0],
    [0, h],
    [w, h],
  ].map(([lx, ly]) => [
    anchorX + (lx * cos - ly * sin),
    anchorY + (lx * sin + ly * cos),
  ]);
  const xs = corners.map((c) => c[0]);
  const ys = corners.map((c) => c[1]);
  return {
    minX: Math.min(...xs), maxX: Math.max(...xs),
    minY: Math.min(...ys), maxY: Math.max(...ys),
  };
}

function assertPlacementLandsOnTarget(rotationAngle) {
  const pageWidth = 300;
  const pageHeight = 500;
  const scale = 0.8;
  const targetX = 10;
  const targetY = 20;

  const placement = computeRotatedPlacement({
    pageWidth, pageHeight, rotationAngle, targetX, targetY, scale,
  });
  const box = boundingBoxAfterRotation(pageWidth, pageHeight, scale, placement.x, placement.y, placement.rotateDegrees);
  const eff = effectiveDimensions(pageWidth, pageHeight, rotationAngle);

  const EPS = 1e-6;
  assert.ok(Math.abs(box.minX - targetX) < EPS, `minX: expected ${targetX}, got ${box.minX}`);
  assert.ok(Math.abs(box.minY - targetY) < EPS, `minY: expected ${targetY}, got ${box.minY}`);
  assert.ok(Math.abs((box.maxX - box.minX) - eff.width * scale) < EPS, 'placed width does not match effective width');
  assert.ok(Math.abs((box.maxY - box.minY) - eff.height * scale) < EPS, 'placed height does not match effective height');
}

test('computeRotatedPlacement: 0 degrees needs no correction', () => {
  assertPlacementLandsOnTarget(0);
});

test('computeRotatedPlacement: 90-degree source rotation lands on the target box', () => {
  assertPlacementLandsOnTarget(90);
});

test('computeRotatedPlacement: 180-degree source rotation lands on the target box', () => {
  assertPlacementLandsOnTarget(180);
});

test('computeRotatedPlacement: 270-degree source rotation lands on the target box', () => {
  assertPlacementLandsOnTarget(270);
});

// ---------------------------------------------------------------------
// estimateFitScale / suggestFullScalePaper
// ---------------------------------------------------------------------

test('estimateFitScale: a full-Letter source page shrinks noticeably on a Letter sheet', () => {
  // Half of an 11x8.5in landscape Letter sheet, minus margins, is nowhere
  // near big enough to hold a full 8.5x11in portrait page at 100%.
  const scale = estimateFitScale({
    pageWidthPt: 8.5 * 72,
    pageHeightPt: 11 * 72,
    sheetWidthPt: 11 * 72,
    sheetHeightPt: 8.5 * 72,
    outerMarginPt: 0.35 * 72,
    gutterMarginPt: 0.15 * 72,
  });
  assert.ok(scale > 0 && scale < 0.7, `expected a noticeable shrink, got scale=${scale}`);
});

test('estimateFitScale: a half-letter (5.5x8.5in) page fits a Letter sheet at ~100%', () => {
  const scale = estimateFitScale({
    pageWidthPt: 5.5 * 72,
    pageHeightPt: 8.5 * 72,
    sheetWidthPt: 11 * 72,
    sheetHeightPt: 8.5 * 72,
    outerMarginPt: 0.35 * 72,
    gutterMarginPt: 0.15 * 72,
  });
  // Won't be exactly 1 (margins eat into it) but should be close, not a
  // drastic shrink like the full-Letter-on-Letter case above.
  assert.ok(scale > 0.8 && scale <= 1, `expected close to full size, got scale=${scale}`);
});

test('estimateFitScale: returns null for invalid inputs, 0 when margins consume the whole sheet', () => {
  assert.equal(estimateFitScale({ pageWidthPt: 0, pageHeightPt: 100, sheetWidthPt: 100, sheetHeightPt: 100, outerMarginPt: 0, gutterMarginPt: 0 }), null);
  const zero = estimateFitScale({
    pageWidthPt: 100, pageHeightPt: 100, sheetWidthPt: 100, sheetHeightPt: 100, outerMarginPt: 60, gutterMarginPt: 60,
  });
  assert.equal(zero, 0);
});

test('suggestFullScalePaper: recommends the smallest preset that avoids shrinking', () => {
  // With real margins, a full Letter-size (8.5x11in) source page needs
  // meaningfully more than double the paper to print at 100% — neither
  // Tabloid nor A3 is quite enough once margins are subtracted (this is
  // exactly the "your page will shrink more than you might expect" trap
  // this function exists to warn people about). Only the largest preset
  // here should qualify.
  const presets = [
    { key: 'letter', widthPt: 8.5 * 72, heightPt: 11 * 72 },
    { key: 'tabloid', widthPt: 11 * 72, heightPt: 17 * 72 },
    { key: 'a3', widthPt: 11.6929 * 72, heightPt: 16.5354 * 72 },
    { key: 'ansi_c', widthPt: 17 * 72, heightPt: 22 * 72 },
  ];
  const suggestion = suggestFullScalePaper(8.5 * 72, 11 * 72, 0.35 * 72, 0.15 * 72, presets);
  assert.equal(suggestion, 'ansi_c');
});

test('suggestFullScalePaper: returns null when nothing in the list is big enough', () => {
  const presets = [
    { key: 'letter', widthPt: 8.5 * 72, heightPt: 11 * 72 },
  ];
  const suggestion = suggestFullScalePaper(20 * 72, 30 * 72, 0.35 * 72, 0.15 * 72, presets);
  assert.equal(suggestion, null);
});

// ---------------------------------------------------------------------
// multiplyMatrix / computeAppearanceMatrix — annotation flattening math
// ---------------------------------------------------------------------

function applyMatrix([x, y], [a, b, c, d, e, f]) {
  return [x * a + y * c + e, x * b + y * d + f];
}

test('multiplyMatrix: composes translate then scale correctly', () => {
  const translate = [1, 0, 0, 1, 10, 20];
  const scale = [2, 0, 0, 3, 0, 0];
  const combined = multiplyMatrix(translate, scale);
  assert.deepEqual(applyMatrix([0, 0], combined), [20, 60]);
});

test('computeAppearanceMatrix: identity appearance matrix, translate-only fit', () => {
  const m = computeAppearanceMatrix([0, 0, 100, 100], [1, 0, 0, 1, 0, 0], [50, 50, 150, 150]);
  assert.deepEqual(applyMatrix([0, 0], m), [50, 50]);
  assert.deepEqual(applyMatrix([100, 100], m), [150, 150]);
});

test('computeAppearanceMatrix: scales a smaller BBox up to fill a bigger Rect', () => {
  const m = computeAppearanceMatrix([0, 0, 50, 50], [1, 0, 0, 1, 0, 0], [0, 0, 100, 200]);
  assert.deepEqual(applyMatrix([50, 50], m), [100, 200]);
});

test('computeAppearanceMatrix: handles a non-identity appearance Matrix (90-degree rotation)', () => {
  // A 10x20 BBox rotated 90 degrees by its own Matrix becomes a 20x10
  // "transformed appearance box"; fitting that into a 40x20 Rect should
  // map all four BBox corners exactly onto the Rect's four corners.
  const bbox = [0, 0, 10, 20];
  const rotate90 = [0, 1, -1, 0, 0, 0];
  const rect = [0, 0, 40, 20];
  const m = computeAppearanceMatrix(bbox, rotate90, rect);

  const mapped = [[0, 0], [10, 0], [0, 20], [10, 20]].map((p) => applyMatrix(p, m));
  const xs = mapped.map((p) => p[0]);
  const ys = mapped.map((p) => p[1]);
  assert.deepEqual([Math.min(...xs), Math.max(...xs)], [0, 40]);
  assert.deepEqual([Math.min(...ys), Math.max(...ys)], [0, 20]);
});

test('computeAppearanceMatrix: normalizes an out-of-order Rect', () => {
  // Rect given as [x1,y1,x0,y0] (spec allows either corner order).
  const m1 = computeAppearanceMatrix([0, 0, 10, 10], [1, 0, 0, 1, 0, 0], [0, 0, 20, 20]);
  const m2 = computeAppearanceMatrix([0, 0, 10, 10], [1, 0, 0, 1, 0, 0], [20, 20, 0, 0]);
  assert.deepEqual(m1, m2);
});
