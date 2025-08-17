// server.js
require('dotenv').config();
const express = require("express");
const multer = require("multer");
const {
  spawn
} = require("child_process");
const path = require("path");
const fs = require("fs");
const mysql = require("mysql2/promise");
const app = express();
const {
  createWorker
} = require('tesseract.js');
// const { createWorker } = Tesseract;
const sharp = require('sharp');
const { writePreprocessedPNG } = require('./preprocess');
const { initWorkers } = require('./pyworker'); 
const { writePreprocessedModify } = require('./preproccess-modify');

const scriptPathPython = path.join(__dirname, 'ocr-worker.py');
  const { call } = initWorkers(scriptPathPython, 2);
const upload = multer({
  dest: 'uploads/',
  limits: {
    fileSize: 5 * 1024 * 1024
  }
});
const dbConfig = {
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
};
const pool = mysql.createPool(dbConfig);

app.post("/scan-nik", upload.single("ktp"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({
      error: "Upload file di field 'ktp'"
    });
  }
  const start = process.hrtime();
  // simpan buffer ke tmp file
  const filePath = path.resolve(req.file.path);
  const ext = path.extname(req.file.originalname);
  const filePathWithExt = filePath + ext;
  fs.renameSync(filePath, filePathWithExt);
  // const tmpPath = path.join(__dirname+'/uploads/', req.file.originalname);
  // console.log(tmpPath);

  // await import("fs").then(fs => fs.promises.writeFile(tmpPath, req.file.buffer));

  const scriptPath = path.join(__dirname, "ocr.py");

  // Check if the script file exists
  if (!fs.existsSync(scriptPath)) {
    console.error("Error: Python script not found at", scriptPath);
    res.status(500).json({
      error: "Python script not found",
      message: scriptPath
    })

  }

  console.log("Executing Python script:", scriptPath);

  const body = {
    "image": filePathWithExt
  };
  console.log(body);

  function runOcr(body) {
    return new Promise((resolve, reject) => {
      const pythonProcess = spawn("python3.10", [scriptPath]);

      let output = "";
      let errorOutput = "";
      // Send JSON data to Python via stdin
      pythonProcess.stdin.write(JSON.stringify(body));
      pythonProcess.stdin.end();
      pythonProcess.stdout.on("data", (data) => {
        output += data.toString();
      });
      // Capture stderr (error messages)
      pythonProcess.stderr.on("data", (data) => {
        errorOutput += data.toString();
      });

      // Handle process exit
      pythonProcess.on("close", (code) => {
        const lines = output.trim().split("\n");
        const jsonLine = lines.find((line) => {
          try {
            return typeof JSON.parse(line) === "object";
          } catch (_) {
            return false;
          }
        });
        if (errorOutput) {
          // kalau ada pesan error di stderr, bisa log atau kirim response error
          console.error("Python stderr:", errorOutput);
          return reject(new Error(`Empty output from Python script ${errorOutput}`));
        }
        const cleanedOutput = output.trim();
        if (!cleanedOutput) {
          console.error("Python output kosong, tidak bisa parse JSON");
          return reject(new Error("Empty output from Python script"));
        }
        try {
          console.log("Raw Python Output:", cleanedOutput);
          const jsonResponse = JSON.parse(jsonLine);
          if (jsonResponse.status === false) {
            console.error("Python reported error:", jsonResponse.message);

            reject(jsonResponse);
          } else {
            // Sukses
            resolve(jsonResponse);
          }

        } catch (error) {
          console.error("JSON Parsing Error:", error);
          reject(error)
        }
        // }
      });
    });
  }

  try {
    const ocrResult = await runOcr({
      image: filePathWithExt
    });
    console.log(ocrResult);

    if (!ocrResult.status || !ocrResult.data.nik) {
      return res.status(422).json({
        error: "OCR gagal atau NIK tidak ditemukan"
      });
    }
    const nik = ocrResult.data.nik;

    const [rows] = await pool.query(
      "SELECT * FROM dpt WHERE nik = ?",
      [nik]
    );
    const end = process.hrtime(start);
    const elapsed = end[0] * 1000 + end[1] / 1e6; // ms
    return res.json({
      success: true,
      nik,
      profile: rows.length ?
        rows[0] : null,
      execution_time : `Execution time: ${elapsed.toFixed(3)} ms`,
      ocr: ocrResult
    });
  } catch (error) {
    console.error("Failed get data:", error);
    res.status(500).json({
      error: `Failed get data ${error}`
    })
  } finally {
    fs.unlink(filePathWithExt, () => {});
  }

});

