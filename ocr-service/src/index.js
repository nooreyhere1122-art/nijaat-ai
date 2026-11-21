// Dedicated OCR microservice (CO-4): heavy image work stays away from the scan and SMS paths.
import express from 'express';
import multer from 'multer';
import { preprocess } from './preprocess.js';
import { createOcrWorker } from './worker.js';

const PORT = Number(process.env.PORT || 4100);
const MIN_SHARPNESS = Number(process.env.OCR_MIN_SHARPNESS || 35);
const MIN_CONFIDENCE = Number(process.env.OCR_MIN_CONFIDENCE || 25);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 12 * 1024 * 1024, files: 1 } });
const app = express();

// One worker, used by one request at a time.
let workerPromise = null;
let queue = Promise.resolve();
const getWorker = () => (workerPromise ||= createOcrWorker());

app.get('/health', (_req, res) => res.json({ ok: true }));

app.post('/ocr', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image received.' });
  let prepared;
  try {
    prepared = await preprocess(req.file.buffer);
  } catch {
    return res.status(400).json({ error: 'The file is not a readable image.' });
  }
  if (prepared.sharpness < MIN_SHARPNESS) {
    return res.status(422).json({ error: 'The image is too blurred to read. Hold the camera steady and take the photo again in good light.', sharpness: prepared.sharpness });
  }
  const job = queue.then(async () => {
    const worker = await getWorker();
    const { data } = await worker.recognize(prepared.image);
    return data;
  });
  queue = job.catch(() => {});
  try {
    const data = await job;
    const lines = String(data.text || '').split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length && data.confidence < MIN_CONFIDENCE) {
      return res.status(422).json({ error: 'The writing could not be read clearly. Take the photo again closer to the page and in good light.', confidence: data.confidence });
    }
    res.json({ text: lines.join('\n'), lines, confidence: data.confidence, skewAngle: prepared.skewAngle, sharpness: prepared.sharpness });
  } catch (err) {
    console.error('ocr failed', err);
    workerPromise = null;
    res.status(500).json({ error: 'Text recognition failed.' });
  }
});

app.listen(PORT, () => console.log(`NIJAAT AI OCR service listening on port ${PORT}`));
