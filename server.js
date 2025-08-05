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
const upload = multer({
  limits: {
    fileSize: 5 * 1024 * 1024
  }
});
const dbConfig = {
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  // port: 3306,  // kalau port custom
};
const pool = mysql.createPool(dbConfig);
// app.post("/scan-nik", upload.single("ktp"), async (req, res) => {
//   try {
//     if (!req.file) {
//       return res.status(400).json({ error: 'Upload file gambar KTP di field "ktp"' });
//     }
//     const nik = await extractNIKFromImage(req.file.buffer);
//     res.json({ nik });
//   } catch (err) {
//     res.status(422).json({ error: err.message });
//   }

// });

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

      // Handle process exit
      pythonProcess.on("close", (code) => {
        // if (code !== 0) {
        //   console.error("Python script exited with code:", code);
        //   console.error("Error Output:", errorOutput);
        //   res.status(500).json({
        //     error: "Python script execution failed",
        //     message: errorOutput
        //   })

        // } else {
        try {
          const cleanedOutput = output.trim();
          console.log("Raw Python Output:", cleanedOutput);
          const jsonResponse = JSON.parse(cleanedOutput);
          if (jsonResponse.status === false) {
            console.error("Python reported error:", jsonResponse.message);
            res.status(500).json({
              error: "Python script execution failed",
              message: jsonResponse.message,
            });
            reject(new Error(jsonResponse.message));
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
    console.log(`SELECT * FROM dpt WHERE nik = ${nik}`);

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

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST_SERVICE;
app.listen(PORT, HOST, () => {
  console.log(`API berjalan di port ${PORT}`);
});