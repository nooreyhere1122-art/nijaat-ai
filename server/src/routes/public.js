import { Router } from 'express';
import { z } from 'zod';
import { config, devMode } from '../config.js';
import {
  QRCode, ScanEvent, User, PhysicianAccessCode, PhysicianSession, MedicalReport, MedicalSummary, Prescription,
} from '../models.js';
import { HttpError, wrap, parse } from '../util.js';
import {
  requireScanSession, signScanSession, requirePhysician, signPhysicianSession, publicLimiter,
} from '../middleware.js';
import { sha256, hmac, randomToken, randomDigits, safeEqual, open } from '../services/crypto.js';
import { loadProfile, emergencyView } from '../services/profile.js';
import { scheduleAlert, cancelAlert, alertStatusFor, sendWithRetry } from '../services/alert.js';
import { audit } from '../services/notify.js';

const router = Router();
router.use(publicLimiter);

const coords = {
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
};
// Approximate location only (FR-17): about 100 m precision.
const approx = (n) => (n == null ? undefined : Math.round(n * 1000) / 1000);

async function sessionPayload(event) {
  const user = await User.findById(event.userId);
  const { data } = await loadProfile(event.userId);
  return {
    session: signScanSession(event),
    scanEventId: event._id,
    scannedAt: event.scannedAt,
    profile: emergencyView(user, data),
    alert: await alertStatusFor(event),
    location: event.latitude != null ? { latitude: event.latitude, longitude: event.longitude } : null,
  };
}

/**
 * FR-15, FR-16, FR-17, FR-14. No login.
 * 1. The permanent identifier from the printed code is looked up by hash and must be active.
 * 2. A scan event is logged and the alert is scheduled after the cancel buffer.
 * 3. A time-limited session hash is returned and required on every later request.
 */
router.post('/scan', wrap(async (req, res) => {
  const body = parse(z.object({ token: z.string().min(8).max(64), ...coords }), req.body);
  const qr = await QRCode.findOne({ tokenHash: sha256(body.token) });
  if (!qr) throw new HttpError(404, 'This QR code is not recognised. It may be damaged or not a NIJAAT AI code.', { code: 'QR_INVALID' });
  if (qr.status !== 'active') throw new HttpError(410, 'This QR code has been deactivated by its owner.', { code: 'QR_DEACTIVATED' });

  // A reload or second request from the same device must not send a second alert.
  const since = new Date(Date.now() - config.scanDedupeMinutes * 60_000);
  let event = await ScanEvent.findOne({ qrId: qr._id, ip: req.ip, scannedAt: { $gt: since }, alertStatus: { $ne: 'cancelled' } }).sort({ scannedAt: -1 });
  if (!event) {
    event = await ScanEvent.create({
      qrId: qr._id, userId: qr.userId, ip: req.ip,
      latitude: approx(body.latitude), longitude: approx(body.longitude),
      dispatchAt: new Date(Date.now() + config.alertBufferMs),
      viewToken: randomToken(12),
    });
    await QRCode.updateOne({ _id: qr._id }, { $inc: { scanCount: 1 } });
    await audit(qr.userId, 'qr_scanned', { actorType: 'bystander' });
    scheduleAlert(event);
  }
  res.status(201).json(await sessionPayload(event));
}));

// Polled by the emergency profile for the countdown and the alert status (FR-19).
router.get('/session', requireScanSession, wrap(async (req, res) => {
  res.json(await sessionPayload(req.scanEvent));
}));

// FR-30: location can arrive after consent, while the alert is still pending.
router.post('/location', requireScanSession, wrap(async (req, res) => {
  const body = parse(z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) }), req.body);
  const event = req.scanEvent;
  if (event.latitude == null) {
    event.latitude = approx(body.latitude);
    event.longitude = approx(body.longitude);
    await event.save();
  }
  res.json({ location: { latitude: event.latitude, longitude: event.longitude } });
}));

// PER-1 / UC-4 alt 5.1
router.post('/cancel', requireScanSession, wrap(async (req, res) => {
  const cancelled = await cancelAlert(req.scanEvent._id);
  const event = await ScanEvent.findById(req.scanEvent._id);
  if (!cancelled && event.alertStatus !== 'cancelled') {
    throw new HttpError(409, 'The alert has already been sent and can no longer be cancelled.', { alert: await alertStatusFor(event) });
  }
  res.json({ alert: await alertStatusFor(event) });
}));

