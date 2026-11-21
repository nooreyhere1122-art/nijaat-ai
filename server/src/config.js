import 'dotenv/config';

const env = process.env;
const isProd = env.NODE_ENV === 'production';

function secret(name) {
  const value = env[name];
  if (value) return value;
  if (isProd) throw new Error(`${name} must be set in production`);
  return `dev-only-${name}-do-not-use-in-production`;
}

const num = (name, fallback) => (env[name] ? Number(env[name]) : fallback);

export const config = {
  env: env.NODE_ENV || 'development',
  isProd,
  port: num('PORT', 4000),
  mongoUri: env.MONGODB_URI || 'mongodb://127.0.0.1:27017/nijaat_ai',
  clientUrl: (env.CLIENT_URL || 'http://localhost:5173').replace(/\/$/, ''),
  apiUrl: (env.API_URL || '').replace(/\/$/, ''),

  jwtSecret: secret('JWT_SECRET'),
  scanSecret: secret('SCAN_SECRET'),
  encryptionKey: secret('ENCRYPTION_KEY'),
  jwtExpiresIn: env.JWT_EXPIRES_IN || '7d',

  // PER-1 / BR-05: thirty second cancel buffer before any SMS is sent.
  alertBufferMs: num('ALERT_BUFFER_MS', 30_000),
  // PER-2: three attempts at increasing intervals (base, base*2, base*4).
  alertRetryBaseMs: num('ALERT_RETRY_BASE_MS', 5_000),
  alertMaxAttempts: 3,
  // FR-14: lifetime of the time-limited scan session hash.
  scanSessionMinutes: num('SCAN_SESSION_MINUTES', 30),
  scanDedupeMinutes: num('SCAN_DEDUPE_MINUTES', 10),
  alertViewHours: num('ALERT_VIEW_HOURS', 24),

  // FR-43 / FR-48
  physicianCodeMinutes: num('PHYSICIAN_CODE_MINUTES', 10),
  physicianInactivityMinutes: num('PHYSICIAN_INACTIVITY_MINUTES', 5),
  physicianMaxCodeAttempts: 5,
  physicianMaxRequestsPerScan: 3,

  // PER-3 / PER-4
  hospitalRadiusM: 10_000,
  hospitalMaxRadiusM: num('HOSPITAL_MAX_RADIUS_M', 40_000),
  hospitalMinResults: 3,

  twilio: {
    sid: env.TWILIO_ACCOUNT_SID || '',
    token: env.TWILIO_AUTH_TOKEN || '',
    from: env.TWILIO_FROM_NUMBER || '',
  },
  smtp: {
    host: env.SMTP_HOST || '',
    port: num('SMTP_PORT', 587),
    user: env.SMTP_USER || '',
    pass: env.SMTP_PASS || '',
    from: env.MAIL_FROM || 'NIJAAT AI <no-reply@nijaat.local>',
  },
  gemini: {
    key: env.GEMINI_API_KEY || '',
    model: env.GEMINI_MODEL || 'gemini-2.5-flash',
  },
  googleMapsKey: env.GOOGLE_MAPS_SERVER_KEY || '',
  // 'osm' (OpenStreetMap, no key) or 'google'. Empty picks google when a key is set.
  mapsProvider: (env.MAPS_PROVIDER || '').trim(),
  ocrServiceUrl: (env.OCR_SERVICE_URL || 'http://127.0.0.1:4100').replace(/\/$/, ''),
  // Uploaded files go to Vercel Blob when a token is set, otherwise into MongoDB.
  // Either way the bytes are encrypted before they leave this process.
  blobToken: env.BLOB_READ_WRITE_TOKEN || '',
  maxUploadBytes: num('MAX_UPLOAD_MB', 10) * 1024 * 1024,
  // Requests per IP: auth is per 15 minutes, public per minute. Raise for shared or
  // carrier-grade NAT addresses, where many real users share one IP.
  authRateLimit: num('AUTH_RATE_LIMIT', 30),
  publicRateLimit: num('PUBLIC_RATE_LIMIT', 60),
};

export const devMode = {
  get sms() { return !(config.twilio.sid && config.twilio.token && config.twilio.from); },
  get mail() { return !config.smtp.host; },
};
