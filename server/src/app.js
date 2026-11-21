import crypto from 'node:crypto';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config, devMode } from './config.js';
import { errorHandler, requireUser } from './middleware.js';
import { wrap } from './util.js';
import { SMSAlert, AuditLog } from './models.js';
import { mapsProvider } from './routes/hospitals.js';
import authRoutes from './routes/auth.js';
import profileRoutes from './routes/profile.js';
import qrRoutes from './routes/qr.js';
import publicRoutes from './routes/public.js';
import reportRoutes from './routes/reports.js';
import prescriptionRoutes from './routes/prescriptions.js';
import hospitalRoutes from './routes/hospitals.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  // SRS 6.4: only the deployed frontend origin may call the API.
  app.use(cors({ origin: config.clientUrl }));
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_req, res) => res.json({
    ok: true,
    services: {
      sms: devMode.sms ? 'development (logged, not sent)' : 'twilio',
      mail: devMode.mail ? 'development (logged, not sent)' : 'smtp',
      summarisation: config.gemini.key ? 'gemini' : 'not configured',
      maps: mapsProvider() === 'google' ? 'google places and routes' : 'openstreetmap (no key needed)',
    },
  }));

  app.use('/api/auth', authRoutes);
  app.use('/api/profile', profileRoutes);
  app.use('/api/qr', qrRoutes);
  app.use('/api/public', publicRoutes);
  app.use('/api/reports', reportRoutes);
  app.use('/api/prescriptions', prescriptionRoutes);
  app.use('/api/hospitals', hospitalRoutes);

  // The owner's own audit trail (BR-06).
  app.get('/api/audit', requireUser, wrap(async (req, res) => {
    const entries = await AuditLog.find({ userId: req.user._id }).sort({ timestamp: -1 }).limit(100);
    res.json({ entries: entries.map((e) => ({ action: e.action, actorType: e.actorType, actorLabel: e.actorLabel || null, detail: e.detail || null, timestamp: e.timestamp })) });
  }));

  // Twilio delivery receipts update the stored status (FR-28).
  app.post('/api/webhooks/twilio-status', express.urlencoded({ extended: false }), wrap(async (req, res) => {
    // Reject callbacks that Twilio did not sign.
    const params = req.body || {};
    const payload = `${config.apiUrl}/api/webhooks/twilio-status` + Object.keys(params).sort().map((k) => k + params[k]).join('');
    const expected = crypto.createHmac('sha1', config.twilio.token).update(payload).digest('base64');
    const given = Buffer.from(String(req.headers['x-twilio-signature'] || ''));
    if (!config.twilio.token || given.length !== Buffer.byteLength(expected) || !crypto.timingSafeEqual(given, Buffer.from(expected))) {
      return res.sendStatus(403);
    }
    const { MessageSid, MessageStatus, ErrorCode } = params;
    const map = { delivered: 'delivered', undelivered: 'failed', failed: 'failed', sent: 'sent' };
    if (MessageSid && map[MessageStatus]) {
      await SMSAlert.updateOne({ providerSid: MessageSid }, { status: map[MessageStatus], ...(ErrorCode ? { errorCode: String(ErrorCode) } : {}) });
    }
    res.sendStatus(204);
  }));

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found.' }));
  app.use(errorHandler);
  return app;
}
