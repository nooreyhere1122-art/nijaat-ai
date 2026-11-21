// Integration tests. They need a MongoDB-compatible database:
//   MONGODB_URI=mongodb://127.0.0.1:27017/nijaat_test npm test
process.env.NODE_ENV = 'test';
process.env.MONGODB_URI ||= 'mongodb://127.0.0.1:27017/nijaat_test';
process.env.ALERT_BUFFER_MS = '400';
process.env.ALERT_RETRY_BASE_MS = '20';
process.env.SCAN_DEDUPE_MINUTES = '0';
process.env.PHYSICIAN_INACTIVITY_MINUTES = '0.01'; // 600 ms

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { Readable } from 'node:stream';
import request from 'supertest';

const { config } = await import('../src/config.js');
const { createApp } = await import('../src/app.js');
const { setSmsOverride } = await import('../src/services/notify.js');
const { setSummaryOverride } = await import('../src/services/summary.js');
const { setOcrOverride } = await import('../src/routes/prescriptions.js');
const { setMapsFetch } = await import('../src/routes/hospitals.js');
const { parseMedications, autocorrect } = await import('../src/services/prescriptionParser.js');
const models = await import('../src/models.js');

const app = createApp();
const api = () => request(app);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

const state = {};
const auth = (t = state.token) => ({ Authorization: `Bearer ${t}` });

const fullProfile = {
  personal: { dateOfBirth: '1998-04-12', gender: 'male', city: 'Sahiwal', address: 'House 12, Street 4' },
  bloodGroup: 'O-',
  allergies: [
    { name: 'Dust', severity: 'mild', reaction: 'Sneezing' },
    { name: 'Penicillin', severity: 'severe', reaction: 'Anaphylaxis' },
  ],
  chronicConditions: [{ name: 'Asthma', since: '2015', notes: '' }],
  medications: [{ name: 'Salbutamol', dosage: '100 mcg', frequency: 'When needed', duration: '' }],
  surgeries: [{ name: 'Appendectomy', date: '2019-06-01', notes: '' }],
  implants: [],
  emergencyContacts: [
    { name: 'Ali Raza', relationship: 'Father', phone: '0300 1234567' },
    { name: 'Sara Raza', relationship: 'Sister', phone: '+923211234567' },
  ],
};

async function registerAndLogin(email, fullName = 'Hamza Raza') {
  const reg = await api().post('/api/auth/register').send({ fullName, email, phone: '03001112233', password: 'secret123' });
  assert.equal(reg.status, 201);
  const token = new URL(reg.body.devLink).searchParams.get('token');
  await api().post('/api/auth/verify-email').send({ token }).expect(200);
  const login = await api().post('/api/auth/login').send({ email, password: 'secret123' });
  assert.equal(login.status, 200);
  return login.body.token;
}

before(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  await Promise.all(Object.values(models).filter((m) => m?.deleteMany).map((m) => m.deleteMany({})));
});
after(async () => { await sleep(200); await mongoose.disconnect(); });

test('Module 1: registration, verification, login, password reset', async () => {
  const bad = await api().post('/api/auth/register').send({ fullName: 'H', email: 'nope', phone: '12', password: 'short' });
  assert.equal(bad.status, 400);
  assert.ok(bad.body.fields.email && bad.body.fields.phone && bad.body.fields.password && bad.body.fields.fullName);

  const reg = await api().post('/api/auth/register').send({ fullName: 'Hamza Raza', email: 'Hamza@Example.com', phone: '0300-1112233', password: 'secret123' });
  assert.equal(reg.status, 201);
  assert.ok(reg.body.devLink);

  const dup = await api().post('/api/auth/register').send({ fullName: 'Hamza Raza', email: 'hamza@example.com', phone: '03001112233', password: 'secret123' });
  assert.equal(dup.status, 409);

  // BR-01: no login before verification
  const early = await api().post('/api/auth/login').send({ email: 'hamza@example.com', password: 'secret123' });
  assert.equal(early.status, 403);
  assert.equal(early.body.code, 'EMAIL_UNVERIFIED');

  const token = new URL(reg.body.devLink).searchParams.get('token');
  await api().post('/api/auth/verify-email').send({ token: 'x'.repeat(20) }).expect(400);
  await api().post('/api/auth/verify-email').send({ token }).expect(200);

  const wrong = await api().post('/api/auth/login').send({ email: 'hamza@example.com', password: 'wrong-pass1' });
  assert.equal(wrong.status, 401);
  const unknown = await api().post('/api/auth/login').send({ email: 'ghost@example.com', password: 'wrong-pass1' });
  assert.equal(unknown.body.error, wrong.body.error, 'same general message for both cases');

  const login = await api().post('/api/auth/login').send({ email: 'hamza@example.com', password: 'secret123' });
  assert.equal(login.status, 200);
  assert.equal(login.body.user.phone, '+923001112233');
  state.token = login.body.token;

  const forgot = await api().post('/api/auth/forgot-password').send({ email: 'hamza@example.com' });
  const resetToken = new URL(forgot.body.devLink).searchParams.get('token');
  await api().post('/api/auth/reset-password').send({ token: resetToken, password: 'newsecret1' }).expect(200);
  await api().post('/api/auth/reset-password').send({ token: resetToken, password: 'another12' }).expect(400);
  await api().post('/api/auth/login').send({ email: 'hamza@example.com', password: 'secret123' }).expect(401);
  await api().post('/api/auth/login').send({ email: 'hamza@example.com', password: 'newsecret1' }).expect(200);

  await api().get('/api/profile').expect(401);
});

