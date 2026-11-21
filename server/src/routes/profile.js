import { Router } from 'express';
import { z } from 'zod';
import { ProfileVersion, SMSAlert, ScanEvent } from '../models.js';
import { HttpError, wrap, parse } from '../util.js';
import { requireUser } from '../middleware.js';
import { profileSchema, loadProfile, saveProfile, missingFields, emergencyView } from '../services/profile.js';
import { sendWithRetry, scheduleAlert, cancelAlert, alertStatusFor } from '../services/alert.js';
import { audit } from '../services/notify.js';
import { randomToken } from '../services/crypto.js';
import { config, devMode } from '../config.js';

const router = Router();
router.use(requireUser);

// FR-05: view
router.get('/', wrap(async (req, res) => {
  const { doc, data, version } = await loadProfile(req.user._id);
  res.json({
    profile: data, version, updatedAt: doc?.updatedAt || null,
    complete: !!doc?.complete, missing: missingFields(data),
  });
}));

// FR-05: create and update. BR-02: only the authenticated owner; every change is versioned.
router.put('/', wrap(async (req, res) => {
  const next = parse(profileSchema, req.body);
  const result = await saveProfile(req.user._id, next);
  if (result.changedFields.length) {
    await audit(req.user._id, 'profile_updated', { detail: result.changedFields.join(', ') });
  }
  res.json({
    profile: result.data, version: result.version, complete: result.complete,
    missing: missingFields(result.data), changedFields: result.changedFields, critical: result.critical,
  });
}));

// FR-07
router.get('/history', wrap(async (req, res) => {
  const history = await ProfileVersion.find({ userId: req.user._id }).sort({ version: -1 }).limit(200);
  res.json({ history: history.map((h) => ({ version: h.version, changedFields: h.changedFields, critical: h.critical, at: h.at })) });
}));

// What a bystander will see.
router.get('/emergency-preview', wrap(async (req, res) => {
  const { data } = await loadProfile(req.user._id);
  res.json({ profile: emergencyView(req.user, data) });
}));

// FR-29: sample SMS to the user's own contacts.
router.post('/test-sms', wrap(async (req, res) => {
  const { data } = await loadProfile(req.user._id);
  if (!data.emergencyContacts.length) throw new HttpError(400, 'Add at least one emergency contact first.');
  const recent = await SMSAlert.findOne({ userId: req.user._id, kind: 'test', at: { $gt: new Date(Date.now() - 60_000) } });
  if (recent) throw new HttpError(429, 'A test SMS was sent less than a minute ago. Please wait before sending another.');
  const body = `NIJAAT AI TEST: ${req.user.fullName} has listed you as an emergency contact. This is a test message. No action is needed.`;
  const results = [];
  for (const contact of data.emergencyContacts) {
    const r = await sendWithRetry({
      userId: req.user._id, kind: 'test', contactName: contact.name, to: contact.phone, body, maxAttempts: 1,
    });
    results.push({ name: contact.name, phone: contact.phone, delivered: r.delivered });
  }
  await audit(req.user._id, 'test_sms_sent', { detail: `${results.filter((r) => r.delivered).length} of ${results.length}` });
  res.json({ results, devMode: devMode.sms });
}));

/*
 * Self-triggered emergency alert ("Trigger Alert" on the dashboard).
 * Not in the approved SRS: this is a proposed addition to Module 5 and needs supervisor approval.
 * It reuses the scan alert machinery, including the 30-second cancel buffer (PER-1) and the
 * retry and logging rules (FR-27, FR-28), so nothing about delivery behaves differently.
 */
const approx = (n) => (n == null ? undefined : Math.round(n * 1000) / 1000);

router.post('/panic', wrap(async (req, res) => {
  const body = parse(z.object({
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
  }), req.body);
  const { data } = await loadProfile(req.user._id);
  if (!data.emergencyContacts.length) throw new HttpError(400, 'Add at least one emergency contact before using this.');

  const pending = await ScanEvent.findOne({ userId: req.user._id, source: 'self', alertStatus: { $in: ['pending', 'dispatching'] } });
  if (pending) return res.json({ alertId: pending._id, alert: await alertStatusFor(pending) });

  const event = await ScanEvent.create({
    userId: req.user._id, source: 'self', ip: req.ip,
    latitude: approx(body.latitude), longitude: approx(body.longitude),
    dispatchAt: new Date(Date.now() + config.alertBufferMs),
    viewToken: randomToken(12),
  });
  scheduleAlert(event);
  await audit(req.user._id, 'panic_alert_triggered', { detail: `${data.emergencyContacts.length} contacts` });
  res.status(201).json({ alertId: event._id, alert: await alertStatusFor(event) });
}));

async function ownEvent(req) {
  const event = await ScanEvent.findOne({ _id: req.params.id, userId: req.user._id });
  if (!event) throw new HttpError(404, 'Alert not found.');
  return event;
}

router.get('/panic/:id', wrap(async (req, res) => {
  res.json({ alert: await alertStatusFor(await ownEvent(req)) });
}));

router.post('/panic/:id/cancel', wrap(async (req, res) => {
  const event = await ownEvent(req);
  await cancelAlert(event._id);
  res.json({ alert: await alertStatusFor(await ScanEvent.findById(event._id)) });
}));

export default router;