app.post("/scan-ktp", upload.single("ktp"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Upload file di field 'ktp'" });

  const t0 = process.hrtime.bigint();
  const rawPath = path.resolve(req.file.path);

  // Preprocess ke PNG di RAM (atau /tmp)
  const srcPng = await writePreprocessedModify(rawPath, { mode: 'paddle', width: 1400 });

  try {
    const ocrResult = await call({ image: srcPng }); // cepat: worker persisten
    if (!ocrResult.status || !ocrResult.data?.nik) {
      return res.status(422).json({ error: "OCR gagal atau NIK tidak ditemukan", ocr: ocrResult });
    }
    const nik = ocrResult.data.nik;

    const t1 = process.hrtime.bigint();
    const ms = Number(t1 - t0) / 1e6;

    const [rows] = await pool.query(
      "SELECT * FROM dpt WHERE nik = ?",
      [nik]
    );
    res.json({
      success: true,
       profile: rows.length ?
        rows[0] : null,
      nik,
      confidence: Math.round((ocrResult.confidence ?? 0) * 100) / 100,
      execution_time: `${ms.toFixed(1)} ms`,
      ocr: ocrResult
    });
  } catch (e) {
    console.error("Failed get data:", e);
    res.status(500).json({ error: String(e) });
  } finally {
    fs.unlink(srcPng, ()=>{});
    fs.unlink(rawPath, ()=>{});
  }
});

// ---------- 1) Worker singleton (biar gak init tiap request) ----------
let workerPromise;
function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      const w = await createWorker({
        // logger: m => console.log(m) // enable saat debugging
      });
      await w.load();
      // pakai 'ind+eng' — angka tidak terpengaruh tapi kamus umum membantu segmentasi
      await w.loadLanguage('ind+eng');
      await w.initialize('ind+eng');
      return w;
    })();
  }
  return workerPromise;
}

// ---------- 2) Preprocessing utility ----------
async function preprocessToBuffer(inputPath, { rotate = 0, threshold = 160 } = {}) {
  return sharp(inputPath, { limitInputPixels: false })
    .rotate()                     // hormati EXIF
    .rotate(rotate)               // deskew kecil
    .resize({ width: 1900, withoutEnlargement: false })
    .grayscale()
    .normalize()
    .modulate({ contrast: 1.25 }) // sedikit naikkan kontras
    .median(1)
    .threshold(threshold)
    .sharpen()
    .png()
    .toBuffer();
}

// --- helper: normalisasi & validasi NIK (opsional, jika belum ada) ---
function normalizeDigits(s = '') {
  return s
    .replace(/[OoQqDd]/g, '0')
    .replace(/[Il|]/g, '1')
    .replace(/[Zz]/g, '2')
    .replace(/[Ss]/g, '5')
    .replace(/[Bb]/g, '8')
    .replace(/[Gg]/g, '6')
    .replace(/b/g, '6')
    .replace(/k/g, '6')
    .replace(/[^\d]/g, '');
}
function validNik(nik) {
  if (!/^\d{16}$/.test(nik)) return false;
  const dd = +nik.slice(6, 8), mm = +nik.slice(8, 10), yy = +nik.slice(10, 12);
  const day = dd > 40 ? dd - 40 : dd;
  if (day < 1 || day > 31) return false;
  if (mm < 1 || mm > 12) return false;
  const year = yy <= 25 ? 2000 + yy : 1900 + yy;
  return year >= 1950 && year <= 2025;
}
function pickBestNik({ text, words = [] }) {
  const byWord = (words || [])
    .map(w => ({ n: normalizeDigits(w.text || ''), c: w.confidence || 0 }))
    .filter(w => /^\d{16}$/.test(w.n))
    .sort((a, b) => b.c - a.c);
  if (byWord[0]?.n && validNik(byWord[0].n)) return byWord[0].n;

  const m = normalizeDigits(text || '').match(/\d{16}/);
  return m && validNik(m[0]) ? m[0] : null;
}

