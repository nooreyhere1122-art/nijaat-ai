#!/usr/bin/env node
/*
 * Builds server/.env: generates the secrets itself and asks you for the rest.
 *
 *   npm run setup
 *
 * Every value you type goes straight into the file on this machine. Nothing is printed
 * back to the screen and nothing leaves your computer. Keys belong here, never in a chat
 * window or a commit.
 *
 * Run it again any time: values already in .env are kept, and you are only asked for
 * what is still empty.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envPath = path.join(root, '.env');
const examplePath = path.join(root, '.env.example');

const secret = () => crypto.randomBytes(32).toString('base64');

function parseEnv(text) {
  const out = new Map();
  for (const line of text.split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out.set(m[1], m[2]);
  }
  return out;
}

const existing = fs.existsSync(envPath) ? parseEnv(fs.readFileSync(envPath, 'utf8')) : new Map();
const template = fs.readFileSync(examplePath, 'utf8');
const values = new Map(parseEnv(template));           // defaults and comments order
for (const [k, v] of existing) if (v.trim()) values.set(k, v);

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const kept = [];
const filled = [];
let inputClosed = false;
rl.on('close', () => { inputClosed = true; });

const has = (key) => Boolean((values.get(key) || '').trim());

/** Resolves to '' when the input ends, so Ctrl+D or a pipe still writes a usable file. */
async function question(prompt) {
  if (inputClosed) return '';
  const answer = await Promise.race([
    rl.question(prompt),
    new Promise((resolve) => rl.once('close', () => resolve(''))),
  ]);
  return String(answer || '').trim();
}

async function ask(key, prompt, { fallback = '', always = false } = {}) {
  const current = (values.get(key) || '').trim();
  if (current && !always) { kept.push(key); return current; }
  const shown = current || fallback;
  const answer = await question(`${prompt}${shown ? `\n  [Enter keeps: ${shown}]` : ''}\n  > `);
  if (answer) { values.set(key, answer); filled.push(key); return answer; }
  values.set(key, shown);
  if (current) kept.push(key);
  return shown;
}

console.log(`
NIJAAT AI: filling ${path.relative(process.cwd(), envPath)}

Press Enter to skip anything you do not have yet. The app runs without every one of them,
and you can run this again later. Nothing you type is shown on screen again.
`);

if (existing.size) console.log('An .env already exists: values in it are kept, and you are only asked for the empty ones.\n');

/* ---------- secrets, generated here ---------- */
const generated = [];
for (const key of ['JWT_SECRET', 'SCAN_SECRET', 'ENCRYPTION_KEY']) {
  if (has(key)) { kept.push(key); continue; }
  values.set(key, secret());
  generated.push(key);
}

/* ---------- database and address ---------- */
await ask('MONGODB_URI', 'MongoDB connection string (local, or an Atlas one starting mongodb+srv://)',
  { fallback: 'mongodb://127.0.0.1:27017/nijaat_ai', always: true });
await ask('CLIENT_URL', 'Address the web app runs on. This goes inside every QR code, so on a real\n  server use the final https address, not localhost',
  { fallback: 'http://localhost:5173', always: true });

/* ---------- Gemini ---------- */
console.log('\nReport summaries (Google AI Studio, free, no card: https://aistudio.google.com/apikey)');
await ask('GEMINI_API_KEY', 'Paste the Gemini API key, or Enter to skip');

/* ---------- email ---------- */
console.log('\nEmail for verification and password reset.');
if (!has('SMTP_HOST')) {
  const resendKey = await question('Paste a Resend API key (starts with re_), or Enter to choose another provider\n  > ');
  if (resendKey) {
    values.set('SMTP_HOST', 'smtp.resend.com');
    values.set('SMTP_PORT', '465');
    values.set('SMTP_USER', 'resend');
    values.set('SMTP_PASS', resendKey);
    filled.push('SMTP_* (Resend)');
    const from = await question('  Sender address. It MUST be on a domain you verified in Resend.\n  Without a verified domain, Resend only delivers to your own account address.\n  > ');
    if (from) values.set('MAIL_FROM', from.includes('<') ? from : `NIJAAT AI <${from}>`);
  } else {
    await ask('SMTP_HOST', 'SMTP host (Gmail: smtp.gmail.com), or Enter to skip email entirely');
    if (has('SMTP_HOST')) {
      await ask('SMTP_PORT', 'SMTP port. Enter for 587', { fallback: '587' });
      await ask('SMTP_USER', 'SMTP username');
      await ask('SMTP_PASS', 'SMTP password. For Gmail this is an App Password, not your normal password');
      await ask('MAIL_FROM', 'Sender address shown to the user');
    }
  }
} else kept.push('SMTP_*');

/* ---------- SMS ---------- */
console.log('\nSMS alerts (Twilio). There is no free provider that reliably delivers in Pakistan.');
console.log('Skip this and alerts are written to the server log instead, so nothing is sent.');
await ask('TWILIO_ACCOUNT_SID', 'Twilio Account SID (starts with AC), or Enter to skip');
if (has('TWILIO_ACCOUNT_SID')) {
  await ask('TWILIO_AUTH_TOKEN', 'Twilio Auth Token');
  await ask('TWILIO_FROM_NUMBER', 'Twilio phone number to send from, in +92... form');
}

/* ---------- write ---------- */
let out = template;
for (const [key, value] of values) {
  const re = new RegExp(`^${key}=.*$`, 'm');
  out = re.test(out) ? out.replace(re, `${key}=${value}`) : `${out}\n${key}=${value}`;
}
fs.writeFileSync(envPath, out, { mode: 0o600 });
fs.chmodSync(envPath, 0o600);
rl.close();

console.log(`
Written to ${path.relative(process.cwd(), envPath)} (readable only by you).

  Generated for you : ${generated.length ? generated.join(', ') : 'none, the file already had them'}
  You filled in     : ${filled.length ? filled.join(', ') : 'nothing'}
  Already there     : ${kept.length ? [...new Set(kept)].join(', ') : 'nothing'}
`);

if (generated.includes('ENCRYPTION_KEY')) {
  console.log(`ENCRYPTION_KEY encrypts every medical profile, report and prescription.
Copy ${path.relative(process.cwd(), envPath)} somewhere safe. Lose that key and the stored
data cannot be read again, by you or by anyone.
`);
}

console.log(`.env is in .gitignore, so it will not be committed. Never paste these values into a
chat, an issue or a screenshot.

Next:  npm run check    to see which of them actually work.
`);
