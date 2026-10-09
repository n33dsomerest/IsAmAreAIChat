/**
 * Crop the PromptPay QR out of the tall (1080×1709) banking-app screenshots
 * in `QRCode/` and write square, scan-ready copies to `public/qr/`.
 *
 * The QR bounding box is DETECTED, not hardcoded: a QR code is a dense block
 * of neutral near-black pixels, whereas the surrounding UI (purple header,
 * coloured logos, text rows) is either coloured or sparse. We find the largest
 * contiguous run of rows/columns whose dark-pixel density crosses a threshold.
 *
 * Usage: node scripts/crop-qr.mjs
 */
import { readdir, mkdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import sharp from 'sharp';

const SRC = join(process.cwd(), 'QRCode');
const OUT = join(process.cwd(), 'public', 'qr');

/** Dark *and* unsaturated => QR-module black. Purple header is dark but saturated. */
function isQrBlack(r, g, b) {
  if (r > 90 || g > 90 || b > 90) return false;
  return Math.max(r, g, b) - Math.min(r, g, b) < 45;
}

/**
 * Longest span of entries passing `pred`, tolerating gaps of up to `maxGap`
 * misses. Needed because QR rows vary in darkness — a row that is mostly white
 * modules must not split the block in two.
 */
function longestRun(length, pred, maxGap = 0) {
  let best = null;
  let start = -1;
  let lastHit = -1;
  for (let i = 0; i <= length; i++) {
    if (i < length && pred(i)) {
      if (start === -1) start = i;
      lastHit = i;
      continue;
    }
    if (start !== -1 && i - lastHit > maxGap + 1) {
      if (!best || lastHit + 1 - start > best.end - best.start) {
        best = { start, end: lastHit + 1 };
      }
      start = -1;
    }
  }
  return best;
}

async function cropOne(file) {
  const img = sharp(join(SRC, file));
  const { width, height } = await img.metadata();
  const { data } = await img.raw().toBuffer({ resolveWithObject: true });
  const channels = data.length / (width * height);

  const darkCount = new Int32Array(width);
  const rowDark = new Int32Array(height);
  for (let y = 0; y < height; y++) {
    let n = 0;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels;
      if (isQrBlack(data[i], data[i + 1], data[i + 2])) {
        n++;
        darkCount[x]++;
      }
    }
    rowDark[y] = n;
  }

  // The QR code is the densest block of dark pixels in the frame, so use it as
  // the reference: text rows and coloured bars sit far below `max`. A fixed
  // ratio of the full width would not work — the QR only spans ~44% of it.
  const maxRow = Math.max(...rowDark);
  const DENSITY = 0.2;
  const rows = longestRun(height, (y) => rowDark[y] > maxRow * DENSITY, 20);
  if (!rows) throw new Error(`${file}: no QR row band found`);

  // Restrict the column scan to the QR row band so logos/text can't win.
  const bandH = rows.end - rows.start;
  let maxCol = 0;
  const colDark = new Float32Array(width);
  for (let x = 0; x < width; x++) colDark[x] = darkCount[x] / bandH;
  for (let x = 0; x < width; x++) if (colDark[x] > maxCol) maxCol = colDark[x];

  const cols = longestRun(width, (x) => colDark[x] > maxCol * DENSITY, 20);
  if (!cols) throw new Error(`${file}: no QR column band found`);

  // Sanity: the QR is square. A wild aspect ratio means detection locked onto
  // the wrong band (a logo, a text line) and we should fail loudly instead of
  // silently writing an unscannable image.
  const ratio = (cols.end - cols.start) / (rows.end - rows.start);
  if (ratio < 0.85 || ratio > 1.18) {
    throw new Error(
      `${file}: detected box is not square (${cols.end - cols.start}×${rows.end - rows.start})`,
    );
  }

  const box = {
    left: cols.start,
    top: rows.start,
    width: cols.end - cols.start,
    height: rows.end - rows.start,
  };

  // Square it up around the QR centre, then add a white quiet zone (~6% of the
  // side) because scanners need clear space around the code.
  const side = Math.max(box.width, box.height);
  const quiet = Math.round(side * 0.06);
  const target = side + quiet * 2;
  const left = Math.max(0, Math.round(box.left + box.width / 2 - target / 2));
  const top = Math.max(0, Math.round(box.top + box.height / 2 - target / 2));

  const name = basename(file).replace(/\.jpe?g$/i, '');
  await sharp(join(SRC, file))
    .extract({ left, top, width: target, height: target })
    .flatten({ background: '#ffffff' })
    .png({ compressionLevel: 9 })
    .toFile(join(OUT, `${name}.png`));

  return { file, srcSize: `${width}×${height}`, qrBox: `${box.width}×${box.height}`, outSize: target };
}

const files = (await readdir(SRC)).filter((f) => /\.jpe?g$/i.test(f));
await mkdir(OUT, { recursive: true });

for (const file of files) {
  const r = await cropOne(file);
  console.log(
    `${r.file.padEnd(14)} ${r.srcSize.padEnd(11)} → ${r.outSize}×${r.outSize}px  (QR core ${r.qrBox})`,
  );
}
console.log(`\n${files.length} QR written to public/qr/`);