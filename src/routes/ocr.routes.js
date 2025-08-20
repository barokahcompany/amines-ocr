import {
  Router
} from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs/promises';
import {
  ktpOcr
} from '../services/ktp-ocr.service.js';
import mysql from "mysql2/promise"
import 'dotenv/config';
const router = Router();
const dbConfig = {
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
};
const pool = mysql.createPool(dbConfig);

// simpan file upload sementara
const upload = multer({
  dest: path.join(process.cwd(), 'uploads'),
  limits: {
    fileSize: 2 * 1024 * 1024
  }, // 6MB
  fileFilter: (req, file, cb) => {
    if (!/image\/(png|jpeg|webp)/.test(file.mimetype)) {
      return cb(new Error('File harus berupa PNG/JPG/WEBP'));
    }
    cb(null, true);
  },
});

router.post('/ktp', upload.single('ktp'), async (req, res, next) => {
  const startedAt = Date.now();

  function hasValue(value) {
    return typeof value === 'string' && value.trim().length > 0;
  }

  function normalizeDate(dateStr) {
    const [d, m, y] = dateStr.split('|');
    const dd = String(d).padStart(2, '0');
    const mm = String(m).padStart(2, '0');
    return `${y}-${mm}-${dd}`;
  }

  function formatKtpRtRw(input) {
    const num = parseInt(input, 10);
    if (isNaN(num)) return '000'; // fallback jika input tidak valid
    return num.toString().padStart(3, '0');
  }
  if (!req.file) return res.status(400).json({
    message: 'Field "ktp" wajib'
  });

  try {
    const result = await ktpOcr(req.file.path);
    // bersihkan file temp
    await fs.unlink(req.file.path).catch(() => {});
    let tmpData = {};
    const nik = result.data.nik;
    if (nik.length == 16) {
      const [rows] = await pool.query(
        "SELECT * FROM dpt WHERE nik = ?",
        [nik]
      );
      console.log(rows);
      
      if (rows.length) {
        const dbData = rows[0];
        tmpData = {
          nik: dbData.nik,
          nama: dbData.nama,
          alamat: dbData.alamat,
          tempat_lahir: dbData.tempat_lahir,
          tanggal_lahir: normalizeDate(dbData.tanggal_lahir),
          jenis_kelamin: (dbData.jenis_kelamin == "L" ? "LAKI-LAKI" : "PEREMPUAN"),
          rt: formatKtpRtRw(String(dbData.rt)),
          rw: formatKtpRtRw(String(dbData.rw)),
          provinsi: "",
          kabupaten_kota: "",
          gol_darah: "",
          kelurahan_desa: dbData.kelurahan,
          kecamatan: dbData.kecamatan,
          agama: "",
          status_perkawinan: "",
          pekerjaan: "",
          confidance_note: result.data.confidence_note,
        }
      }else {
        tmpData = {
          nik: "",
          nama: "",
          alamat: "",
          tempat_lahir: "",
          tanggal_lahir: "",
          jenis_kelamin: "",
          rt: "",
          rw: "",
          provinsi: "",
          kabupaten_kota: "",
          gol_darah: "",
          kelurahan_desa: "",
          kecamatan: "",
          agama: "",
          status_perkawinan: "",
          pekerjaan: "",
          confidance_note: result.data.confidence_note,
        }
      }
    }
    res.json({
      status: true,
      data: tmpData,
      meta: {
        model: result.model,
        elapsed_ms: Date.now() - startedAt,
        warnings: result.warnings,
        execution_time: result.execution_time,
      },
    });
  } catch (err) {
    await fs.unlink(req.file.path).catch(() => {});
    next(err);
  }
});

export default router;