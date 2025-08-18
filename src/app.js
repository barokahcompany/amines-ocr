import 'dotenv/config';
import express from 'express';
import ocrRouter from './routes/ocr.routes.js';
import { errorHandler } from './middlewares/error.js';

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use('/api/ocr', ocrRouter);
app.use(errorHandler);

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`OCR API ready on http://localhost:${port}`));
