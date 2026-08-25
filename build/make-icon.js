#!/usr/bin/env node
/**
 * Generates electron/icon.ico (and a .png for Linux/macOS use) from a
 * simple inline SVG, matching the app's blue accent branding. Dev-time
 * only — sharp/png-to-ico are devDependencies, not shipped with the app.
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const pngToIco = require('png-to-ico').default;

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'electron');
fs.mkdirSync(OUT_DIR, { recursive: true });

const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
  <rect width="256" height="256" rx="48" fill="#2c6bed"/>
  <g fill="#ffffff">
    <path d="M40 64c0-8.8 7.2-16 16-16h64c8.8 0 16 7.2 16 16v144c0-8.8-7.2-16-16-16H40V64z"/>
    <path d="M216 64c0-8.8-7.2-16-16-16h-64c-8.8 0-16 7.2-16 16v144c0-8.8 7.2-16 16-16h64V64z" opacity="0.82"/>
  </g>
  <rect x="128" y="52" width="4" height="140" fill="#214fbc"/>
</svg>
`;

(async () => {
  // png-to-ico's own writer only understands square 16/32/48/256px inputs.
  const icoSizes = [16, 32, 48, 256];
  const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'book-maker-icon-'));
  const tmpFiles = await Promise.all(
    icoSizes.map(async (size) => {
      const file = path.join(tmpDir, `icon-${size}.png`);
      await sharp(Buffer.from(svg)).resize(size, size).png().toFile(file);
      return file;
    }),
  );

  const largePng = await sharp(Buffer.from(svg)).resize(256, 256).png().toBuffer();
  fs.writeFileSync(path.join(OUT_DIR, 'icon.png'), largePng);

  const icoBuffer = await pngToIco(tmpFiles);
  fs.writeFileSync(path.join(OUT_DIR, 'icon.ico'), icoBuffer);
  fs.rmSync(tmpDir, { recursive: true, force: true });

  console.log(`Wrote electron/icon.png and electron/icon.ico (${icoSizes.join(', ')}px)`);
})();
