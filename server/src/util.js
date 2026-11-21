export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** Normalise to E.164-like form. Pakistani local numbers (03xx...) become +923xx... */
export function normalizePhone(input) {
  let p = String(input || '').replace(/[\s\-().]/g, '');
  if (/^03\d{9}$/.test(p)) p = '+92' + p.slice(1);
  else if (/^00\d+$/.test(p)) p = '+' + p.slice(2);
  else if (/^92\d{10}$/.test(p)) p = '+' + p;
  return /^\+\d{10,15}$/.test(p) ? p : null;
}

export function parse(schema, data) {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  const fields = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join('.') || '_';
    if (!fields[key]) fields[key] = issue.message;
  }
  throw new HttpError(400, 'Please correct the highlighted fields.', { fields });
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function haversineM(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
