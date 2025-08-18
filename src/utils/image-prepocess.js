// import sharp from 'sharp';
// import path from 'path';
// import fs from 'fs/promises';
// import crypto from 'crypto';

// export async function preprocessForOcr(inputPath, { width = 1024, threshold = null } = {}) {
//   const out = path.join(path.dirname(inputPath), `prep_${crypto.randomBytes(6).toString('hex')}.png`);
//   const img = sharp(inputPath, { limitInputPixels: false }).rotate().resize({ width });

//   // pipeline ringan: grayscale + normalize + (opsional) threshold ringan
//   let pipeline = img.grayscale().normalize().gamma(1.05).sharpen();

//   if (Number.isInteger(threshold)) pipeline = pipeline.threshold(threshold);

//   await pipeline.png().toFile(out);
//   return out;
// }

// export async function toDataUrl(filePath) {
//   const b = await fs.readFile(filePath);
//   const ext = path.extname(filePath).toLowerCase();
//   const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
//              : ext === '.webp' ? 'image/webp'
//              : 'image/png';
//   return `data:${mime};base64,${b.toString('base64')}`;
// }
import sharp from 'sharp';
import path from 'path';
import fs from 'fs/promises';
import crypto from 'crypto';

export async function preprocessForOcr(
  inputPath,
  { width = 1024, quality = 70 } = {}
) {
  const out = path.join(
    path.dirname(inputPath),
    `prep_${crypto.randomBytes(6).toString('hex')}.webp`
  );

  await sharp(inputPath, { limitInputPixels: false })
    .rotate()
    .resize({ width, withoutEnlargement: true })
    .grayscale()
    // .trim(10)            // opsional: pangkas border polos bila sering ada
    .webp({ quality, effort: 4 }) // effort moderat agar cepat
    .toFile(out);

  return out;
}

export async function toDataUrl(filePath) {
  const b = await fs.readFile(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const mime = ext === '.webp' ? 'image/webp'
             : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
             : 'image/png';
  return `data:${mime};base64,${b.toString('base64')}`;
}