test('Modules 1 and 2: profile, version history, QR lifecycle', async () => {
  const empty = await api().get('/api/profile').set(auth());
  assert.equal(empty.body.complete, false);
  assert.equal(empty.body.missing.length, 3);

  const blocked = await api().post('/api/qr/generate').set(auth());
  assert.equal(blocked.status, 400);
  assert.ok(blocked.body.missing.length);

  const invalid = await api().put('/api/profile').set(auth()).send({ ...fullProfile, emergencyContacts: [{ name: 'X', relationship: 'Friend', phone: '123' }] });
  assert.equal(invalid.status, 400);
  assert.ok(invalid.body.fields['emergencyContacts.0.phone']);

  const saved = await api().put('/api/profile').set(auth()).send(fullProfile);
  assert.equal(saved.status, 200);
  assert.equal(saved.body.version, 1);
  assert.equal(saved.body.complete, true);
  assert.equal(saved.body.profile.emergencyContacts[0].phone, '+923001234567');

  // The stored document is encrypted (CO-5)
  const raw = await models.MedicalProfile.findOne({});
  assert.ok(!raw.data.toString('latin1').includes('Penicillin'));

  const same = await api().put('/api/profile').set(auth()).send(fullProfile);
  assert.equal(same.body.version, 1, 'no version bump without changes');

  const gen = await api().post('/api/qr/generate').set(auth());
  assert.equal(gen.status, 201);
  assert.match(gen.body.qr.url, /\/e\/[\w-]{20,}$/);
  state.qrToken = gen.body.qr.url.split('/e/')[1];
  const again = await api().post('/api/qr/generate').set(auth());
  assert.equal(again.body.qr.url, gen.body.qr.url, 'generate is idempotent');

  const upd = await api().put('/api/profile').set(auth()).send({ ...fullProfile, personal: { ...fullProfile.personal, city: 'Lahore' } });
  assert.equal(upd.body.version, 2);
  assert.equal(upd.body.critical, false);
  const crit = await api().put('/api/profile').set(auth()).send({ ...fullProfile, personal: { ...fullProfile.personal, city: 'Lahore' }, allergies: [...fullProfile.allergies, { name: 'Peanuts', severity: 'moderate', reaction: '' }] });
  assert.equal(crit.body.critical, true);
  state.profile = crit.body.profile;

  const history = await api().get('/api/profile/history').set(auth());
  assert.deepEqual(history.body.history.map((h) => h.version), [3, 2, 1]);
  assert.deepEqual(history.body.history[0].changedFields, ['allergies']);

  await api().post('/api/qr/download-log').set(auth()).send({ format: 'PDF' }).expect(200);
  await api().post('/api/qr/download-log').set(auth()).send({ format: 'GIF' }).expect(400);
  const status = await api().get('/api/qr').set(auth());
  assert.equal(status.body.qr.downloadCount, 1);
  assert.equal(status.body.qr.url, gen.body.qr.url, 'the printed code survives a critical data change');
});

