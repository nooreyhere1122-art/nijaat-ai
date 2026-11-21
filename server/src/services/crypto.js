import crypto from 'node:crypto';
import { config } from '../config.js';

const key = crypto.createHash('sha256').update(config.encryptionKey).digest();

/** AES-256-GCM. Output layout: iv(12) | tag(16) | ciphertext. (CO-5) */
export function encryptBuffer(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]);
}

export function decryptBuffer(sealed) {
  const buf = Buffer.isBuffer(sealed) ? sealed : Buffer.from(sealed.buffer ?? sealed);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]);
}

export const seal = (obj) => encryptBuffer(Buffer.from(JSON.stringify(obj), 'utf8'));
export const open = (sealed) => JSON.parse(decryptBuffer(sealed).toString('utf8'));

export const sha256 = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');
export const hmac = (value) => crypto.createHmac('sha256', config.scanSecret).update(String(value)).digest('hex');
export const randomToken = (bytes = 16) => crypto.randomBytes(bytes).toString('base64url');
export const randomDigits = (n = 6) => String(crypto.randomInt(0, 10 ** n)).padStart(n, '0');

export function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
