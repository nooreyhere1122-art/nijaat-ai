import nodemailer from 'nodemailer';
import { config, devMode } from '../config.js';
import { AuditLog } from '../models.js';

let transport;

/** Sends an email. Without SMTP settings it logs the message instead (development mode). */
export async function sendMail({ to, subject, text }) {
  if (devMode.mail) {
    if (config.env !== 'test') console.log(`[mail:dev] to=${to} subject="${subject}"\n${text}\n`);
    return { dev: true };
  }
  transport ||= nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.port === 465,
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
  });
  await transport.sendMail({ from: config.smtp.from, to, subject, text });
  return { dev: false };
}

// Tests replace this to simulate gateway failures.
let smsOverride = null;
export const setSmsOverride = (fn) => { smsOverride = fn; };

/**
 * Sends one SMS through Twilio. Returns { ok, status, sid, errorCode, provider }.
 * Without Twilio settings the message is logged and reported as sent (development mode).
 */
export async function sendSms({ to, body }) {
  if (smsOverride) return smsOverride({ to, body });
  if (devMode.sms) {
    if (config.env !== 'test') console.log(`[sms:dev] to=${to}\n${body}\n`);
    return { ok: true, status: 'sent', sid: null, errorCode: null, provider: 'dev' };
  }
  const { sid, token, from } = config.twilio;
  const form = new URLSearchParams({ To: to, From: from, Body: body });
  if (config.apiUrl) form.set('StatusCallback', `${config.apiUrl}/api/webhooks/twilio-status`);
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form,
      signal: AbortSignal.timeout(15_000),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, status: 'failed', sid: null, errorCode: String(json.code || res.status), provider: 'twilio' };
    }
    return { ok: true, status: 'sent', sid: json.sid, errorCode: null, provider: 'twilio' };
  } catch (err) {
    return { ok: false, status: 'failed', sid: null, errorCode: err.name === 'TimeoutError' ? 'TIMEOUT' : 'NETWORK', provider: 'twilio' };
  }
}

export function audit(userId, action, { actorType = 'user', actorLabel, detail } = {}) {
  return AuditLog.create({ userId, action, actorType, actorLabel, detail }).catch((err) => {
    console.error('audit log failed', err.message);
  });
}