test('Modules 3 and 5: scan, emergency view, cancel buffer, dispatch with retry', async () => {
  await api().post('/api/public/scan').send({ token: 'not-a-real-token-123' }).expect(404);
  await api().get('/api/public/session').expect(401);

  const scan = await api().post('/api/public/scan').send({ token: state.qrToken, latitude: 30.66123, longitude: 73.10891 });
  assert.equal(scan.status, 201);
  // BR-04: only emergency fields
  assert.deepEqual(Object.keys(scan.body.profile).sort(), ['allergies', 'bloodGroup', 'contacts', 'name']);
  assert.equal(scan.body.profile.allergies[0].name, 'Penicillin', 'severe allergy first');
  assert.ok(!JSON.stringify(scan.body).includes('House 12'));
  assert.ok(!JSON.stringify(scan.body).includes('Asthma'));
  assert.equal(scan.body.alert.status, 'pending');
  assert.deepEqual(scan.body.location, { latitude: 30.661, longitude: 73.109 }, 'approximate location only');

  // Cancel inside the buffer: no SMS at all
  const cancel = await api().post('/api/public/cancel').set(auth(scan.body.session));
  assert.equal(cancel.body.alert.status, 'cancelled');
  await sleep(600);
  assert.equal(await models.SMSAlert.countDocuments({ kind: 'emergency' }), 0);

  // Second scan: first contact's number always fails, second succeeds
  const sent = [];
  setSmsOverride(async ({ to, body }) => {
    sent.push({ to, body });
    return to === '+923001234567'
      ? { ok: false, status: 'failed', errorCode: '30003', provider: 'test' }
      : { ok: true, status: 'sent', sid: 'SM123', provider: 'test' };
  });
  const scan2 = await api().post('/api/public/scan').send({ token: state.qrToken });
  assert.equal(scan2.body.location, null);
  await api().post('/api/public/location').set(auth(scan2.body.session)).send({ latitude: 31.5, longitude: 74.3 }).expect(200);
  await sleep(1200);
  const status = await api().get('/api/public/session').set(auth(scan2.body.session));
  assert.equal(status.body.alert.status, 'dispatched');
  const father = status.body.alert.contacts.find((c) => c.name === 'Ali Raza');
  const sister = status.body.alert.contacts.find((c) => c.name === 'Sara Raza');
  assert.deepEqual([father.status, father.attempts], ['unreachable', 3]);
  assert.deepEqual([sister.status, sister.attempts], ['sent', 1]);
  assert.equal(sent.length, 4);
  assert.match(sent[0].body, /Hamza Raza/);
  assert.match(sent[0].body, /maps\.google\.com\/\?q=31\.50000,74\.30000/);
  assert.equal(await models.SMSAlert.countDocuments({ kind: 'emergency' }), 4, 'one record per attempt');

  await api().post('/api/public/cancel').set(auth(scan2.body.session)).expect(409);

  // SRS 6.4: the SMS link is read-only and never creates a scan
  const viewToken = sent[3].body.match(/\/a\/([\w-]+)/)[1];
  const before = await models.ScanEvent.countDocuments({});
  const view = await api().get(`/api/public/alert-view/${viewToken}`);
  assert.equal(view.status, 200);
  assert.equal(view.body.readOnly, true);
  assert.equal(view.body.profile.bloodGroup, 'O-');
  assert.equal(await models.ScanEvent.countDocuments({}), before);
  await api().get('/api/public/alert-view/unknown-token').expect(404);

  // A reload within the dedupe window reuses the scan event
  config.scanDedupeMinutes = 10;
  const a = await api().post('/api/public/scan').send({ token: state.qrToken });
  const b = await api().post('/api/public/scan').send({ token: state.qrToken });
  assert.equal(a.body.scanEventId, b.body.scanEventId);
  config.scanDedupeMinutes = 0;
  state.session = a.body.session;
  await sleep(900);

  const activity = await api().get('/api/qr/activity').set(auth());
  assert.equal(activity.body.totalScans, 2, "the reloads reused the second scan");
  assert.ok(activity.body.scans.some((s) => s.sms.length === 4));
  assert.ok(activity.body.log.some((l) => l.action === 'data_refreshed'));
  setSmsOverride(null);
});

