import jwt from 'jsonwebtoken';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { config } from './config.js';
import { User, ScanEvent, PhysicianSession } from './models.js';
import { HttpError, wrap } from './util.js';
import { audit } from './services/notify.js';

const bearer = (req) => {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7) : null;
};

export const signUserToken = (user) =>
  jwt.sign({ typ: 'user', sub: String(user._id), role: user.role }, config.jwtSecret, { expiresIn: config.jwtExpiresIn });

/** Registered user session (FR-03). */
export const requireUser = wrap(async (req, _res, next) => {
  const token = bearer(req);
  if (!token) throw new HttpError(401, 'Please log in to continue.');
  let payload;
  try { payload = jwt.verify(token, config.jwtSecret); } catch { throw new HttpError(401, 'Your session has expired. Please log in again.'); }
  if (payload.typ !== 'user') throw new HttpError(401, 'Please log in to continue.');
  const user = await User.findById(payload.sub);
  if (!user) throw new HttpError(401, 'Please log in to continue.');
  req.user = user;
  next();
});

/** Role based access control (FR-06). */
export const authorizeRole = (...roles) => (req, _res, next) => {
  if (!roles.includes(req.user.role)) return next(new HttpError(403, 'You do not have permission to do this.'));
  next();
};

export const signScanSession = (event) =>
  jwt.sign({ typ: 'scan', sid: String(event._id) }, config.scanSecret, { expiresIn: `${config.scanSessionMinutes}m` });

/** Time-limited scan session hash, verified on every public request (FR-14). */
export const requireScanSession = wrap(async (req, _res, next) => {
  const token = bearer(req);
  if (!token) throw new HttpError(401, 'Scan the QR code again to continue.', { code: 'SESSION_MISSING' });
  let payload;
  try { payload = jwt.verify(token, config.scanSecret); } catch {
    throw new HttpError(401, 'This scan session has expired. Scan the QR code again.', { code: 'SESSION_EXPIRED' });
  }
  if (payload.typ !== 'scan') throw new HttpError(401, 'Scan the QR code again to continue.', { code: 'SESSION_MISSING' });
  const event = await ScanEvent.findById(payload.sid);
  if (!event) throw new HttpError(401, 'Scan the QR code again to continue.', { code: 'SESSION_MISSING' });
  req.scanEvent = event;
  next();
});

export const signPhysicianSession = (session) =>
  jwt.sign({ typ: 'phys', psid: String(session._id) }, config.scanSecret, { expiresIn: '8h' });

/** Physician session with inactivity expiry and audit (FR-48). */
export const requirePhysician = wrap(async (req, _res, next) => {
  const token = bearer(req);
  const expired = () => new HttpError(401, 'The physician session has ended. Verify access again.', { code: 'PHYSICIAN_SESSION_EXPIRED' });
  if (!token) throw expired();
  let payload;
  try { payload = jwt.verify(token, config.scanSecret); } catch { throw expired(); }
  if (payload.typ !== 'phys') throw expired();
  const session = await PhysicianSession.findById(payload.psid);
  if (!session || session.ended) throw expired();
  const idleMs = Date.now() - session.lastActivity.getTime();
  if (idleMs > config.physicianInactivityMinutes * 60_000) {
    session.ended = true;
    await session.save();
    await audit(session.userId, 'physician_session_expired', { actorType: 'system', actorLabel: session.physician?.name });
    throw expired();
  }
  session.lastActivity = new Date();
  await session.save();
  req.physicianSession = session;
  next();
});

export function upload(allowedMimes) {
  const handler = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: config.maxUploadBytes, files: 1 },
    fileFilter: (_req, file, cb) => {
      if (allowedMimes.includes(file.mimetype)) return cb(null, true);
      cb(new HttpError(415, `Unsupported file type. Accepted formats: ${allowedMimes.map((m) => m.split('/')[1].toUpperCase()).join(', ')}.`));
    },
  }).single('file');
  return (req, res, next) => handler(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') {
      return next(new HttpError(413, `The file is too large. The limit is ${Math.round(config.maxUploadBytes / 1048576)} MB.`));
    }
    next(err);
  });
}

const limiter = (windowMs, max) => rateLimit({
  windowMs, max, standardHeaders: true, legacyHeaders: false,
  skip: () => config.env === 'test',
  message: { error: 'Too many requests. Please wait a moment and try again.' },
});
export const authLimiter = limiter(15 * 60_000, config.authRateLimit);
export const publicLimiter = limiter(60_000, config.publicRateLimit);

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, _req, res, _next) {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, ...err.extra });
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'The request is too large.' });
  if (err?.name === 'CastError') return res.status(404).json({ error: 'Not found.' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on our side. Please try again.' });
}
