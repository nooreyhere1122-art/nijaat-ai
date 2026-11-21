import { config } from '../config.js';
import { ScanEvent, SMSAlert, User } from '../models.js';
import { loadProfile } from './profile.js';
import { sendSms, audit } from './notify.js';
import { sleep } from '../util.js';

const timers = new Map();

function formatTime(date) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Karachi', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true,
  }).format(date) + ' PKT';
}

export function alertMessage(name, event) {
  const self = event.source === 'self';
  const where = event.latitude != null && event.longitude != null
    ? `Location: https://maps.google.com/?q=${event.latitude.toFixed(5)},${event.longitude.toFixed(5)}`
    : `Location was not shared by the ${self ? 'device' : 'scanning device'}.`;
  const what = self
    ? `${name} has triggered an emergency alert from their own phone on ${formatTime(event.scannedAt)}.`
    : `The emergency QR code of ${name} was scanned on ${formatTime(event.scannedAt)}.`;
  return `NIJAAT AI EMERGENCY: ${what} ${where} Details: ${config.clientUrl}/a/${event.viewToken}`;
}

/** Sends one message with up to three attempts at increasing intervals (FR-27, PER-2). One SMSAlert per attempt (FR-28). */
export async function sendWithRetry({ userId, scanEventId, kind, contactName, to, body, maxAttempts = config.alertMaxAttempts }) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = await sendSms({ to, body });
    const last = attempt === maxAttempts;
    await SMSAlert.create({
      userId, scanEventId, kind, contactName, recipientNumber: to, attempt,
      status: result.ok ? result.status : last ? 'unreachable' : 'failed',
      errorCode: result.errorCode || undefined,
      provider: result.provider,
      providerSid: result.sid || undefined,
    });
    if (result.ok) return { delivered: true, attempts: attempt };
    if (!last) await sleep(config.alertRetryBaseMs * 2 ** (attempt - 1));
  }
  return { delivered: false, attempts: maxAttempts };
}

/** Runs after the cancel buffer. Contacts are alerted in priority order (FR-26, FR-27). */
export async function dispatchAlerts(scanEventId) {
  timers.delete(String(scanEventId));
  const event = await ScanEvent.findOneAndUpdate(
    { _id: scanEventId, alertStatus: 'pending' },
    { alertStatus: 'dispatching' },
    { new: true },
  );
  if (!event) return; // cancelled or already handled
  try {
    const user = await User.findById(event.userId);
    const { data } = await loadProfile(event.userId);
    const body = alertMessage(user.fullName, event);
    let reached = 0;
    for (const contact of data.emergencyContacts) {
      const result = await sendWithRetry({
        userId: event.userId, scanEventId: event._id, kind: 'emergency',
        contactName: contact.name, to: contact.phone, body,
      });
      if (result.delivered) reached += 1;
    }
    await audit(event.userId, 'alert_dispatched', {
      actorType: 'system', detail: `${reached} of ${data.emergencyContacts.length} contacts reached`,
    });
  } finally {
    await ScanEvent.updateOne({ _id: event._id }, { alertStatus: 'dispatched' });
  }
}

export function scheduleAlert(event) {
  const delay = Math.max(0, new Date(event.dispatchAt).getTime() - Date.now());
  const timer = setTimeout(() => {
    dispatchAlerts(event._id).catch((err) => console.error('alert dispatch failed', err));
  }, delay);
  timer.unref?.();
  timers.set(String(event._id), timer);
}

export async function cancelAlert(scanEventId) {
  const event = await ScanEvent.findOneAndUpdate(
    { _id: scanEventId, alertStatus: 'pending' },
    { alertStatus: 'cancelled' },
    { new: true },
  );
  if (!event) return false;
  const timer = timers.get(String(scanEventId));
  if (timer) clearTimeout(timer);
  timers.delete(String(scanEventId));
  await audit(event.userId, 'alert_cancelled', { actorType: 'bystander' });
  return true;
}

/** After a restart, pick up alerts whose timers were lost. */
export async function recoverPendingAlerts() {
  const stuck = await ScanEvent.find({ alertStatus: { $in: ['pending', 'dispatching'] } });
  for (const event of stuck) {
    if (event.alertStatus === 'dispatching') {
      await ScanEvent.updateOne({ _id: event._id }, { alertStatus: 'pending' });
    }
    scheduleAlert(event);
  }
  return stuck.length;
}

/** Latest status per contact for the bystander's indicator (FR-19). */
export async function alertStatusFor(event) {
  const attempts = await SMSAlert.find({ scanEventId: event._id, kind: 'emergency' }).sort({ at: 1 });
  const byNumber = new Map();
  for (const a of attempts) {
    byNumber.set(a.recipientNumber, { name: a.contactName, status: a.status, attempts: a.attempt });
  }
  return {
    status: event.alertStatus,
    dispatchAt: event.dispatchAt,
    secondsLeft: event.alertStatus === 'pending'
      ? Math.max(0, Math.ceil((new Date(event.dispatchAt).getTime() - Date.now()) / 1000)) : 0,
    contacts: [...byNumber.values()],
  };
}
