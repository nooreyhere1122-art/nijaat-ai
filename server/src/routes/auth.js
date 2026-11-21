import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { config, devMode } from '../config.js';
import { User } from '../models.js';
import { HttpError, wrap, parse, normalizePhone } from '../util.js';
import { sha256, randomToken } from '../services/crypto.js';
import { sendMail, audit } from '../services/notify.js';
import { requireUser, signUserToken, authLimiter } from '../middleware.js';

const router = Router();

const password = z.string().min(8, 'Use at least 8 characters')
  .regex(/[A-Za-z]/, 'Include at least one letter')
  .regex(/\d/, 'Include at least one number');
const phone = z.string().transform((value, ctx) => {
  const normalized = normalizePhone(value);
  if (!normalized) { ctx.addIssue({ code: 'custom', message: 'Enter a phone number with country code, for example +923001234567' }); return z.NEVER; }
  return normalized;
});
const fullName = z.string().trim().min(2, 'Enter your full name').max(100);
const email = z.string().trim().toLowerCase().email('Enter a valid email address');

const publicUser = (u) => ({ id: u._id, fullName: u.fullName, email: u.email, phone: u.phone, role: u.role, emailVerified: u.emailVerified });

async function sendVerification(user) {
  const token = randomToken(32);
  user.verifyTokenHash = sha256(token);
  user.verifyExpires = new Date(Date.now() + 24 * 3600_000);
  await user.save();
  const link = `${config.clientUrl}/verify-email?token=${token}`;
  await sendMail({
    to: user.email,
    subject: 'Verify your NIJAAT AI account',
    text: `Hello ${user.fullName},\n\nConfirm your email address to activate your account:\n${link}\n\nThis link expires in 24 hours.`,
  });
  // In development without SMTP the link is returned so the flow can be completed.
  return devMode.mail && !config.isProd ? link : undefined;
}

// FR-01
router.post('/register', authLimiter, wrap(async (req, res) => {
  const data = parse(z.object({ fullName, email, phone, password }), req.body);
  const existing = await User.findOne({ email: data.email });
  if (existing) throw new HttpError(409, 'This email is already registered. Log in instead.', { code: 'EMAIL_EXISTS' });
  const user = await User.create({
    fullName: data.fullName, email: data.email, phone: data.phone,
    passwordHash: await bcrypt.hash(data.password, 12),
  });
  const devLink = await sendVerification(user);
  res.status(201).json({ message: 'Account created. Check your email to verify your address.', devLink });
}));

// FR-02
router.post('/verify-email', authLimiter, wrap(async (req, res) => {
  const { token } = parse(z.object({ token: z.string().min(10) }), req.body);
  const user = await User.findOne({ verifyTokenHash: sha256(token) });
  if (!user) throw new HttpError(400, 'This verification link is not valid.', { code: 'LINK_INVALID' });
  if (user.emailVerified) return res.json({ message: 'Your email is already verified.' });
  if (user.verifyExpires < new Date()) throw new HttpError(400, 'This verification link has expired.', { code: 'LINK_EXPIRED' });
  user.emailVerified = true;
  user.verifyExpires = undefined;
  await user.save();
  res.json({ message: 'Email verified. You can now log in.' });
}));

router.post('/resend-verification', authLimiter, wrap(async (req, res) => {
  const data = parse(z.object({ email }), req.body);
  const user = await User.findOne({ email: data.email });
  let devLink;
  if (user && !user.emailVerified) devLink = await sendVerification(user);
  res.json({ message: 'If the account exists and is not verified, a new link has been sent.', devLink });
}));

// FR-03. Invalid credentials always produce the same general message (UC-1 E2).
router.post('/login', authLimiter, wrap(async (req, res) => {
  const data = parse(z.object({ email, password: z.string().min(1, 'Enter your password') }), req.body);
  const user = await User.findOne({ email: data.email });
  const ok = user && await bcrypt.compare(data.password, user.passwordHash);
  if (!ok) throw new HttpError(401, 'The email or password is incorrect.');
  if (!user.emailVerified) throw new HttpError(403, 'Verify your email address before logging in.', { code: 'EMAIL_UNVERIFIED' });
  res.json({ token: signUserToken(user), user: publicUser(user) });
}));

// FR-04
router.post('/forgot-password', authLimiter, wrap(async (req, res) => {
  const data = parse(z.object({ email }), req.body);
  const user = await User.findOne({ email: data.email });
  let devLink;
  if (user) {
    const token = randomToken(32);
    user.resetTokenHash = sha256(token);
    user.resetExpires = new Date(Date.now() + 3600_000);
    await user.save();
    const link = `${config.clientUrl}/reset-password?token=${token}`;
    await sendMail({
      to: user.email,
      subject: 'Reset your NIJAAT AI password',
      text: `Hello ${user.fullName},\n\nUse this link to choose a new password:\n${link}\n\nThe link expires in 1 hour. If you did not ask for it, ignore this email.`,
    });
    if (devMode.mail && !config.isProd) devLink = link;
  }
  res.json({ message: 'If the email is registered, a reset link has been sent.', devLink });
}));

router.post('/reset-password', authLimiter, wrap(async (req, res) => {
  const data = parse(z.object({ token: z.string().min(10), password }), req.body);
  const user = await User.findOne({ resetTokenHash: sha256(data.token) });
  if (!user || !user.resetExpires || user.resetExpires < new Date()) {
    throw new HttpError(400, 'This reset link is not valid or has expired. Request a new one.');
  }
  user.passwordHash = await bcrypt.hash(data.password, 12);
  user.resetTokenHash = undefined;
  user.resetExpires = undefined;
  await user.save();
  await audit(user._id, 'password_reset');
  res.json({ message: 'Password changed. You can now log in.' });
}));

router.get('/me', requireUser, (req, res) => res.json({ user: publicUser(req.user) }));

router.put('/me', requireUser, wrap(async (req, res) => {
  const data = parse(z.object({ fullName, phone }), req.body);
  Object.assign(req.user, data);
  await req.user.save();
  res.json({ user: publicUser(req.user) });
}));

router.post('/change-password', requireUser, wrap(async (req, res) => {
  const data = parse(z.object({ currentPassword: z.string().min(1, 'Enter your current password'), newPassword: password }), req.body);
  if (!await bcrypt.compare(data.currentPassword, req.user.passwordHash)) {
    throw new HttpError(400, 'Please correct the highlighted fields.', { fields: { currentPassword: 'The current password is incorrect' } });
  }
  req.user.passwordHash = await bcrypt.hash(data.newPassword, 12);
  await req.user.save();
  await audit(req.user._id, 'password_changed');
  res.json({ message: 'Password changed.' });
}));

export default router;
