const BASE = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '');

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error || 'The request failed. Please try again.');
    this.status = status;
    this.body = body || {};
    this.fields = body?.fields || {};
    this.code = body?.code;
  }
}

export const tokens = {
  get user() { return localStorage.getItem('nijaat.token'); },
  set user(v) { v ? localStorage.setItem('nijaat.token', v) : localStorage.removeItem('nijaat.token'); },
  get scan() { try { return JSON.parse(sessionStorage.getItem('nijaat.scan') || 'null'); } catch { return null; } },
  set scan(v) { v ? sessionStorage.setItem('nijaat.scan', JSON.stringify(v)) : sessionStorage.removeItem('nijaat.scan'); },
  get physician() { return sessionStorage.getItem('nijaat.physician'); },
  set physician(v) { v ? sessionStorage.setItem('nijaat.physician', v) : sessionStorage.removeItem('nijaat.physician'); },
};

async function request(method, path, { body, form, token, raw } = {}) {
  const headers = {};
  const bearer = token === undefined ? tokens.user : token;
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(BASE + path, { method, headers, body: form || (body !== undefined ? JSON.stringify(body) : undefined) });
  } catch {
    throw new ApiError(0, { error: 'No network connection. Check your internet and try again.', code: 'OFFLINE' });
  }
  if (raw && res.ok) return res.blob();
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && token === undefined && tokens.user) {
      tokens.user = null;
      window.dispatchEvent(new Event('nijaat:logout'));
    }
    throw new ApiError(res.status, json);
  }
  return json;
}

// Two components mounting together (the shell and the page) often need the same endpoint.
// A GET already in flight is by definition current, so they share it instead of asking twice.
// Nothing is cached after it resolves, so no screen ever shows stale medical data.
const inFlight = new Map();

function sharedGet(path, opts = {}) {
  if (opts.raw || opts.form || opts.token !== undefined) return request('GET', path, opts);
  const existing = inFlight.get(path);
  if (existing) return existing;
  const promise = request('GET', path, opts).finally(() => { inFlight.delete(path); });
  inFlight.set(path, promise);
  return promise;
}

export const api = {
  get: (path, opts) => sharedGet(path, opts),
  post: (path, body, opts) => request('POST', path, { body: body ?? {}, ...opts }),
  put: (path, body, opts) => request('PUT', path, { body, ...opts }),
  del: (path, opts) => request('DELETE', path, opts),
  upload: (path, file, opts) => {
    const form = new FormData();
    form.append('file', file, file.name || 'upload');
    return request('POST', path, { form, ...opts });
  },
  blobUrl: async (path) => URL.createObjectURL(await request('GET', path, { raw: true })),
};

// A plain YYYY-MM-DD is a calendar date, not an instant: parse it as local so it does not
// shift a day in timezones behind UTC. Anything else is a real timestamp.
const toDate = (d) => (/^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(`${d}T00:00:00`) : new Date(d));

export const fmtDateTime = (d) => (d ? new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
export const fmtDate = (d) => (d ? toDate(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
