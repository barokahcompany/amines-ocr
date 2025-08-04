// extract.js
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
// sesudah
const Ocr = require('@gutenye/ocr-node').default;

async function extractNIKFromImage(imageBuffer) {
    // 1. Pre-processing: grayscale + threshold
    const preprocBuf = await sharp(imageBuffer)
        .grayscale()
        .threshold(150)
        .toBuffer();

    // 2. Inisialisasi OCR
    const ocr = await Ocr.create();

    // 3. Jalankan detect() pada buffer dan ambil array teks
    const result = await ocr.detect(preprocBuf);
    const texts = result.texts || [];
    const rawText = texts.map(item => item.text).join('');
    const cleaned = rawText.replace(/\s+/g, '');
    console.log(result);

    // 4. Cari pola 16 digit NIK
    const match = cleaned.match(/\d{16}/);
    if (!match) {
        throw new Error('NIK (16 digit) tidak ditemukan pada teks OCR');
    }
    return match[0];
}
module.exports = {
    extractNIKFromImage
};