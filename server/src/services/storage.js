/*
 * Where uploaded reports and prescription photos live.
 *
 * Two providers:
 *   mongo  (default) the encrypted bytes sit in the StoredFile document.
 *   blob   the encrypted bytes go to Vercel Blob in a private store, and only the
 *          object key is kept in the database. Set BLOB_READ_WRITE_TOKEN to use it.
 *
 * Every byte is encrypted with AES-256-GCM before it leaves this process and decrypted
 * after it comes back, so the storage provider only ever holds ciphertext. That holds
 * whichever provider is in use, and it is why a leaked object URL would expose nothing.
 */
import { config } from '../config.js';
import { encryptBuffer, decryptBuffer, randomToken } from './crypto.js';

let forcedProvider = null;
export const storageProvider = () => forcedProvider || (config.blobToken ? 'blob' : 'mongo');

// Tests stand in for the SDK here, so the put, get and delete paths can be exercised
// without a real Vercel Blob token.
let blobModule = null;
export function setBlobApi(api, provider = 'blob') {
  blobModule = api;
  forcedProvider = api ? provider : null;
}

async function blobApi() {
  if (!blobModule) {
    try {
      blobModule = await import('@vercel/blob');
    } catch {
      throw new Error('BLOB_READ_WRITE_TOKEN is set but the @vercel/blob package is not installed.');
    }
  }
  return blobModule;
}

/** Handles whichever shape the SDK hands back: a web stream, a Node stream or bytes. */
async function toBuffer(result) {
  const body = result?.stream ?? result?.body ?? result;
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  if (body && typeof body.getReader === 'function') return Buffer.from(await new Response(body).arrayBuffer());
  if (body && typeof body[Symbol.asyncIterator] === 'function') {
    const chunks = [];
    for await (const chunk of body) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
  }
  throw new Error('The storage provider returned a response this code cannot read.');
}

/** Encrypts and stores the bytes. Returns the fields to save on a StoredFile. */
export async function putBytes({ userId, buffer, mime, kind }) {
  const sealed = encryptBuffer(buffer);
  if (storageProvider() === 'mongo') {
    return { provider: 'mongo', data: sealed, size: buffer.length, mime };
  }
  const { put } = await blobApi();
  const key = `${kind}/${userId}/${randomToken(12)}`;
  const saved = await put(key, sealed, {
    access: 'private',
    contentType: 'application/octet-stream', // it is ciphertext, not an image or a PDF
    addRandomSuffix: false,
    token: config.blobToken,
  });
  return { provider: 'blob', key: saved?.pathname || key, size: buffer.length, mime };
}

/** Fetches and decrypts the bytes of a StoredFile. */
export async function getBytes(file) {
  if ((file.provider || 'mongo') === 'mongo') return decryptBuffer(file.data);
  const { get } = await blobApi();
  const result = await get(file.key, { access: 'private', token: config.blobToken });
  return decryptBuffer(await toBuffer(result));
}

/** Removes the bytes. Never throws: a failed cleanup must not block the user's delete. */
export async function deleteBytes(file) {
  if ((file.provider || 'mongo') === 'mongo') return;
  try {
    const { del } = await blobApi();
    await del(file.key, { token: config.blobToken });
  } catch (err) {
    console.error('could not delete stored object', file.key, err.message);
  }
}
