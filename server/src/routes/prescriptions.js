import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { Prescription, StoredFile } from '../models.js';
import { HttpError, wrap, parse } from '../util.js';
import { requireUser, upload } from '../middleware.js';
import { seal, open } from '../services/crypto.js';
import { putBytes, getBytes, deleteBytes } from '../services/storage.js';
import { parseMedications } from '../services/prescriptionParser.js';
import { loadProfile, saveProfile } from '../services/profile.js';
import { audit } from '../services/notify.js';

const router = Router();
router.use(requireUser); // BR-08

let ocrOverride = null;
export const setOcrOverride = (fn) => { ocrOverride = fn; };

/** Calls the dedicated OCR microservice (CO-4). Returns { text, lines, confidence }. */
async function runOcr(buffer, mime, fileName) {
  if (ocrOverride) return ocrOverride(buffer, mime);
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: mime }), fileName || 'prescription');
  let res;
  try {
    res = await fetch(`${config.ocrServiceUrl}/ocr`, { method: 'POST', body: form, signal: AbortSignal.timeout(120_000) });
  } catch {
    throw new HttpError(503, 'The prescription reader is not available right now. Please try again shortly.', { code: 'OCR_UNAVAILABLE' });
  }
  const json = await res.json().catch(() => ({}));
  if (res.status === 422) throw new HttpError(422, json.error || 'The image is too blurred to read. Take the photo again in good light.', { code: 'IMAGE_BLURRED' });
  if (!res.ok) throw new HttpError(503, 'The prescription reader could not process this image.', { code: 'OCR_UNAVAILABLE' });
  return json;
}

const present = (p, data) => ({
  id: p._id, verified: p.verified, uploadedAt: p.uploadedAt, verifiedAt: p.verifiedAt || null,
  refillDate: p.refillDate || null, medications: data.medications, extractedText: data.extractedText,
});

async function own(req) {
  const p = await Prescription.findOne({ _id: req.params.id, userId: req.user._id });
  if (!p) throw new HttpError(404, 'Prescription not found.');
  return p;
}

// FR-37 to FR-39, FR-41. Nothing is added to the medication list until the user verifies (BR-07).
router.post('/', upload(['image/jpeg', 'image/png', 'image/webp']), wrap(async (req, res) => {
  if (!req.file) throw new HttpError(400, 'Choose or capture an image of the prescription.');
  const ocr = await runOcr(req.file.buffer, req.file.mimetype, req.file.originalname);
  const medications = parseMedications(ocr.lines || String(ocr.text || '').split('\n'));
  // UC-6 E2: report the failure without saving.
  if (!medications.length) {
    throw new HttpError(422, 'No medication could be read from this image. Try a clearer photo that shows the whole prescription.', { code: 'NO_MEDICATION', extractedText: ocr.text || '' });
  }
  const file = await StoredFile.create({
    userId: req.user._id,
    ...(await putBytes({ userId: req.user._id, buffer: req.file.buffer, mime: req.file.mimetype, kind: 'prescriptions' })),
  });
  const data = { extractedText: ocr.text || '', medications, ocrConfidence: ocr.confidence ?? null };
  const prescription = await Prescription.create({ userId: req.user._id, fileId: file._id, data: seal(data) });
  res.status(201).json({ prescription: present(prescription, data) });
}));

// FR-42: history with refill reminders.
router.get('/', wrap(async (req, res) => {
  const list = await Prescription.find({ userId: req.user._id }).sort({ uploadedAt: -1 });
  res.json({ prescriptions: list.map((p) => present(p, open(p.data))) });
}));

router.get('/:id', wrap(async (req, res) => {
  const p = await own(req);
  res.json({ prescription: present(p, open(p.data)) });
}));

router.get('/:id/image', wrap(async (req, res) => {
  const p = await own(req);
  const file = await StoredFile.findById(p.fileId);
  res.set('Content-Type', file.mime).set('Cache-Control', 'private, no-store').send(await getBytes(file));
}));

const medication = z.object({
  name: z.string().trim().min(1, 'Medication name is required').max(200),
  dosage: z.string().trim().max(100).optional().default(''),
  frequency: z.string().trim().max(100).optional().default(''),
  duration: z.string().trim().max(100).optional().default(''),
});
const refill = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD').nullable().optional();

// FR-40, FR-42: the user confirms or corrects every entry; only then is it saved to the medication list.
router.put('/:id/verify', wrap(async (req, res) => {
  const p = await own(req);
  const body = parse(z.object({
    medications: z.array(medication).min(1, 'Keep at least one medication, or discard the prescription').max(40),
    refillDate: refill,
  }), req.body);
  const data = open(p.data);
  const wasVerified = p.verified;
  data.medications = body.medications;
  p.data = seal(data);
  p.verified = true;
  p.verifiedAt = new Date();
  p.refillDate = body.refillDate ? new Date(body.refillDate) : undefined;
  await p.save();

  const { data: profile } = await loadProfile(req.user._id);
  const others = profile.medications.filter((m) => m.prescriptionId !== String(p._id));
  const added = body.medications.map((m) => ({
    ...m, active: true, source: 'prescription', prescriptionId: String(p._id), addedAt: p.uploadedAt.toISOString(),
  }));
  await saveProfile(req.user._id, { ...profile, medications: [...others, ...added] });
  await audit(req.user._id, wasVerified ? 'prescription_updated' : 'prescription_verified', { detail: `${added.length} medications` });
  res.json({ prescription: present(p, data) });
}));

router.put('/:id/refill', wrap(async (req, res) => {
  const p = await own(req);
  const body = parse(z.object({ refillDate: refill }), req.body);
  p.refillDate = body.refillDate ? new Date(body.refillDate) : undefined;
  await p.save();
  res.json({ prescription: present(p, open(p.data)) });
}));

router.delete('/:id', wrap(async (req, res) => {
  const p = await own(req);
  const { data: profile } = await loadProfile(req.user._id);
  if (profile.medications.some((m) => m.prescriptionId === String(p._id))) {
    await saveProfile(req.user._id, { ...profile, medications: profile.medications.filter((m) => m.prescriptionId !== String(p._id)) });
  }
  const stored = await StoredFile.findById(p.fileId);
  if (stored) await deleteBytes(stored);
  await Promise.all([StoredFile.deleteOne({ _id: p.fileId }), Prescription.deleteOne({ _id: p._id })]);
  await audit(req.user._id, 'prescription_deleted');
  res.json({ deleted: true });
}));

export default router;