test('Module 8: physician access by code sent to contacts, inactivity expiry', async () => {
  const texts = [];
  setSmsOverride(async ({ to, body }) => { texts.push({ to, body }); return { ok: true, status: 'sent', provider: 'test' }; });

  const emergency = await api().get('/api/public/session').set(auth(state.session));
  assert.ok(!/\b\d{6}\b/.test(JSON.stringify(emergency.body.profile)), 'no code on the public profile');

  await api().post('/api/public/physician/request').send({ name: 'Dr Khan', hospital: 'DHQ', registrationNo: '12345-P' }).expect(401);
  const bad = await api().post('/api/public/physician/request').set(auth(state.session)).send({ name: 'D', hospital: '', registrationNo: '' });
  assert.equal(bad.status, 400);

  const req1 = await api().post('/api/public/physician/request').set(auth(state.session)).send({ name: 'Dr Ayesha Khan', hospital: 'DHQ Hospital Sahiwal', registrationNo: '12345-P' });
  assert.equal(req1.status, 200);
  assert.equal(texts.length, 2);
  const code = texts[0].body.match(/code: (\d{6})/)[1];
  assert.match(texts[0].body, /Dr Ayesha Khan at DHQ Hospital Sahiwal/);
  assert.ok(!JSON.stringify(req1.body).includes(code) || req1.body.devCode === code);

  const wrongCode = code === '000000' ? '111111' : '000000';
  const denied = await api().post('/api/public/physician/verify').set(auth(state.session)).send({ code: wrongCode });
  assert.equal(denied.status, 403);
  await api().get('/api/public/physician/record').expect(401);

  const ok = await api().post('/api/public/physician/verify').set(auth(state.session)).send({ code });
  assert.equal(ok.status, 200);
  const reuse = await api().post('/api/public/physician/verify').set(auth(state.session)).send({ code });
  assert.equal(reuse.status, 403, 'code is single use');

  const record = await api().get('/api/public/physician/record').set(auth(ok.body.physicianSession));
  assert.equal(record.status, 200);
  assert.equal(record.body.patient.bloodGroup, 'O-');
  assert.equal(record.body.allergies[0].severity, 'severe');
  assert.ok(record.body.chronicConditions.some((c) => c.name === 'Asthma'));
  assert.ok(record.body.timeline.some((e) => e.type === 'surgery'));
  // A user JWT or scan session must not open the record
  await api().get('/api/public/physician/record').set(auth(state.token)).expect(401);
  await api().get('/api/public/physician/record').set(auth(state.session)).expect(401);

  await sleep(800);
  const expired = await api().get('/api/public/physician/record').set(auth(ok.body.physicianSession));
  assert.equal(expired.status, 401);
  assert.equal(expired.body.code, 'PHYSICIAN_SESSION_EXPIRED');

  const audit = await api().get('/api/audit').set(auth());
  const actions = audit.body.entries.map((e) => e.action);
  for (const a of ['physician_code_requested', 'physician_access_denied', 'physician_access_granted', 'physician_record_viewed', 'physician_session_expired']) {
    assert.ok(actions.includes(a), `audit has ${a}`);
  }
  setSmsOverride(null);
});

test('Module 2: deactivate and regenerate', async () => {
  await api().post('/api/qr/deactivate').set(auth()).expect(200);
  const gone = await api().post('/api/public/scan').send({ token: state.qrToken });
  assert.equal(gone.status, 410);
  assert.equal(gone.body.code, 'QR_DEACTIVATED');
  const regen = await api().post('/api/qr/regenerate').set(auth());
  assert.equal(regen.status, 201);
  const newToken = regen.body.qr.url.split('/e/')[1];
  assert.notEqual(newToken, state.qrToken);
  await api().post('/api/public/scan').send({ token: state.qrToken }).expect(410);
  const ok = await api().post('/api/public/scan').send({ token: newToken });
  assert.equal(ok.status, 201);
  await api().post('/api/public/cancel').set(auth(ok.body.session)).expect(200);
});