// SRS 6.4: the SMS link opens a read-only emergency profile. It never creates a scan or an alert.
router.get('/alert-view/:viewToken', wrap(async (req, res) => {
  const event = await ScanEvent.findOne({ viewToken: req.params.viewToken });
  const maxAge = config.alertViewHours * 3600_000;
  if (!event || Date.now() - event.scannedAt.getTime() > maxAge) {
    throw new HttpError(404, 'This alert link is no longer available.', { code: 'LINK_EXPIRED' });
  }
  const user = await User.findById(event.userId);
  const { data } = await loadProfile(event.userId);
  res.json({
    readOnly: true,
    scannedAt: event.scannedAt,
    profile: emergencyView(user, data),
    location: event.latitude != null ? { latitude: event.latitude, longitude: event.longitude } : null,
  });
}));

/* ---------- Physician access (Module 8) ---------- */

const codeHash = (code, eventId) => hmac(`${eventId}:${code}`);

/**
 * FR-43. The one-time code is generated on request and sent by SMS to the patient's
 * emergency contacts. It is never shown on the public profile. The physician identifies
 * themselves so that the contacts and the audit trail know who is asking.
 */
router.post('/physician/request', requireScanSession, wrap(async (req, res) => {
  const body = parse(z.object({
    name: z.string().trim().min(3, 'Enter your full name').max(100),
    hospital: z.string().trim().min(2, 'Enter the hospital name').max(120),
    registrationNo: z.string().trim().min(3, 'Enter your medical registration number').max(40),
  }), req.body);
  const event = req.scanEvent;
  if (event.physicianRequests >= config.physicianMaxRequestsPerScan) {
    throw new HttpError(429, 'Too many code requests for this scan. Scan the QR code again to start over.');
  }
  const user = await User.findById(event.userId);
  const { data } = await loadProfile(event.userId);
  if (!data.emergencyContacts.length) throw new HttpError(409, 'This patient has no emergency contacts, so a code cannot be issued.');

  const code = randomDigits(6);
  await PhysicianAccessCode.updateMany({ scanEventId: event._id, used: false }, { used: true });
  await PhysicianAccessCode.create({
    userId: event.userId, scanEventId: event._id, codeHash: codeHash(code, event._id),
    expiresAt: new Date(Date.now() + config.physicianCodeMinutes * 60_000), physician: body,
  });
  event.physicianRequests += 1;
  await event.save();

  const sms = `NIJAAT AI: ${body.name} at ${body.hospital} (reg. ${body.registrationNo}) is asking to view the medical record of ${user.fullName}. If you trust this request, give them this code: ${code}. It expires in ${config.physicianCodeMinutes} minutes.`;
  let reached = 0;
  for (const contact of data.emergencyContacts) {
    const r = await sendWithRetry({
      userId: event.userId, scanEventId: event._id, kind: 'physician_code',
      contactName: contact.name, to: contact.phone, body: sms, maxAttempts: 2,
    });
    if (r.delivered) reached += 1;
  }
  await audit(event.userId, 'physician_code_requested', {
    actorType: 'physician', actorLabel: `${body.name}, ${body.hospital}, reg. ${body.registrationNo}`,
    detail: `${reached} of ${data.emergencyContacts.length} contacts reached`,
  });
  if (!reached) throw new HttpError(502, 'None of the emergency contacts could be reached by SMS. Call a contact from the emergency profile.');
  res.json({
    message: `A code was sent to ${reached} emergency contact${reached === 1 ? '' : 's'}. Ask them to read it to you.`,
    contacts: data.emergencyContacts.map((c) => ({ name: c.name, relationship: c.relationship, phone: c.phone })),
    expiresInMinutes: config.physicianCodeMinutes,
    // Only when no SMS gateway is configured, so the flow can be demonstrated.
    devCode: devMode.sms && !config.isProd ? code : undefined,
  });
}));

