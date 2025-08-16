const os = require('os');
const crypto = require('crypto');
const sharp = require('sharp');
const path = require('path');

const tmpBase = process.platform === 'linux' ? '/dev/shm' : os.tmpdir();

function uid() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
}

async function writePreprocessedPNG(inputPath, { width = 1800, threshold = 160 } = {}) {
  const out = path.join(tmpBase, `ktp_${uid()}.png`);
  await sharp(inputPath, { limitInputPixels: false })
    .rotate()
    .resize({ width, withoutEnlargement: false })
    .grayscale()
    .normalize()
    .gamma(1.05)
    .median(1)
    .threshold(threshold)
    .sharpen()
    .png()
    .toFile(out);
  return out;
}

module.exports = { writePreprocessedPNG, tmpBase };
