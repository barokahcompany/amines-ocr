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
  // simpan buffer ke tmp file
  const tmpPath = path.join(__dirname, req.file.originalname);
  await import("fs").then(fs => fs.promises.writeFile(tmpPath, req.file.buffer));

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
    "image": tmpPath
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

      console.error("Python stderr:", errorOutput);
      // Handle process exit
      pythonProcess.on("close", (code) => {
        console.log("code", code);

        // if (code !== 0) {
        //   console.error("Python script exited with code:", code);
        //   console.error("Error Output:", errorOutput);
        //   res.status(500).json({
        //     error: "Python script execution failed",
        //     message: errorOutput
        //   })

        // } else {
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
          const jsonResponse = JSON.parse(cleanedOutput);
          if (jsonResponse.status === false) {
            console.error("Python reported error:", jsonResponse.message);
            // res.status(500).json({
            //   error: "Python script execution failed",
            //   message: jsonResponse.message,
            // });
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
      image: tmpPath
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

    return res.json({
      success: true,
      nik,
      profile: rows.length ?
        rows[0] : null,
      ocr: ocrResult
    });
  } catch (error) {
    console.error("Failed get data:", error);
    res.status(500).json({
      error: `Failed get data ${error}`
    })
  } finally {
    fs.unlink(tmpPath, () => {});
  }

});

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
    const cleanedText = text.replace(/b/g, '6').replace(/k/g, '6');


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

  const filePath = path.resolve(req.file.path);
  const ext = path.extname(req.file.originalname);
  const filePathWithExt = filePath + ext;

  try {
    // Rename file agar ada ekstensi sesuai original file
    fs.renameSync(filePath, filePathWithExt);

    const {
      cleanedText,
      preprocessedPath
    } = await runTesseract(filePathWithExt);

    const nikMatch = cleanedText.match(/\b\d{16}\b/);

    if (nikMatch) {
      const nik = nikMatch[0];

      const [rows] = await pool.query(
        "SELECT * FROM dpt WHERE nik = ?",
        [nik]
      );

      res.json({
        success: true,
        nik,
        profile: rows.length ?
          rows[0] : null,
        ocr: nikMatch
      });

    } else {
      res.status(404).json({
        error: 'NIK tidak ditemukan di hasil scan'
      });
    }
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