test('Module 4: report upload, summary, edit with audit, failure and retry', async () => {
  await api().post('/api/reports').set(auth()).attach('file', Buffer.from('hello'), { filename: 'a.txt', contentType: 'text/plain' }).expect(415);

  // No API key and no override: the file is kept and the report is marked failed (UC-5 E2)
  const failed = await api().post('/api/reports').set(auth()).attach('file', PNG, { filename: 'scan.png', contentType: 'image/png' });
  assert.equal(failed.status, 201);
  await sleep(300);
  const f = await api().get(`/api/reports/${failed.body.report.id}`).set(auth());
  assert.equal(f.body.report.status, 'failed');
  assert.match(f.body.report.error, /not configured/);

  setSummaryOverride(async () => ({
    demographics: [{ text: 'Male, 28 years', urgency: 'green', confidence: 0.97 }],
    primaryDiagnoses: [{ text: 'Moderate persistent asthma', urgency: 'amber', confidence: 0.9 }],
    allergies: [{ text: 'Penicillin: anaphylaxis', urgency: 'red', confidence: 0.99 }],
    testResults: [{ text: 'Hb 9.1 g/dL (13-17)', urgency: 'purple', confidence: 4 }, { text: '   ' }],
  }));
  const retry = await api().post(`/api/reports/${failed.body.report.id}/retry`).set(auth());
  assert.equal(retry.body.report.status, 'processing');
  await sleep(300);
  const done = await api().get(`/api/reports/${failed.body.report.id}`).set(auth());
  assert.equal(done.body.report.status, 'summarized');
  const s = done.body.summary.sections;
  assert.equal(Object.keys(s).length, 8, 'all eight FR-21 sections');
  assert.equal(s.testResults.length, 1);
  assert.equal(s.testResults[0].urgency, 'green');
  assert.equal(s.testResults[0].confidence, 1);
  assert.equal(done.body.summary.edited, false);

  const list = await api().get('/api/reports').set(auth());
  assert.equal(list.body.reports[0].urgency, 'red');

  s.primaryDiagnoses[0].text = 'Severe persistent asthma';
  s.primaryDiagnoses[0].urgency = 'red';
  s.primaryDiagnoses[0].note = 'Corrected by me';
  const edit = await api().put(`/api/reports/${failed.body.report.id}/summary`).set(auth()).send({ sections: s });
  assert.equal(edit.status, 200);
  assert.equal(edit.body.summary.edited, true);
  assert.deepEqual(edit.body.changed, ['primaryDiagnoses']);
  const audit = await api().get('/api/audit').set(auth());
  assert.ok(audit.body.entries.some((e) => e.action === 'summary_edited'));

  const file = await api().get(`/api/reports/${failed.body.report.id}/file`).set(auth());
  assert.equal(file.headers['content-type'], 'image/png');
  assert.ok(Buffer.compare(file.body, PNG) === 0, 'file round-trips through encryption');
  const stored = await models.StoredFile.findOne({});
  assert.equal(stored.provider, 'mongo', 'no blob token, so bytes stay in the database');
  assert.ok(Buffer.compare(Buffer.from(stored.data).subarray(28), PNG) !== 0, 'file is encrypted at rest');
  assert.ok(!Buffer.from(stored.data).includes(PNG), 'the raw file is nowhere in the stored bytes');

  // BR-02: another user cannot read it
  const other = await registerAndLogin('other@example.com', 'Other User');
  await api().get(`/api/reports/${failed.body.report.id}`).set(auth(other)).expect(404);
  await api().put(`/api/reports/${failed.body.report.id}/summary`).set(auth(other)).send({ sections: s }).expect(404);
  state.reportId = failed.body.report.id;
  setSummaryOverride(null);
});

