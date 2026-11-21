#!/usr/bin/env node
/*
 * Checks every service the app talks to and says which ones are actually working.
 *
 *   npm run check
 *
 * It never sends an SMS or an email: credentials are verified by reading from each
 * service, not by delivering anything. The only call that costs money is the Google
 * Maps one, and only when a Google key is set: one call against the free allowance.
 */
import mongoose from 'mongoose';
import nodemailer from 'nodemailer';
import { config } from '../src/config.js';

const results = [];
const record = (name, state, detail) => results.push({ name, state, detail });
const ok = (name, detail) => record(name, 'ok', detail);
const off = (name, detail) => record(name, 'off', detail);
const bad = (name, detail) => record(name, 'bad', detail);

const timeout = (ms) => AbortSignal.timeout(ms);
const short = (err) => String(err?.message || err).split('\n')[0].slice(0, 120);
/** "fetch failed" tells nobody anything: say which host could not be reached. */
const reach = (host, err) => {
  const msg = short(err);
  return /fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN/i.test(msg)
    ? `could not reach ${host}. Check your internet connection or firewall (${msg})`
    : msg;
};

/** A check that never answers must not hang the whole report. */
async function withLimit(name, ms, fn) {
  let timer;
  const expired = Symbol('expired');
  const result = await Promise.race([
    fn().then(() => null, (err) => { bad(name, short(err)); return null; }),
    new Promise((resolve) => { timer = setTimeout(() => resolve(expired), ms); }),
  ]);
  clearTimeout(timer);
  if (result === expired) bad(name, `no answer within ${Math.round(ms / 1000)}s. The host may be unreachable or blocked by a firewall`);
}

/* ---------- secrets ---------- */
function checkSecrets() {
  const weak = [];
  for (const [name, value] of [['JWT_SECRET', config.jwtSecret], ['SCAN_SECRET', config.scanSecret], ['ENCRYPTION_KEY', config.encryptionKey]]) {
    if (value.startsWith('dev-only-')) weak.push(name);
  }
  if (weak.length === 3) {
    off('Secrets', 'all three are development defaults. Fine locally; the API refuses to start in production without real ones');
  } else if (weak.length) {
    bad('Secrets', `${weak.join(', ')} still on the development default`);
  } else {
    ok('Secrets', 'all three set. Keep a copy of ENCRYPTION_KEY somewhere safe: without it, stored medical data cannot be read');
  }
}

/* ---------- database ---------- */
async function checkMongo() {
  try {
    await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 8000 });
    const { db } = mongoose.connection;
    await db.admin().command({ ping: 1 });
    const users = await db.collection('users').countDocuments().catch(() => 0);
    ok('MongoDB', `connected to "${db.databaseName}", ${users} registered user${users === 1 ? '' : 's'}`);
  } catch (err) {
    bad('MongoDB', short(err));
  } finally {
    await mongoose.disconnect().catch(() => {});
  }
}

/* ---------- OCR service ---------- */
async function checkOcr() {
  try {
    const res = await fetch(`${config.ocrServiceUrl}/health`, { signal: timeout(8000) });
    if (res.ok) ok('OCR service', `reachable at ${config.ocrServiceUrl}`);
    else bad('OCR service', `${config.ocrServiceUrl} returned ${res.status}`);
  } catch {
    bad('OCR service', `not reachable at ${config.ocrServiceUrl}. Start it with: cd ocr-service && npm start`);
  }
}

/* ---------- hospital search ---------- */
async function checkMaps() {
  const provider = config.mapsProvider || (config.googleMapsKey ? 'google' : 'osm');
  // Lahore, just to prove the service answers.
  const [lat, lng] = [31.5204, 74.3587];
  if (provider === 'osm') {
    try {
      const res = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'NIJAAT-AI/1.0 (setup check)' },
        body: new URLSearchParams({ data: `[out:json][timeout:20];nwr["amenity"="hospital"](around:3000,${lat},${lng});out center tags;` }).toString(),
        signal: timeout(30000),
      });
      if (!res.ok) return bad('Hospital search', `OpenStreetMap returned ${res.status}`);
      const json = await res.json();
      const named = (json.elements || []).filter((e) => e.tags?.name);
      return named.length
        ? ok('Hospital search', `OpenStreetMap, no key needed. ${named.length} hospitals within 3 km of central Lahore, e.g. ${named[0].tags.name}`)
        : bad('Hospital search', 'OpenStreetMap answered but returned nothing. Check coverage in your own city before relying on it');
    } catch (err) {
      return bad('Hospital search', reach('overpass-api.de', err));
    }
  }
  try {
    const res = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': config.googleMapsKey, 'X-Goog-FieldMask': 'places.id,places.displayName' },
      body: JSON.stringify({ includedTypes: ['hospital'], maxResultCount: 1, locationRestriction: { circle: { center: { latitude: lat, longitude: lng }, radius: 3000 } } }),
      signal: timeout(15000),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = json?.error?.message || `HTTP ${res.status}`;
      return bad('Hospital search', `Google rejected the key: ${msg.slice(0, 110)}`);
    }
    ok('Hospital search', `Google Places answered. Make sure Routes API is enabled too, for live travel times`);
  } catch (err) {
    bad('Hospital search', reach('places.googleapis.com', err));
  }
}