// --- MODIFIKASI: runTesseract pakai buffer, PSM 6→7, DPI 300, early-exit ---
const runTesseract2 = async (inputPath) => {
  const worker = await getWorker();

  const rotations = [-1, 0, 1];
  const thresholds = [140, 160];

  let best = { nik: null, conf: -1, debug: [] };
  await worker.load();
  try {
      for (const r of rotations) {
      for (const t of thresholds) {
        const buf = await preprocessToBuffer(inputPath, { rotate: r, threshold: t });

        // Pass A: psm 6 (blok teks)
        await worker.setParameters({
          tessedit_char_whitelist: '0123456789',
          preserve_interword_spaces: '1',
          tessedit_pageseg_mode: '6',
          user_defined_dpi: '300',
        });
        const ocrA = await worker.recognize(buf);
        const nikA = pickBestNik({ text: ocrA?.data?.text, words: ocrA?.data?.words });

        if (nikA) {
          const avgConfA = (ocrA.data.words || [])
            .filter(w => /^\d+$/.test(normalizeDigits(w.text)))
            .reduce((acc, w, _, arr) => acc + (w.confidence || 0) / (arr.length || 1), 0);

          if (avgConfA > best.conf) {
            best = {
              nik: nikA,
              conf: avgConfA,
              debug: best.debug.concat({ r, t, pass: 'A', nik: nikA, conf: avgConfA })
            };
          }
        } else {
          best.debug.push({ r, t, pass: 'A', nik: null });
        }

        if (!best.nik) {
          // Pass B: psm 7 (single line)
          await worker.setParameters({
            tessedit_char_whitelist: '0123456789',
            preserve_interword_spaces: '1',
            tessedit_pageseg_mode: '7',
            user_defined_dpi: '300',
          });
          const ocrB = await worker.recognize(buf);
          const nikB = pickBestNik({ text: ocrB?.data?.text, words: ocrB?.data?.words });

          if (nikB) {
            const avgConfB = (ocrB.data.words || [])
              .filter(w => /^\d+$/.test(normalizeDigits(w.text)))
              .reduce((acc, w, _, arr) => acc + (w.confidence || 0) / (arr.length || 1), 0);

            if (avgConfB > best.conf) {
              best = {
                nik: nikB,
                conf: avgConfB,
                debug: best.debug.concat({ r, t, pass: 'B', nik: nikB, conf: avgConfB })
              };
            }
          } else {
            best.debug.push({ r, t, pass: 'B', nik: null });
          }
        }

        // Early-exit kalau sudah cukup yakin
        if (best.nik && best.conf >= 85) {
          return best;
        }
      }
    }
  } catch (error) {
    console.log('error',error);
    
  }
  return best;
}
const runTesseract = async (inputPath) => {
  // Preprocess gambar: grayscale + normalize
  const ext = path.extname(inputPath);
  const preprocessedPath = inputPath.replace(ext, `_preprocessed${ext}`);
  await sharp(inputPath)
    .grayscale()
    .normalize()
    .toFile(preprocessedPath);

  const worker = await createWorker();

  try {
    await worker.load();

    // const { data: { text } } = await worker.recognize(preprocessedPath);
    const {
      data: {
        text
      }
    } = await worker.recognize(preprocessedPath, 'ind', {
      tessedit_char_whitelist: '0123456789'
    });
    console.log(text);

    let cleanedText = text.replace(/b/g, '6').replace(/k/g, '6');
    cleanedText = cleanedText.replace(/[a-zA-Z]/g, '');

    return {
      cleanedText,
      preprocessedPath
    };
  } finally {
    await worker.terminate();
  }
};

app.post('/upload-ktp', upload.single('ktp'), async (req, res) => {
  if (!req.file) return res.status(400).json({
    error: 'File tidak ditemukan'
  });
  const tmpPath = path.resolve(req.file.path); 
  const filePath = path.resolve(req.file.path);
  const ext = path.extname(req.file.originalname);
  const filePathWithExt = filePath + ext;

  try {
    // Rename file agar ada ekstensi sesuai original file
    // fs.renameSync(filePath, filePathWithExt);
    // const normalizedSrc = filePathWithExt.replace(ext, `_src.jpg`);
    // await sharp(normalizedSrc)
    //   .rotate()
    //   .removeAlpha()
    //   .jpeg({ quality: 92, mozjpeg: true })
    //   .toFile(normalizedSrc);

    // const { nik, conf, debug } = await runTesseract2(normalizedSrc);
    // console.log('nik', nik);
    
    const normalizedSrc = tmpPath + '_src.jpg';
    await sharp(tmpPath).rotate().removeAlpha().jpeg({ quality: 92, mozjpeg: true }).toFile(normalizedSrc);

    const { nik } = await runTesseract(normalizedSrc);

    if (!nik) {
      try { fs.unlinkSync(normalizedSrc); } catch {}
      try { fs.unlinkSync(tmpPath); } catch {}
      return res.status(404).json({ error: 'NIK tidak ditemukan di hasil scan' });
    }
    // const {
    //   cleanedText,
    //   preprocessedPath
    // } = await runTesseract(filePathWithExt);

    // const nikMatch = cleanedText.match(/\b\d{16}\b/);

    //  nik = nikMatch[0];

    const [rows] = await pool.query(
      "SELECT * FROM dpt WHERE nik = ?",
      [nik]
    );

    res.json({
      success: true,
      nik,
      confidence: Math.round(conf),
      profile: rows.length ?
        rows[0] : null,
      ocr: nikMatch
    });
    // if (nikMatch) {

    // } else {
      res.status(404).json({
        error: 'NIK tidak ditemukan di hasil scan'
      });
    // }
    // Hapus file preprocessed dan file asli
    fs.unlink(filePathWithExt, (err) => {
      if (err) console.error('Gagal hapus file asli:', err);
    });
    fs.unlink(preprocessedPath, (err) => {
      if (err) console.error('Gagal hapus file preprocessed:', err);
    });

  } catch (err) {
    // Hapus file jika ada error
    try {
      if (fs.existsSync(filePathWithExt)) fs.unlinkSync(filePathWithExt);
    } catch {}
    console.error('Error proses OCR:', err);
    res.status(500).json({
      error: 'Gagal memproses OCR',
      detail: err.message
    });
  }
});

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST_SERVICE;
app.listen(PORT, HOST, () => {
  console.log(`API berjalan di port ${PORT}`);
});