router.post('/physician/verify', requireScanSession, wrap(async (req, res) => {
  const { code } = parse(z.object({ code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code') }), req.body);
  const event = req.scanEvent;
  const record = await PhysicianAccessCode.findOne({ scanEventId: event._id, used: false }).sort({ createdAt: -1 });
  const deny = async (message, reason) => {
    await audit(event.userId, 'physician_access_denied', { actorType: 'physician', actorLabel: record?.physician?.name, detail: reason });
    throw new HttpError(403, message, { code: reason });
  };
  if (!record) await deny('Request a new code. The previous one was used or replaced.', 'CODE_MISSING');
  if (record.expiresAt < new Date()) await deny('This code has expired. Request a new one.', 'CODE_EXPIRED');
  if (record.attempts >= config.physicianMaxCodeAttempts) await deny('Too many incorrect attempts. Request a new code.', 'CODE_LOCKED');
  if (!safeEqual(codeHash(code, event._id), record.codeHash)) {
    record.attempts += 1;
    await record.save();
    await deny('The code is incorrect.', 'CODE_INCORRECT');
  }
  record.used = true;
  await record.save();
  const session = await PhysicianSession.create({ userId: event.userId, scanEventId: event._id, physician: record.physician });
  await audit(event.userId, 'physician_access_granted', {
    actorType: 'physician', actorLabel: `${record.physician.name}, ${record.physician.hospital}, reg. ${record.physician.registrationNo}`,
  });
  res.json({ physicianSession: signPhysicianSession(session), inactivityMinutes: config.physicianInactivityMinutes });
}));

function timelineFrom(data, summaries, prescriptions) {
  const events = [];
  const push = (date, type, title, detail) => { if (date) events.push({ date, type, title, detail: detail || '' }); };
  data.chronicConditions.forEach((c) => push(c.since, 'diagnosis', c.name, c.notes));
  data.surgeries.forEach((s) => push(s.date, 'surgery', s.name, s.notes));
  data.implants.forEach((i) => push(i.date, 'surgery', `Implant: ${i.name}`, i.notes));
  prescriptions.forEach((p) => push(p.date.slice(0, 10), 'medication', 'Prescription recorded', p.medications.map((m) => m.name).join(', ')));
  summaries.forEach((s) => {
    (s.sections.primaryDiagnoses || []).forEach((d) => push(s.date.slice(0, 10), 'diagnosis', d.text, `From report: ${s.reportName}`));
  });
  return events.sort((a, b) => a.date.localeCompare(b.date));
}

// FR-44 to FR-47. Every read is an audited access event (FR-48).
router.get('/physician/record', requirePhysician, wrap(async (req, res) => {
  const session = req.physicianSession;
  const user = await User.findById(session.userId);
  const { data } = await loadProfile(session.userId);
  const reports = await MedicalReport.find({ userId: session.userId, status: 'summarized' }).sort({ uploadedAt: -1 });
  const summaryDocs = await MedicalSummary.find({ reportId: { $in: reports.map((r) => r._id) } });
  const byReport = new Map(summaryDocs.map((s) => [String(s.reportId), s]));
  const summaries = reports.filter((r) => byReport.has(String(r._id))).map((r) => {
    const s = byReport.get(String(r._id));
    return { reportName: r.fileName, date: r.uploadedAt.toISOString(), edited: s.edited, sections: open(s.data).sections };
  });
  const rx = await Prescription.find({ userId: session.userId, verified: true }).sort({ uploadedAt: -1 });
  const prescriptions = rx.map((p) => ({ id: p._id, date: p.uploadedAt.toISOString(), medications: open(p.data).medications }));
  await audit(session.userId, 'physician_record_viewed', { actorType: 'physician', actorLabel: session.physician?.name });
  res.json({
    patient: {
      name: user.fullName, bloodGroup: data.bloodGroup || null,
      dateOfBirth: data.personal.dateOfBirth || null, gender: data.personal.gender || null,
    },
    physician: session.physician,
    inactivityMinutes: config.physicianInactivityMinutes,
    allergies: emergencyView(user, data).allergies,
    chronicConditions: data.chronicConditions,
    activeMedications: data.medications.filter((m) => m.active),
    pastMedications: data.medications.filter((m) => !m.active),
    surgeries: data.surgeries,
    implants: data.implants,
    summaries,
    prescriptions,
    timeline: timelineFrom(data, summaries, prescriptions),
    generatedAt: new Date().toISOString(),
  });
}));

// Keeps the session alive while the physician is reading, and reports the time left.
router.post('/physician/ping', requirePhysician, (req, res) => {
  res.json({ inactivityMinutes: config.physicianInactivityMinutes });
});

router.post('/physician/end', requirePhysician, wrap(async (req, res) => {
  req.physicianSession.ended = true;
  await req.physicianSession.save();
  await audit(req.physicianSession.userId, 'physician_session_ended', { actorType: 'physician', actorLabel: req.physicianSession.physician?.name });
  res.json({ ended: true });
}));

export default router;
