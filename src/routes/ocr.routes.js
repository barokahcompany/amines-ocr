import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs/promises';
import { ktpOcr } from '../services/ktp-ocr.service.js';

const router = Router();

// simpan file upload sementara
const upload = multer({
  dest: path.join(process.cwd(), 'uploads'),
  limits: { fileSize: 2 * 1024 * 1024 }, // 6MB
  fileFilter: (req, file, cb) => {
    if (!/image\/(png|jpeg|webp)/.test(file.mimetype)) {
      return cb(new Error('File harus berupa PNG/JPG/WEBP'));
    }
    cb(null, true);
  },
});

router.post('/ktp', upload.single('ktp'), async (req, res, next) => {
  const startedAt = Date.now();
  if (!req.file) return res.status(400).json({ message: 'Field "ktp" wajib' });

  try {
    const result = await ktpOcr(req.file.path);
    // bersihkan file temp
    await fs.unlink(req.file.path).catch(() => {});
    res.json({
      status: true,
      data: result.data,
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