test('Module 7: prescription OCR, parsing, autocorrect, verification, history', async () => {
  setOcrOverride(async () => ({ text: '', lines: ['City Medical Clinic', 'Dr. Imran MBBS', '12/11/2026'], confidence: 80 }));
  const none = await api().post('/api/prescriptions').set(auth()).attach('file', PNG, { filename: 'rx.png', contentType: 'image/png' });
  assert.equal(none.status, 422);
  assert.equal(none.body.code, 'NO_MEDICATION');
  assert.equal(await models.Prescription.countDocuments({}), 0, 'nothing saved on failure');

  const lines = ['Al-Shifa Clinic, Sahiwal', 'Dr. Imran Ahmed MBBS FCPS', 'Date: 12/11/2026', 'Rx',
    '1. Tab Augmentln 625mg 1+0+1 x 7 days', '2) Cap Risek 20 mg OD for 2 weeks', 'Syp Calpol 5ml TDS 3 days', 'Tab Panadoi 500mg SOS'];
  setOcrOverride(async () => ({ text: lines.join('\n'), lines, confidence: 78 }));
  const up = await api().post('/api/prescriptions').set(auth()).attach('file', PNG, { filename: 'rx.png', contentType: 'image/png' });
  assert.equal(up.status, 201);
  const meds = up.body.prescription.medications;
  assert.deepEqual(meds.map((m) => m.name), ['Augmentin', 'Risek', 'Calpol', 'Panadol']);
  assert.deepEqual(meds.map((m) => m.frequency), ['Twice daily', 'Once daily', 'Three times daily', 'When needed']);
  assert.deepEqual(meds.map((m) => m.duration), ['7 days', '2 weeks', '3 days', '']);
  assert.equal(meds[0].autocorrected, true);
  assert.equal(meds[0].originalName, 'Augmentln');
  assert.equal(meds[1].autocorrected, false);
  assert.equal(up.body.prescription.verified, false);

  // Not in the medication list until verified (BR-07)
  let profile = await api().get('/api/profile').set(auth());
  assert.ok(!profile.body.profile.medications.some((m) => m.name === 'Augmentin'));

  const id = up.body.prescription.id;
  const verify = await api().put(`/api/prescriptions/${id}/verify`).set(auth()).send({
    medications: meds.slice(0, 3).map(({ name, dosage, frequency, duration }) => ({ name, dosage, frequency, duration })),
    refillDate: '2026-12-01',
  });
  assert.equal(verify.status, 200);
  assert.equal(verify.body.prescription.verified, true);
  profile = await api().get('/api/profile').set(auth());
  const fromRx = profile.body.profile.medications.filter((m) => m.source === 'prescription');
  assert.equal(fromRx.length, 3);
  assert.ok(profile.body.profile.medications.some((m) => m.name === 'Salbutamol'), 'manual entries kept');

  // Verifying again replaces, not duplicates
  await api().put(`/api/prescriptions/${id}/verify`).set(auth()).send({ medications: [{ name: 'Augmentin', dosage: '625mg' }] }).expect(200);
  profile = await api().get('/api/profile').set(auth());
  assert.equal(profile.body.profile.medications.filter((m) => m.source === 'prescription').length, 1);

  const history = await api().get('/api/prescriptions').set(auth());
  assert.equal(history.body.prescriptions.length, 1);
  const img = await api().get(`/api/prescriptions/${id}/image`).set(auth());
  assert.equal(img.headers['content-type'], 'image/png');
  setOcrOverride(null);
});

test('parser unit checks', () => {
  assert.equal(autocorrect('Brufan').name, 'Brufen');
  assert.equal(autocorrect('Xyzqwert').matched, false);
  assert.deepEqual(parseMedications(['Patient Name: Ali', 'Age: 40', 'Phone: 0300-1234567', 'Signature']), []);
  const [m] = parseMedications(['Inj. Rocephin 1g BD x 5 days']);
  assert.deepEqual([m.name, m.dosage, m.frequency, m.duration, m.form], ['Rocephin', '1g', 'Twice daily', '5 days', 'inj']);
  const [n] = parseMedications(['Metformin 500 mg every 8 hours for 1 month']);
  assert.deepEqual([n.name, n.frequency, n.duration], ['Metformin', 'Every 8 hours', '1 month']);
});

test('Module 6: hospital search on OpenStreetMap, with no key at all', async () => {
  await api().get('/api/hospitals?lat=999&lng=73.1').expect(400);

  const node = (id, name, dLat, tags = {}) => ({
    type: 'node', id, lat: 30.66 + dLat, lon: 73.1,
    tags: { amenity: 'hospital', name, 'addr:street': `${name} Road`, phone: '040 1234567', ...tags },
  });
  const radii = [];
  setMapsFetch(async (url, init) => {
    assert.match(url, /overpass-api\.de/, 'no key means no Google call');
    const query = decodeURIComponent(String(init.body));
    radii.push(Number(query.match(/around:(\d+)/)[1]));
    return {
      elements: [
        node(1, 'DHQ Teaching Hospital', 0.05),
        node(2, 'Al-Noor Clinic', 0.01, { amenity: 'clinic' }),
        node(2, 'Al-Noor Clinic', 0.01, { amenity: 'clinic' }),            // duplicate
        node(3, 'Sahiwal Trauma Centre', 0.12, { emergency: 'yes' }),      // ~13 km, outside 10 km
        node(4, 'Far Away Hospital', 1.5),                                 // ~167 km, outside the maximum
        { type: 'way', id: 9, center: { lat: 30.67, lon: 73.1 }, tags: { amenity: 'doctors' } }, // no name
      ],
    };
  });

  const res = await api().get('/api/hospitals?lat=30.66&lng=73.1');
  assert.equal(res.status, 200);
  assert.equal(res.body.provider, 'osm');
  assert.equal(res.body.attribution, '© OpenStreetMap contributors');
  assert.deepEqual(radii, [10000, 20000], 'radius expanded once because fewer than three were found');
  assert.equal(res.body.expanded, true);
  assert.equal(res.body.radiusKm, 20);
  assert.deepEqual(res.body.results.map((r) => r.id), ['osm-node-2', 'osm-node-1', 'osm-node-3'], 'sorted by travel time');
  assert.deepEqual(res.body.results.map((r) => r.facilityType), ['clinic', 'hospital', 'trauma_center']);
  assert.ok(res.body.results.every((r) => r.travelTimeMinutes > 0 && r.distanceM > 0 && r.phone));
  assert.ok(res.body.results.every((r) => r.travelTimeSource === 'estimate'), 'no traffic data without Google');

  // a repeat search from the same area is served from cache, not from Overpass again
  const before = radii.length;
  await api().get('/api/hospitals?lat=30.661&lng=73.101').expect(200);
  assert.equal(radii.length, before, 'Overpass is not called again for the same area');
  setMapsFetch(null);
});

