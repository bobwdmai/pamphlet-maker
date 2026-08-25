# Book Maker

Turns a page-per-sheet PDF (for example, one exported from Google Docs via
File → Download → PDF Document) into a print-ready, saddle-stitch booklet:
pages are imposed two-per-sheet in the correct fold-and-staple order, with
margins, signature splitting, creep compensation, and manual-duplex support.

Runs entirely client-side in the browser via [pdf-lib](https://pdf-lib.js.org/).
Nothing is uploaded anywhere.

## Running it

Open `index.html` directly in a browser — no server, no build step, no
install. It loads `vendor/pdf-lib.min.js`, `src/imposition.js`, and
`src/app.js` as plain `<script>` tags.

If you'd rather hand someone a single file, see **Building the single-file
distributable** below.

## Project layout

```
index.html                 App shell — markup only, loads the scripts below
assets/styles.css           All styling
src/imposition.js           Pure imposition math (no DOM, no pdf-lib) — the
                             saddle-stitch ordering, signature balancing,
                             margin/validation, creep, and rotated/cropped
                             page placement logic. Loadable as a browser
                             <script> (window.BookMakerImposition) or via
                             require() from Node (tests use the latter).
src/app.js                  DOM wiring: file loading & drag-and-drop, options
                             form, sequential PDF generation with progress,
                             calibration sheet, layout preview, theme, help
                             dialog with focus trap.
vendor/pdf-lib.min.js        Vendored pdf-lib 1.17.1 (MIT) — unmodified.
tests/imposition.test.js     Automated tests for src/imposition.js.
build/make-dist.js           Builds dist/index.html (see below).
```

## Tests

Pure Node, no dependencies, using the built-in test runner:

```
npm test
# or directly:
node --test
```

Covers page padding, the saddle-stitch sheet ordering for 4/8/12-page and
multi-signature documents, signature balancing (vs. the naive fill that can
leave a tiny trailing signature), the gutter-margin fix, layout validation,
creep compensation, and rotated/cropped source page placement (the latter
verified against an independent rotation-matrix calculation, not just
against the implementation's own logic).

## Building the single-file distributable

```
node build/make-dist.js
```

Inlines `assets/styles.css`, `vendor/pdf-lib.min.js`, `src/imposition.js`,
and `src/app.js` into `dist/index.html` — one file, works offline, nothing
else to copy around. The structured files under `src/`/`assets/`/`vendor/`
remain the source of truth; `dist/index.html` is a generated artifact (not
committed — see `.gitignore`).

## Known limitations

- **Layout preview** shows a schematic diagram (which page number lands on
  which half of which sheet) rather than a rendering of actual page content.
  True thumbnails would need a PDF rasterizer (e.g. pdf.js) in addition to
  pdf-lib; left out to keep the tool dependency-light and build-free.
- **Cropped source pages** are only corrected when the page's cropBox has a
  (0, 0) origin — the common case (e.g. bleed trimmed from one corner of an
  otherwise normal page). A cropBox with a nonzero origin hits a pdf-lib
  quirk where shrinking the media box doesn't shift page content to
  compensate, so that rarer case is left as-is rather than "fixed" in a way
  that could make alignment worse.
- **Manual-duplex rotation/order** is a per-printer calibration problem with
  no universal answer; the calibration sheet plus the two independent
  toggles (rotate 180°, reverse order) are meant to be tried in combination
  against a real single sheet before committing a whole book to paper.
