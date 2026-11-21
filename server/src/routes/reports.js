import { Router } from 'express';
import { z } from 'zod';
import { MedicalReport, MedicalSummary, StoredFile } from '../models.js';
import { HttpError, wrap, parse } from '../util.js';
import { requireUser, upload } from '../middleware.js';
import { seal, open } from '../services/crypto.js';
import { putBytes, getBytes, deleteBytes } from '../services/storage.js';
import { summariseReport, SECTION_KEYS } from '../services/summary.js';
import { audit } from '../services/notify.js';

const router = Router();
router.use(requireUser); // BR-08

const TYPES = { 'application/pdf': 'PDF', 'image/jpeg': 'JPEG', 'image/png': 'PNG' };

const present = (r) => ({ id: r._id, fileName: r.fileName, fileType: r.fileType, status: r.status, error: r.error || null, uploadedAt: r.uploadedAt });

async function ownReport(req) {
  const report = await MedicalReport.findOne({ _id: req.params.id, userId: req.user._id });
  if (!report) throw new HttpError(404, 'Report not found.');
  return report;
}

/** Runs in the background; the client polls the report status. */
export async function processReport(reportId) {
  const report = await MedicalReport.findOneAndUpdate({ _id: reportId }, { status: 'processing', error: null }, { new: true });
  if (!report) return;
  try {
    const file = await StoredFile.findById(report.fileId);
    const sections = await summariseReport({ buffer: await getBytes(file), mime: file.mime });
    await MedicalSummary.findOneAndUpdate(
      { reportId: report._id },
      { userId: report.userId, reportId: report._id, data: seal({ sections }), edited: false },
      { upsert: true },
    );
    await MedicalReport.updateOne({ _id: report._id }, { status: 'summarized' });
  } catch (err) {
    // UC-5 E2: the file stays stored and the user can retry.
    await MedicalReport.updateOne({ _id: report._id }, { status: 'failed', error: err.message || 'Summarisation failed.' });
  }
}

// FR-20
router.post('/', upload(Object.keys(TYPES)), wrap(async (req, res) => {
  if (!req.file) throw new HttpError(400, 'Choose a PDF, JPEG or PNG file to upload.');
  const file = await StoredFile.create({
    userId: req.user._id,
    ...(await putBytes({ userId: req.user._id, buffer: req.file.buffer, mime: req.file.mimetype, kind: 'reports' })),
  });
  const report = await MedicalReport.create({
    userId: req.user._id, fileId: file._id,
    fileName: (req.file.originalname || 'report').slice(0, 160), fileType: TYPES[req.file.mimetype],
  });
  await audit(req.user._id, 'report_uploaded', { detail: report.fileName });
  processReport(report._id).catch((err) => console.error('report processing failed', err));
  res.status(201).json({ report: present(report) });
}));

router.get('/', wrap(async (req, res) => {
  const reports = await MedicalReport.find({ userId: req.user._id }).sort({ uploadedAt: -1 });
  const summaries = await MedicalSummary.find({ reportId: { $in: reports.map((r) => r._id) } });
  const urgency = new Map();
  for (const s of summaries) {
    const all = Object.values(open(s.data).sections).flat();
    urgency.set(String(s.reportId), all.some((i) => i.urgency === 'red') ? 'red' : all.some((i) => i.urgency === 'amber') ? 'amber' : 'green');
  }
  res.json({ reports: reports.map((r) => ({ ...present(r), urgency: urgency.get(String(r._id)) || null })) });
}));

router.get('/:id', wrap(async (req, res) => {
  const report = await ownReport(req);
  const summary = await MedicalSummary.findOne({ reportId: report._id });
  res.json({
    report: present(report),
    summary: summary ? { sections: open(summary.data).sections, edited: summary.edited, updatedAt: summary.updatedAt } : null,
  });
}));

router.get('/:id/file', wrap(async (req, res) => {
  const report = await ownReport(req);
  const file = await StoredFile.findById(report.fileId);
  res.set('Content-Type', file.mime).set('Cache-Control', 'private, no-store').send(await getBytes(file));
}));

router.post('/:id/retry', wrap(async (req, res) => {
  const report = await ownReport(req);
  if (report.status === 'processing') throw new HttpError(409, 'This report is already being processed.');
  processReport(report._id).catch((err) => console.error('report processing failed', err));
  res.json({ report: { ...present(report), status: 'processing', error: null } });
}));

const item = z.object({
  text: z.string().trim().min(1, 'Text is required').max(600),
  urgency: z.enum(['red', 'amber', 'green']),
  confidence: z.number().min(0).max(1),
  note: z.string().trim().max(500).optional().default(''),
});
const sectionsSchema = z.object(Object.fromEntries(SECTION_KEYS.map((k) => [k, z.array(item).max(80).default([])])));

// FR-24: edits and annotations, each recorded in the audit log.
router.put('/:id/summary', wrap(async (req, res) => {
  const report = await ownReport(req);
  const summary = await MedicalSummary.findOne({ reportId: report._id });
  if (!summary) throw new HttpError(409, 'This report has no summary yet.');
  const { sections } = parse(z.object({ sections: sectionsSchema }), req.body);
  const before = open(summary.data).sections;
  const changed = SECTION_KEYS.filter((k) => JSON.stringify(before[k] || []) !== JSON.stringify(sections[k]));
  if (changed.length) {
    summary.data = seal({ sections });
    summary.edited = true;
    await summary.save();
    await audit(req.user._id, 'summary_edited', { detail: `${report.fileName}: ${changed.join(', ')}` });
  }
  res.json({ summary: { sections, edited: summary.edited, updatedAt: summary.updatedAt }, changed });
}));

router.delete('/:id', wrap(async (req, res) => {
  const report = await ownReport(req);
  const stored = await StoredFile.findById(report.fileId);
  if (stored) await deleteBytes(stored);
  await Promise.all([
    MedicalSummary.deleteOne({ reportId: report._id }),
    StoredFile.deleteOne({ _id: report.fileId }),
    MedicalReport.deleteOne({ _id: report._id }),
  ]);
  await audit(req.user._id, 'report_deleted', { detail: report.fileName });
  res.json({ deleted: true });
}));

export default router;
