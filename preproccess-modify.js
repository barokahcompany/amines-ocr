const os = require('os');
const crypto = require('crypto');
const sharp = require('sharp');
const path = require('path');

const tmpBase = process.platform === 'linux' ? '/dev/shm' : os.tmpdir();
function uid() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
}

/**
 * @param {string} inputPath
 * @param {{ mode?: 'paddle'|'softgray'|'binary', width?: number, threshold?: number }} opts
 * @returns {Promise<string>} output PNG path
 */
async function writePreprocessedModify(
  inputPath,
  { mode = 'paddle', width = 1400, threshold = 150 } = {}
) {
  const out = path.join(tmpBase, `ktp_${uid()}.png`);
  let img = sharp(inputPath, { limitInputPixels: false }).rotate()
    .resize({ width, withoutEnlargement: false, kernel: 'mitchell' });

  if (mode === 'paddle') {
    // KEEP COLOR (3-channel), tanpa threshold — aman untuk PaddleOCR
    img = img
      .linear(1.12, -12)   // naikin kontras ringan tanpa clipping
      .gamma(1.02)         // sedikit brightening
      .sharpen(0.5);       // sharpen ringan
  } else if (mode === 'softgray') {
    img = img
      .grayscale()
      .normalize()
      .gamma(1.00)
      .median(1)           // noise halus
      .sharpen(0.4);       // jangan agresif
  } else if (mode === 'binary') {
    img = img
      .grayscale()
      .normalize()
      .median(1)
      .threshold(threshold) // hati-hati: ini yang bisa bikin 3->2 kalau terlalu tinggi
      .sharpen();
  }

  await img.png({ compressionLevel: 9 }).toFile(out);
  return out;
}

module.exports = { writePreprocessedModify, tmpBase };