/* ---------- report summarisation ---------- */
async function checkGemini() {
  if (!config.gemini.key) {
    return off('Report summaries', 'GEMINI_API_KEY not set. Uploads still work and are stored encrypted; only the summary is unavailable');
  }
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${config.gemini.model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.gemini.key },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'Reply with the single word: ok' }] }], generationConfig: { maxOutputTokens: 20 } }),
      signal: timeout(30000),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = json?.error?.message || `HTTP ${res.status}`;
      if (res.status === 429) return bad('Report summaries', `free-tier quota reached: ${msg.slice(0, 100)}`);
      if (res.status === 404) return bad('Report summaries', `model "${config.gemini.model}" not available to this key. Copy the exact model id from AI Studio`);
      return bad('Report summaries', `Gemini rejected the key: ${msg.slice(0, 110)}`);
    }
    ok('Report summaries', `Gemini "${config.gemini.model}" answered. On the free tier, Google may use requests to improve its products: move to a paid tier before real patient reports go through it`);
  } catch (err) {
    bad('Report summaries', reach('generativelanguage.googleapis.com', err));
  }
}

/* ---------- email ---------- */
async function checkMail() {
  if (!config.smtp.host) {
    return off('Email', 'SMTP_HOST not set. Verification and reset links are printed in the server log and shown on screen instead');
  }
  try {
    const transport = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.port === 465,
      auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 10000,
      dnsTimeout: 10000,
    });
    await transport.verify(); // opens and authenticates, sends nothing
    ok('Email', `${config.smtp.host}:${config.smtp.port} accepted the login`);
  } catch (err) {
    const msg = short(err);
    bad('Email', /invalid login|535|auth/i.test(msg)
      ? `login refused. For Gmail you need 2-step verification on and an App Password, not your normal password (${msg})`
      : msg);
  }
}

/* ---------- SMS ---------- */
async function checkTwilio() {
  const { sid, token, from } = config.twilio;
  if (!(sid && token && from)) {
    return off('SMS', 'TWILIO_* not set. Alerts are written to the server log and nobody is notified');
  }
  const auth = 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64');
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}.json`, { headers: { Authorization: auth }, signal: timeout(15000) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return bad('SMS', `Twilio rejected the credentials: ${(json.message || `HTTP ${res.status}`).slice(0, 110)}`);

    const trial = String(json.type || '').toLowerCase() === 'trial';
    const numbers = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/IncomingPhoneNumbers.json?PageSize=50`, { headers: { Authorization: auth }, signal: timeout(15000) })
      .then((r) => r.json()).catch(() => ({}));
    const owned = (numbers.incoming_phone_numbers || []).map((n) => n.phone_number);
    const hasFrom = owned.includes(from);

    const notes = [`account is ${trial ? 'a TRIAL' : 'full'}`];
    if (!hasFrom && owned.length) notes.push(`TWILIO_FROM_NUMBER ${from} is not one of your numbers (${owned.join(', ')})`);
    if (trial) notes.push('a trial can only send to numbers you have verified in the Twilio console');
    notes.push('Twilio says two-way SMS is unsupported in Pakistan and sender IDs may be rewritten: test delivery on Jazz, Zong, Telenor and Ufone before you rely on it');

    const state = !hasFrom && owned.length ? bad : ok;
    state('SMS', notes.join('. '));
  } catch (err) {
    bad('SMS', reach('api.twilio.com', err));
  }
}

/* ---------- file storage ---------- */
async function checkBlob() {
  if (!config.blobToken) {
    return off('File storage', 'BLOB_READ_WRITE_TOKEN not set. Uploads are stored encrypted inside MongoDB, which is fine until the database is small and the files are many');
  }
  try {
    const { list } = await import('@vercel/blob');
    const res = await list({ limit: 1, token: config.blobToken });
    ok('File storage', `Vercel Blob answered, ${res.blobs?.length ? 'store has files' : 'store is empty'}. Make sure it is a PRIVATE store`);
  } catch (err) {
    bad('File storage', reach('blob.vercel-storage.com', err));
  }
}

/* ---------- run ---------- */
const ICON = { ok: '  OK  ', off: ' OFF  ', bad: ' FAIL ' };

console.log(`\nNIJAAT AI: checking services (${config.env})\n`);
checkSecrets();
await withLimit('MongoDB', 15000, checkMongo);
await withLimit('OCR service', 12000, checkOcr);
await Promise.all([
  withLimit('Hospital search', 40000, checkMaps),
  withLimit('Report summaries', 40000, checkGemini),
  withLimit('Email', 25000, checkMail),
  withLimit('SMS', 25000, checkTwilio),
  withLimit('File storage', 25000, checkBlob),
]);

const seen = new Set();
const unique = results.filter((r) => (seen.has(r.name) ? false : seen.add(r.name)));
results.length = 0;
results.push(...unique);

const order = { ok: 0, off: 1, bad: 2 };
results.sort((a, b) => order[a.state] - order[b.state]);
for (const r of results) {
  console.log(`[${ICON[r.state]}] ${r.name.padEnd(17)} ${r.detail}`);
}

const broken = results.filter((r) => r.state === 'bad');
const notSet = results.filter((r) => r.state === 'off');
console.log('');
if (broken.length) {
  console.log(`${broken.length} service${broken.length === 1 ? '' : 's'} configured but not working: ${broken.map((r) => r.name).join(', ')}`);
} else {
  console.log('Nothing configured is broken.');
}
if (notSet.length) console.log(`Not set up yet (the app runs without them): ${notSet.map((r) => r.name).join(', ')}`);
console.log('');
process.exit(broken.length ? 1 : 0); // sockets left open by a stalled check must not hold us here