test('Module 6: the Google provider is used when a key is set', async () => {
  const { mapsProvider } = await import('../src/routes/hospitals.js');
  config.googleMapsKey = 'test-key';
  assert.equal(mapsProvider(), 'google');
  const urls = [];
  setMapsFetch(async (url) => {
    urls.push(url);
    if (url.includes('routes.googleapis.com')) {
      return [{ destinationIndex: 0, duration: '600s', condition: 'ROUTE_EXISTS' }];
    }
    if (url.includes('searchNearby')) {
      return { places: [{ id: 'g1', displayName: { text: 'City Hospital' }, formattedAddress: 'Main Road',
        nationalPhoneNumber: '042 111', location: { latitude: 31.55, longitude: 74.3 }, types: ['hospital'] }] };
    }
    return { places: [] };
  });
  const res = await api().get('/api/hospitals?lat=31.5&lng=74.3');
  assert.equal(res.status, 200);
  assert.equal(res.body.provider, 'google');
  assert.equal(res.body.attribution, null);
  assert.equal(res.body.results.length, 1);
  assert.equal(res.body.results[0].name, 'City Hospital');
  assert.equal(res.body.results[0].travelTimeMinutes, 10, 'minutes come from the Routes matrix');
  assert.equal(res.body.results[0].travelTimeSource, 'traffic');
  assert.ok(urls.some((u) => u.includes('places.googleapis.com')));
  setMapsFetch(null);
  config.googleMapsKey = '';
});

test('Module 5: test SMS, and settings', async () => {
  const texts = [];
  setSmsOverride(async (m) => { texts.push(m); return { ok: true, status: 'sent', provider: 'test' }; });
  const sms = await api().post('/api/profile/test-sms').set(auth());
  assert.equal(sms.status, 200);
  assert.equal(sms.body.results.length, 2);
  assert.match(texts[0].body, /TEST/);
  await api().post('/api/profile/test-sms').set(auth()).expect(429);
  setSmsOverride(null);

  const me = await api().put('/api/auth/me').set(auth()).send({ fullName: 'Hamza R. Raza', phone: '+923009998877' });
  assert.equal(me.body.user.fullName, 'Hamza R. Raza');
  await api().post('/api/auth/change-password').set(auth()).send({ currentPassword: 'bad', newPassword: 'changed123' }).expect(400);
  await api().post('/api/auth/change-password').set(auth()).send({ currentPassword: 'newsecret1', newPassword: 'changed123' }).expect(200);
  await api().post('/api/auth/login').send({ email: 'hamza@example.com', password: 'changed123' }).expect(200);
});

