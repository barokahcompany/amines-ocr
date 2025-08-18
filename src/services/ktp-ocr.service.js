import fs from 'fs/promises';
import { openai, OCR_MODEL } from './openai.service.js';
import { preprocessForOcr, toDataUrl } from '../utils/image-prepocess.js';
import { ktpJsonSchema } from '../schemas/ktp.schema.js';

// prompt instruksi khusus KTP (Bahasa Indonesia)
const SYSTEM_PROMPT = `
Kamu adalah asisten OCR untuk e-KTP Indonesia.
Ekstrak SEMUA field berikut dan KEMBALIKAN HANYA JSON sesuai schema:
- provinsi
- kabupaten_kota
- nik (16 digit tanpa spasi; jika tak terbaca, "")
- nama
- tempat_lahir
- tanggal_lahir (YYYY-MM-DD; jika sumber dd-mm-yyyy, konversi; jika tak terbaca, "")
- jenis_kelamin (normalisasi ke "LAKI-LAKI" atau "PEREMPUAN")
- gol_darah (A/B/AB/O atau "")
- alamat (baris alamat setelah "ALAMAT")
- rt (maks 3 digit; simpan string, contoh "004"; jika tak terbaca, "")
- rw (maks 3 digit; simpan string; jika tak terbaca, "")
- kelurahan_desa
- kecamatan
- agama 
- status_perkawinan (BELUM KAWIN, KAWIN, CERAI HIDUP, CERAI MATI)
- pekerjaan
- confidence_note (selalu string; jika tidak ragu, "")

Aturan:
- Pahami variasi label seperti "TTL" → tempat_lahir + tanggal_lahir.
- Format tanggal WAJIB YYYY-MM-DD bila ada tanggal.
- Untuk "RT/RW 004/007", pecah ke rt="004", rw="007".
- Gunakan penalaran kontekstual pada karakter mirip (misal "I" vs "1"), tapi hindari menebak berlebihan untuk NIK.
- Jika field tidak muncul di gambar, kirim string kosong "" untuk field tersebut.
- Output WAJIB JSON valid mengikuti schema. Tidak boleh ada teks lain.
`;

export async function ktpOcr(localPath) {
  const warnings = [];
  const t0 = process.hrtime.bigint();
  // 1) Preprocess (opsional)
  let toRead = localPath;
  try {
    toRead = await preprocessForOcr(localPath, { width: 1800, threshold: null });
  } catch {
    warnings.push('Preprocess gagal, lanjut pakai gambar asli.');
    toRead = localPath;
  }
  console.log(toRead);
  
  // 2) Data URL
  const dataUrl = await toDataUrl(toRead);

  // 3) Responses API — gunakan text.format (bukan response_format)
  const response = await openai.responses.create({
    model: OCR_MODEL, // disarankan: 'gpt-4o' untuk dukungan Structured Outputs paling stabil
    input: [
      {
        role: 'system',
        content: [{ type: 'input_text', text: SYSTEM_PROMPT }],
      },
      {
        role: 'user',
        content: [
          { type: 'input_text', text: 'Ekstrak NIK, NAMA, TEMPAT LAHIR, TANGGAL LAHIR dari KTP ini.' },
          { type: 'input_image', image_url: dataUrl, detail: 'high' },
        ],
      },
    ],
    text: {
      format: {
        // Wajib: type, name, schema (strict opsional tapi bagus)
        type: 'json_schema',
        name: 'KtpOcrExtraction',
        schema: ktpJsonSchema.schema, // ambil hanya bagian schema
        // strict: true,
      },
    },
  });
  console.log('response',response);
  
  // 4) Ambil JSON
  const textOut =
    response.output_text ??
    (response.output?.[0]?.content?.[0]?.text ?? '');

  let parsed;
  try {
    parsed = JSON.parse(textOut);
  } catch {
    const maybe = (response.output ?? [])
      .flatMap(x => x?.content ?? [])
      .map(c => c?.text)
      .find(Boolean);
    parsed = maybe ? JSON.parse(maybe) : null;
  } 

  if (!parsed) {
    throw new Error('Gagal mem-parse hasil OCR. Coba ulang atau ganti gambar.');
  }

  // 5) Cleanup & normalisasi
  await fs.unlink(toRead).catch(() => {});
  parsed.nama = parsed.nama?.replace(/\s+/g, ' ').trim();
  const t1 = process.hrtime.bigint();
  const ms = Number(t1 - t0) / 1e6;
  return { model: OCR_MODEL, data: parsed, warnings, execution_time: `${ms.toFixed(1)} ms`, };
}
