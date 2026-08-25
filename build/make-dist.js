#!/usr/bin/env node
/**
 * Inlines assets/styles.css, vendor/pdf-lib.min.js, src/imposition.js, and
 * src/app.js into a single self-contained dist/index.html. Plain string
 * substitution, no bundler — the whole point is to keep the app build-free
 * while still being able to hand someone one portable file.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

let html = read('index.html');

// NB: String.replace(pattern, replacementString) treats "$&", "$'", "$`",
// "$$", "$<name>" specially *in the replacement string* — and a minified
// JS bundle like pdf-lib's is exactly the kind of content likely to
// contain a literal "$&" or similar sequence. Always pass a replacer
// *function* here, never a plain string, or inlining can silently mangle
// the injected source.
const replaceOnce = (haystack, target, replacement) => {
  if (!haystack.includes(target)) {
    throw new Error(`make-dist: could not find ${JSON.stringify(target)} in index.html`);
  }
  return haystack.replace(target, () => replacement);
};

const css = read('assets/styles.css');
html = replaceOnce(
  html,
  '<link rel="stylesheet" href="assets/styles.css">',
  `<style>\n${css}\n</style>`,
);

const inlineScript = (relPath, marker) => {
  const src = read(relPath);
  const tag = `<script src="${marker}"></script>`;
  html = replaceOnce(html, tag, `<script>\n${src}\n</script>`);
};

inlineScript('vendor/pdf-lib.min.js', 'vendor/pdf-lib.min.js');
inlineScript('src/imposition.js', 'src/imposition.js');
inlineScript('src/app.js', 'src/app.js');

fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'dist', 'index.html'), html);

console.log(`Wrote dist/index.html (${(html.length / 1024).toFixed(0)} KB)`);