test('Module 5 (proposed): self-triggered emergency alert', async () => {
  const texts = [];
  setSmsOverride(async (m) => { texts.push(m); return { ok: true, status: 'sent', provider: 'test' }; });

  await api().post('/api/profile/panic').expect(401);

  const scansBefore = (await api().get('/api/qr/activity').set(auth())).body.totalScans;
  const fired = await api().post('/api/profile/panic').set(auth()).send({ latitude: 30.66123, longitude: 73.10891 });
  assert.equal(fired.status, 201);
  assert.equal(fired.body.alert.status, 'pending');
  assert.ok(fired.body.alert.secondsLeft >= 0);
  assert.equal(texts.length, 0, 'nothing is sent during the cancel buffer');

  // A second press while one is pending reuses it instead of starting another
  const again = await api().post('/api/profile/panic').set(auth()).send({});
  assert.equal(String(again.body.alertId), String(fired.body.alertId));

  const cancelled = await api().post(`/api/profile/panic/${fired.body.alertId}/cancel`).set(auth());
  assert.equal(cancelled.body.alert.status, 'cancelled');
  await sleep(700);
  assert.equal(texts.length, 0, 'cancelling stops the SMS');

  const sent = await api().post('/api/profile/panic').set(auth()).send({ latitude: 31.5, longitude: 74.3 });
  await sleep(1200);
  const status = await api().get(`/api/profile/panic/${sent.body.alertId}`).set(auth());
  assert.equal(status.body.alert.status, 'dispatched');
  assert.equal(texts.length, 2, 'one message per emergency contact');
  assert.deepEqual(texts.map((t) => t.to).sort(), ['+923001234567', '+923211234567']);
  assert.match(texts[0].body, /has triggered an emergency alert from their own phone/);
  assert.match(texts[0].body, /maps\.google\.com\/\?q=31\.50000,74\.30000/);

  // It is an alert, not a scan: the scan counter must not move (FR-13)
  const activity = await api().get('/api/qr/activity').set(auth());
  assert.equal(activity.body.totalScans, scansBefore, 'self-triggered alerts are not scans');
  assert.ok(activity.body.scans.some((s) => s.source === 'self'));

  // Another user cannot read or cancel it (BR-02)
  const other = await registerAndLogin('panic-other@example.com', 'Other Person');
  await api().get(`/api/profile/panic/${sent.body.alertId}`).set(auth(other)).expect(404);
  await api().post(`/api/profile/panic/${sent.body.alertId}/cancel`).set(auth(other)).expect(404);

  const audit = await api().get('/api/audit').set(auth());
  assert.ok(audit.body.entries.some((e) => e.action === 'panic_alert_triggered'));
  setSmsOverride(null);
});

test('storage: files round-trip through an object store, encrypted', async () => {
  const { setBlobApi, putBytes, getBytes, deleteBytes, storageProvider } = await import('../src/services/storage.js');
  assert.equal(storageProvider(), 'mongo', 'without a token the bytes stay in the database');

  const store = new Map();
  const deleted = [];
  const calls = [];
  setBlobApi({
    put: async (key, body, opts) => { calls.push(opts); store.set(key, Buffer.from(body)); return { pathname: key, url: `https://x.private.blob.vercel-storage.com/${key}` }; },
    get: async (key) => ({ stream: new Blob([store.get(key)]).stream() }), // a web stream, as the SDK returns
    del: async (key) => { deleted.push(key); store.delete(key); },
  });

  const original = Buffer.from('BLOOD GROUP O-, ALLERGIC TO PENICILLIN');
  const saved = await putBytes({ userId: 'u1', buffer: original, mime: 'image/png', kind: 'reports' });
  assert.equal(saved.provider, 'blob');
  assert.equal(saved.data, undefined, 'nothing is written to the database document');
  assert.match(saved.key, /^reports\/u1\//);
  assert.equal(calls[0].access, 'private', 'the store must not be public');

  const atRest = store.get(saved.key);
  assert.ok(!atRest.includes(original), 'the provider only ever holds ciphertext');
  assert.equal(await getBytes({ provider: 'blob', key: saved.key }).then((b) => b.toString()), original.toString());

  // a Node stream and raw bytes must work too, since the SDK shape is not guaranteed
  setBlobApi({ ...await Promise.resolve({}), get: async () => ({ stream: Readable.from([atRest]) }), put: async () => ({}), del: async () => {} });
  assert.equal((await getBytes({ provider: 'blob', key: 'x' })).toString(), original.toString());
  setBlobApi({ get: async () => atRest, put: async () => ({}), del: async () => {} });
  assert.equal((await getBytes({ provider: 'blob', key: 'x' })).toString(), original.toString());

  setBlobApi({ put: async () => ({}), get: async () => atRest, del: async (key) => { deleted.push(key); } });
  await deleteBytes({ provider: 'blob', key: saved.key });
  assert.deepEqual(deleted, [saved.key]);

  // a failing provider must not break the user's delete
  setBlobApi({ put: async () => ({}), get: async () => atRest, del: async () => { throw new Error('network down'); } });
  await deleteBytes({ provider: 'blob', key: 'gone' });

  setBlobApi(null);
  assert.equal(storageProvider(), 'mongo');
});
