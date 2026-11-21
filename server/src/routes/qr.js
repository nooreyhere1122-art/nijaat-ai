import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { QRCode, QRLog, ScanEvent, SMSAlert } from '../models.js';
import { HttpError, wrap, parse } from '../util.js';
import { requireUser } from '../middleware.js';
import { loadProfile, missingFields } from '../services/profile.js';
import { sha256, randomToken, encryptBuffer, decryptBuffer } from '../services/crypto.js';
import { audit } from '../services/notify.js';

const router = Router();
router.use(requireUser);

const urlFor = (qr) => `${config.clientUrl}/e/${decryptBuffer(qr.tokenEnc).toString('utf8')}`;

/**
 * The printed code carries a permanent random identifier. Only its hash is indexed;
 * the code stays valid until the owner deactivates or regenerates it.
 */
async function createQr(userId, action) {
  const token = randomToken(16);
  const qr = await QRCode.create({ userId, tokenHash: sha256(token), tokenEnc: encryptBuffer(Buffer.from(token, 'utf8')) });
  await QRLog.create({ userId, qrId: qr._id, action });
  return qr;
}

const present = (qr) => qr && ({
  id: qr._id, status: qr.status, url: qr.status === 'active' ? urlFor(qr) : null,
  createdAt: qr.createdAt, deactivatedAt: qr.deactivatedAt || null,
  downloadCount: qr.downloadCount, scanCount: qr.scanCount,
});

const latest = (userId) => QRCode.findOne({ userId }).sort({ createdAt: -1 });

router.get('/', wrap(async (req, res) => {
  const { data } = await loadProfile(req.user._id);
  const qr = await latest(req.user._id);
  const totalScans = await ScanEvent.countDocuments({ userId: req.user._id, source: { $ne: 'self' } });
  res.json({ qr: present(qr), status: qr ? qr.status : 'not_generated', missing: missingFields(data), totalScans });
}));

// FR-08: generated once the profile is complete.
router.post('/generate', wrap(async (req, res) => {
  const { data } = await loadProfile(req.user._id);
  const missing = missingFields(data);
  if (missing.length) throw new HttpError(400, 'Complete your medical profile before generating a QR code.', { missing });
  const current = await QRCode.findOne({ userId: req.user._id, status: 'active' });
  if (current) return res.json({ qr: present(current) });
  const qr = await createQr(req.user._id, 'generated');
  await audit(req.user._id, 'qr_generated');
  res.status(201).json({ qr: present(qr) });
}));

// FR-12
router.post('/deactivate', wrap(async (req, res) => {
  const qr = await QRCode.findOne({ userId: req.user._id, status: 'active' });
  if (!qr) throw new HttpError(400, 'There is no active QR code to deactivate.');
  qr.status = 'deactivated';
  qr.deactivatedAt = new Date();
  await qr.save();
  await QRLog.create({ userId: req.user._id, qrId: qr._id, action: 'deactivated' });
  await audit(req.user._id, 'qr_deactivated');
  res.json({ qr: present(qr) });
}));

router.post('/regenerate', wrap(async (req, res) => {
  const { data } = await loadProfile(req.user._id);
  const missing = missingFields(data);
  if (missing.length) throw new HttpError(400, 'Complete your medical profile before generating a QR code.', { missing });
  const old = await QRCode.findOne({ userId: req.user._id, status: 'active' });
  if (old) {
    old.status = 'deactivated';
    old.deactivatedAt = new Date();
    await old.save();
    await QRLog.create({ userId: req.user._id, qrId: old._id, action: 'deactivated', detail: 'Replaced by a new code' });
  }
  const qr = await createQr(req.user._id, 'regenerated');
  await audit(req.user._id, 'qr_regenerated');
  res.status(201).json({ qr: present(qr) });
}));

// FR-10: the image is rendered in the browser; the download is logged here.
router.post('/download-log', wrap(async (req, res) => {
  const { format } = parse(z.object({ format: z.enum(['PNG', 'JPEG', 'PDF']) }), req.body);
  const qr = await QRCode.findOneAndUpdate({ userId: req.user._id, status: 'active' }, { $inc: { downloadCount: 1 } }, { new: true });
  if (!qr) throw new HttpError(400, 'There is no active QR code.');
  await QRLog.create({ userId: req.user._id, qrId: qr._id, action: 'downloaded', detail: format });
  res.json({ downloadCount: qr.downloadCount });
}));

// FR-12 log, FR-13 scan counter and recent scans.
router.get('/activity', wrap(async (req, res) => {
  const userId = req.user._id;
  const [totalScans, scans, log, tests] = await Promise.all([
    ScanEvent.countDocuments({ userId, source: { $ne: 'self' } }),
    ScanEvent.find({ userId }).sort({ scannedAt: -1 }).limit(50),
    QRLog.find({ userId }).sort({ at: -1 }).limit(100),
    SMSAlert.find({ userId, kind: 'test' }).sort({ at: -1 }).limit(1),
  ]);
  const alerts = await SMSAlert.find({ scanEventId: { $in: scans.map((s) => s._id) }, kind: 'emergency' }).sort({ at: 1 });
  const bySc = new Map();
  for (const a of alerts) {
    const key = String(a.scanEventId);
    if (!bySc.has(key)) bySc.set(key, []);
    bySc.get(key).push({ contactName: a.contactName, recipientNumber: a.recipientNumber, attempt: a.attempt, status: a.status, errorCode: a.errorCode || null, at: a.at });
  }
  res.json({
    totalScans,
    lastTestSmsAt: tests[0]?.at || null,
    scans: scans.map((s) => ({
      id: s._id, scannedAt: s.scannedAt, alertStatus: s.alertStatus, source: s.source || 'scan',
      latitude: s.latitude ?? null, longitude: s.longitude ?? null,
      sms: bySc.get(String(s._id)) || [],
    })),
    log: log.map((l) => ({ action: l.action, detail: l.detail || null, at: l.at })),
  });
}));

export default router;
