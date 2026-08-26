/**
 * Pamphlet Maker — imposition math.
 *
 * Pure functions only: no DOM, no pdf-lib. Loadable both as a browser
 * <script> (exposes `window.PamphletMakerImposition`) and via `require()` from
 * Node tests (exposes `module.exports`), so the same code that ships is the
 * code the test suite checks.
 */
(function (root, factory) {
  const mod = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = mod;
  } else {
    root.PamphletMakerImposition = mod;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------------------------------------------------------------
  // Padding / page counting
  // ---------------------------------------------------------------------

  /** Round a page count up to the next multiple of 4 (required for saddle-stitch). */
  function paddedCount(n) {
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.ceil(n / 4) * 4;
  }

  // ---------------------------------------------------------------------
  // Saddle-stitch sheet ordering
  // ---------------------------------------------------------------------

  /**
   * Build one signature's sheet list using the standard saddle-stitch
   * formula, operating on LOCAL page numbers (1..count) then offsetting to
   * ACTUAL page numbers starting at `startPageActual`. `count` must be a
   * positive multiple of 4.
   */
  function sheetsForRange(startPageActual, count) {
    if (!Number.isInteger(count) || count <= 0 || count % 4 !== 0) {
      throw new Error(`sheetsForRange: count must be a positive multiple of 4 (got ${count})`);
    }
    const sheets = [];
    const numSheets = count / 4;
    for (let i = 0; i < numSheets; i++) {
      const frontLeft = count - 2 * i;
      const frontRight = 2 * i + 1;
      const backLeft = 2 * i + 2;
      const backRight = count - 1 - 2 * i;
      sheets.push({
        front: [startPageActual + frontLeft - 1, startPageActual + frontRight - 1],
        back: [startPageActual + backLeft - 1, startPageActual + backRight - 1],
      });
    }
    return sheets;
  }

  /**
   * Split `totalPages` (a multiple of 4) into consecutive signatures of at
   * most `sigSize` pages each (sigSize itself a multiple of 4), last one
   * taking the remainder. The remainder of a multiple-of-4 total divided by
   * a multiple-of-4 signature size is itself a multiple of 4, so no page
   * ever needs re-padding here.
   */
  function buildSignatures(totalPages, sigSize) {
    const signatures = [];
    let start = 1;
    while (start <= totalPages) {
      const count = Math.min(sigSize, totalPages - start + 1);
      signatures.push({
        startPage: start,
        endPage: start + count - 1,
        sheets: sheetsForRange(start, count),
      });
      start += count;
    }
    return signatures;
  }

  /**
   * Signature sizes (in pages, each a multiple of 4) that split totalPages
   * into ceil(totalPages / maxSigSize) parts as evenly as possible, instead
   * of `buildSignatures`'s left-to-right fill which can leave a small
   * leftover final signature (e.g. 68 pages at max 32 -> [32, 32, 4]).
   */
  function balanceSignatureSizes(totalPages, maxSigSize) {
    if (totalPages <= 0) return [];
    if (!Number.isInteger(totalPages) || totalPages % 4 !== 0) {
      throw new Error(`balanceSignatureSizes: totalPages must be a positive multiple of 4 (got ${totalPages})`);
    }
    if (!Number.isInteger(maxSigSize) || maxSigSize <= 0 || maxSigSize % 4 !== 0) {
      throw new Error(`balanceSignatureSizes: maxSigSize must be a positive multiple of 4 (got ${maxSigSize})`);
    }
    const totalUnits = totalPages / 4; // one "unit" = 4 pages
    const maxUnitsPerSig = maxSigSize / 4;
    const numSigs = Math.max(1, Math.ceil(totalUnits / maxUnitsPerSig));
    const baseUnits = Math.floor(totalUnits / numSigs);
    const remainderUnits = totalUnits - baseUnits * numSigs;
    const sizes = [];
    for (let i = 0; i < numSigs; i++) {
      const units = baseUnits + (i < remainderUnits ? 1 : 0);
      sizes.push(units * 4);
    }
    return sizes;
  }

  /** Same shape as buildSignatures, but using balanced signature sizes. */
  function buildBalancedSignatures(totalPages, maxSigSize) {
    const sizes = balanceSignatureSizes(totalPages, maxSigSize);
    const signatures = [];
    let start = 1;
    for (const count of sizes) {
      signatures.push({
        startPage: start,
        endPage: start + count - 1,
        sheets: sheetsForRange(start, count),
      });
      start += count;
    }
    return signatures;
  }

  // ---------------------------------------------------------------------
  // Layout: margins, validation, creep
  // ---------------------------------------------------------------------

  /**
   * Margins (in the same unit as the inputs, typically points) for one half
   * of a sheet. The near-spine edge gets the outer margin PLUS the gutter
   * (the gutter is "extra" margin near the fold, on top of the normal
   * margin) — not the gutter alone, which was the original bug: it made the
   * spine-side margin *smaller* than the outer margin as gutter grew,
   * pulling content toward the fold instead of away from it.
   */
  function computeHalfMargins(isLeft, outerMargin, gutterMargin) {
    const spineMargin = outerMargin + gutterMargin;
    return isLeft
      ? { left: outerMargin, right: spineMargin }
      : { left: spineMargin, right: outerMargin };
  }

  /**
   * Sanity-check layout options before generating a PDF. Returns
   * { valid, errors } where errors is a list of human-readable strings.
   * Catches negative/zero sheet dimensions, absurd sheet sizes, negative
   * margins, and margins that would leave no room to draw a page.
   */
  function validateLayoutOptions(opts) {
    const errors = [];
    const { sheetWidthPt, sheetHeightPt, outerMarginPt, gutterMarginPt } = opts;

    if (!Number.isFinite(sheetWidthPt) || sheetWidthPt <= 0) {
      errors.push('Sheet width must be a positive number.');
    }
    if (!Number.isFinite(sheetHeightPt) || sheetHeightPt <= 0) {
      errors.push('Sheet height must be a positive number.');
    }
    // 2in–60in per side is a generous bound for anything a desktop/office
    // printer or large-format plotter could plausibly take.
    const MIN_SIDE_PT = 2 * 72;
    const MAX_SIDE_PT = 60 * 72;
    if (Number.isFinite(sheetWidthPt) && (sheetWidthPt < MIN_SIDE_PT || sheetWidthPt > MAX_SIDE_PT)) {
      errors.push('Sheet width must be between 2 in and 60 in.');
    }
    if (Number.isFinite(sheetHeightPt) && (sheetHeightPt < MIN_SIDE_PT || sheetHeightPt > MAX_SIDE_PT)) {
      errors.push('Sheet height must be between 2 in and 60 in.');
    }
    if (!Number.isFinite(outerMarginPt) || outerMarginPt < 0) {
      errors.push('Outer margin cannot be negative.');
    }
    if (!Number.isFinite(gutterMarginPt) || gutterMarginPt < 0) {
      errors.push('Spine/fold margin cannot be negative.');
    }

    if (
      Number.isFinite(sheetWidthPt) && sheetWidthPt > 0 &&
      Number.isFinite(sheetHeightPt) && sheetHeightPt > 0 &&
      Number.isFinite(outerMarginPt) && outerMarginPt >= 0 &&
      Number.isFinite(gutterMarginPt) && gutterMarginPt >= 0
    ) {
      const halfWidth = sheetWidthPt / 2;
      const spineMargin = outerMarginPt + gutterMarginPt;
      const availW = halfWidth - outerMarginPt - spineMargin;
      const availH = sheetHeightPt - 2 * outerMarginPt;
      const MIN_CONTENT_PT = 0.5 * 72; // at least half an inch of live area
      if (availW < MIN_CONTENT_PT) {
        errors.push('Margins leave no usable width — reduce the margins or use larger paper.');
      }
      if (availH < MIN_CONTENT_PT) {
        errors.push('Margins leave no usable height — reduce the margins or use larger paper.');
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Creep (shingling) compensation: as sheets nest inside one another, the
   * paper thickness pushes inner sheets' trim edges progressively outward.
   * This models a simple linear compensation budget spread across a
   * signature's sheets: the outermost sheet (index 0) gets no shift, the
   * innermost sheet gets the full `totalCreepPt` shift, applied by pushing
   * that sheet's live content area further from the spine.
   *
   * `sheetIndexFromOutside` is 0 for the outermost sheet of the signature.
   */
  function creepShiftForSheet(sheetIndexFromOutside, totalSheetsInSignature, totalCreepPt) {
    if (!Number.isFinite(totalCreepPt) || totalCreepPt <= 0) return 0;
    if (!Number.isFinite(totalSheetsInSignature) || totalSheetsInSignature <= 1) return 0;
    const clampedIndex = Math.max(0, Math.min(sheetIndexFromOutside, totalSheetsInSignature - 1));
    return (clampedIndex / (totalSheetsInSignature - 1)) * totalCreepPt;
  }

  // ---------------------------------------------------------------------
  // Rotated / cropped source pages
  // ---------------------------------------------------------------------

  /** Reduce any rotation angle to one of 0, 90, 180, 270. */
  function normalizeRotation(angle) {
    const a = ((Math.round(angle / 90) * 90) % 360 + 360) % 360;
    return a;
  }

  /**
   * Visual (as-displayed) width/height of a page, accounting for a
   * 90/270-degree /Rotate flag swapping the axes. pdf-lib's embedded-page
   * width/height and Page#getSize() both report the *unrotated* box, so
   * callers must swap dimensions themselves before fitting content.
   */
  function effectiveDimensions(boxWidth, boxHeight, rotationAngle) {
    const norm = normalizeRotation(rotationAngle);
    return (norm === 90 || norm === 270)
      ? { width: boxHeight, height: boxWidth }
      : { width: boxWidth, height: boxHeight };
  }

  /**
   * pdf-lib's `page.drawPage()` ignores a source page's stored /Rotate
   * value entirely — it composites the raw, unrotated content. To reproduce
   * the page's real on-screen appearance we have to rotate it back in
   * manually: pass `rotateDegrees` as the `rotate` option to drawPage, and
   * `x`/`y` as its position, instead of the naive (targetX, targetY).
   *
   * drawPage's `rotate` option turns the content counter-clockwise around
   * (x, y); a PDF /Rotate value is a CLOCKWISE on-screen rotation, so the
   * angle we pass is the negation of the page's rotation. The x/y offsets
   * below compensate for the anchor point moving as the box turns, derived
   * from the standard 2D rotation matrix (see tests/imposition.test.js for
   * an independent numeric check against that matrix).
   *
   * `pageWidth`/`pageHeight` are the page's own (unrotated) box dimensions;
   * `scale` is the uniform scale about to be applied via xScale/yScale.
   */
  function computeRotatedPlacement({ pageWidth, pageHeight, rotationAngle, targetX, targetY, scale }) {
    const norm = normalizeRotation(rotationAngle);
    const w = pageWidth * scale;
    const h = pageHeight * scale;
    switch (norm) {
      case 90:
        return { x: targetX, y: targetY + w, rotateDegrees: -90 };
      case 180:
        return { x: targetX + w, y: targetY + h, rotateDegrees: 180 };
      case 270:
        return { x: targetX + h, y: targetY, rotateDegrees: -270 };
      default:
        return { x: targetX, y: targetY, rotateDegrees: 0 };
    }
  }

  // ---------------------------------------------------------------------
  // Fit-scale estimate — how much a source page shrinks to fit its half-sheet
  // ---------------------------------------------------------------------

  /**
   * A page is scaled uniformly to fit its half of the sheet, so text and
   * images shrink together — there's no way to keep text full-size while
   * only images shrink (that would mean re-typesetting the document, not
   * imposing it). This estimates that scale factor up front, using the
   * outer/gutter margins of a left-hand half (close enough for a heads-up
   * warning; the real per-page placement in drawImposedSide accounts for
   * rotation and exact left/right margins).
   */
  function estimateFitScale({ pageWidthPt, pageHeightPt, sheetWidthPt, sheetHeightPt, outerMarginPt, gutterMarginPt }) {
    if (!Number.isFinite(pageWidthPt) || !Number.isFinite(pageHeightPt) || pageWidthPt <= 0 || pageHeightPt <= 0) return null;
    if (!Number.isFinite(sheetWidthPt) || !Number.isFinite(sheetHeightPt) || sheetWidthPt <= 0 || sheetHeightPt <= 0) return null;
    const halfWidth = sheetWidthPt / 2;
    const margins = computeHalfMargins(true, outerMarginPt, gutterMarginPt);
    const availW = halfWidth - margins.left - margins.right;
    const availH = sheetHeightPt - 2 * outerMarginPt;
    if (availW <= 0 || availH <= 0) return 0;
    return Math.min(availW / pageWidthPt, availH / pageHeightPt);
  }

  /**
   * Among a list of { key, widthPt, heightPt } sheet presets, the smallest
   * one (by area) that would let a page of the given size print at 100%
   * scale (no shrink) with the given margins — or null if none of them fit.
   * Presets are tried in both orientations since the caller always ends up
   * printing landscape (the longer side becomes sheetWidthPt).
   */
  function suggestFullScalePaper(pageWidthPt, pageHeightPt, outerMarginPt, gutterMarginPt, presets) {
    let best = null;
    for (const preset of presets) {
      const sheetWidthPt = Math.max(preset.widthPt, preset.heightPt);
      const sheetHeightPt = Math.min(preset.widthPt, preset.heightPt);
      const scale = estimateFitScale({ pageWidthPt, pageHeightPt, sheetWidthPt, sheetHeightPt, outerMarginPt, gutterMarginPt });
      if (scale !== null && scale >= 1) {
        const area = sheetWidthPt * sheetHeightPt;
        if (!best || area < best.area) best = { key: preset.key, area };
      }
    }
    return best ? best.key : null;
  }

  /**
   * pdf-lib's default page-embedding assumes a page's visible area starts at
   * (0, 0) — its BBox math is `left: 0, bottom: 0, right: width, top:
   * height`, ignoring the mediaBox's actual origin entirely. Any page whose
   * mediaBox does NOT start at (0, 0) — confirmed in a real-world file,
   * every single page — then embeds with content shifted/clipped wrong.
   *
   * The fix is to always pass pdf-lib's embedder an *explicit* bounding box
   * built from the page's own true geometry, instead of taking its buggy
   * default. This also subsumes the separate old "flatten a same-origin
   * cropBox into the mediaBox" workaround: a cropBox is just another
   * bounding box, at any origin, and passing it directly here handles that
   * case in general instead of only when its origin happens to be zero.
   *
   * `mediaBox`/`cropBox` are { x, y, width, height }; returns
   * { left, bottom, right, top } — the shape pdf-lib's embedPage(s) expects.
   */
  function chooseEmbedBoundingBox(mediaBox, cropBox) {
    const box = (cropBox && cropBoxDiffers(mediaBox, cropBox)) ? cropBox : mediaBox;
    return { left: box.x, bottom: box.y, right: box.x + box.width, top: box.y + box.height };
  }

  function cropBoxDiffers(mediaBox, cropBox) {
    const EPS = 0.01;
    return Math.abs(mediaBox.x - cropBox.x) > EPS || Math.abs(mediaBox.y - cropBox.y) > EPS ||
      Math.abs(mediaBox.width - cropBox.width) > EPS || Math.abs(mediaBox.height - cropBox.height) > EPS;
  }

  // ---------------------------------------------------------------------
  // Annotation appearance flattening
  // ---------------------------------------------------------------------
  //
  // pdf-lib's page-embedding (used by embedPdf/drawPage) copies only a
  // page's /Contents and /Resources — it silently drops /Annots entirely.
  // A PDF where visible text was added as an annotation rather than drawn
  // into the content stream (e.g. a FreeText "comment"/"typewriter" note
  // from a tool like PDF-XChange Editor — confirmed against a real
  // user file) simply vanishes when imposed. The fix is to flatten each
  // annotation's normal appearance stream into the page's actual content
  // before embedding. This is the pure math for that: given the appearance
  // stream's own BBox and Matrix, and the annotation's Rect, compute the
  // single `cm` matrix that draws that appearance in the right place — the
  // standard algorithm from the PDF spec (12.5.5, "Appearance Streams").

  /** Standard PDF (row-vector) 2D affine matrix composition: apply m1, then m2. */
  function multiplyMatrix(m1, m2) {
    const [a1, b1, c1, d1, e1, f1] = m1;
    const [a2, b2, c2, d2, e2, f2] = m2;
    return [
      a1 * a2 + b1 * c2,
      a1 * b2 + b1 * d2,
      c1 * a2 + d1 * c2,
      c1 * b2 + d1 * d2,
      e1 * a2 + f1 * c2 + e2,
      e1 * b2 + f1 * d2 + f2,
    ];
  }

  /**
   * The `cm` matrix to draw an annotation's appearance XObject at the right
   * place: transform the appearance stream's BBox corners by its own
   * Matrix to get the "transformed appearance box", then find the
   * scale+translate that maps that box onto the annotation's Rect (per the
   * PDF spec — no rotation at this step, just fit by scaling), and combine
   * that with the appearance's own Matrix into one matrix for the content
   * stream's `cm` operator.
   */
  function computeAppearanceMatrix(bbox, matrix, rect) {
    const [bx0, by0, bx1, by1] = bbox;
    const m = matrix || [1, 0, 0, 1, 0, 0];
    const corners = [[bx0, by0], [bx1, by0], [bx0, by1], [bx1, by1]].map(
      ([x, y]) => [x * m[0] + y * m[2] + m[4], x * m[1] + y * m[3] + m[5]],
    );
    const txs = corners.map((c) => c[0]);
    const tys = corners.map((c) => c[1]);
    const tx0 = Math.min(...txs), tx1 = Math.max(...txs);
    const ty0 = Math.min(...tys), ty1 = Math.max(...tys);

    const [rx0raw, ry0raw, rx1raw, ry1raw] = rect;
    const rx0 = Math.min(rx0raw, rx1raw), rx1 = Math.max(rx0raw, rx1raw);
    const ry0 = Math.min(ry0raw, ry1raw), ry1 = Math.max(ry0raw, ry1raw);

    const tw = tx1 - tx0, th = ty1 - ty0;
    const sx = tw > 1e-9 ? (rx1 - rx0) / tw : 1;
    const sy = th > 1e-9 ? (ry1 - ry0) / th : 1;
    const fitMatrix = [sx, 0, 0, sy, rx0 - tx0 * sx, ry0 - ty0 * sy];

    return multiplyMatrix(m, fitMatrix);
  }

  return {
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
    chooseEmbedBoundingBox,
  };
});
