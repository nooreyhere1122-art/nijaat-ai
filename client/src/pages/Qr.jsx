import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import QRCode from 'qrcode';
import { Download, RefreshCw, Power, QrCode as QrIcon, MapPin } from 'lucide-react';
import { api, fmtDateTime } from '../api.js';
import { Banner, Confirm, ErrorState, PageLoading, useAsync, useToast } from '../ui.jsx';
import { QrStatusChip } from '../Shell.jsx';

const TEMPLATES = [['classic', 'Classic'], ['bold', 'Bold header'], ['minimal', 'Minimal']];
const SIZES = { small: { label: 'Small · 4 cm', mm: 40, px: 800 }, medium: { label: 'Medium · 6 cm', mm: 60, px: 1200 }, large: { label: 'Large · 9 cm', mm: 90, px: 1800 } };
const INDICATORS = [['cross', 'Red cross'], ['text', 'Emergency Medical Info'], ['both', 'Both'], ['none', 'None']];

/** Draws the printable sticker (FR-10, FR-11). `width` is the sticker width in pixels. */
export async function renderSticker(canvas, { url, template, indicator, width }) {
  await document.fonts?.ready;
  const u = width / 100; // layout unit: 1% of the width
  const showCross = indicator === 'cross' || indicator === 'both';
  const showText = indicator === 'text' || indicator === 'both';
  const minimal = template === 'minimal';
  const headerH = minimal ? 0 : 18 * u;
  const pad = 6 * u;
  const qrSize = width - pad * 2;
  const textH = showText ? 11 * u : 0;
  const footerH = 7 * u;
  const height = headerH + pad + qrSize + textH + footerH + (minimal ? pad / 2 : 0);

  canvas.width = Math.round(width); canvas.height = Math.round(height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (!minimal) {
    ctx.fillStyle = template === 'bold' ? '#2E1F1A' : '#FFFFFF';
    ctx.fillRect(0, 0, width, headerH);
    ctx.fillStyle = template === 'bold' ? '#FFFFFF' : '#2E1F1A';
    ctx.font = `700 ${6.4 * u}px "IBM Plex Sans", Arial, sans-serif`;
    ctx.textBaseline = 'middle';
    const label = 'SCAN IN EMERGENCY';
    const crossW = showCross ? 10 * u : 0;
    const textW = ctx.measureText(label).width;
    const startX = (width - (crossW + (showCross ? 3 * u : 0) + textW)) / 2;
    if (showCross) drawCross(ctx, startX, headerH / 2 - 5 * u, 10 * u);
    ctx.textAlign = 'left';
    ctx.fillText(label, startX + crossW + (showCross ? 3 * u : 0), headerH / 2 + 0.4 * u);
  }

  const tmp = document.createElement('canvas');
  await QRCode.toCanvas(tmp, url, { errorCorrectionLevel: 'H', margin: 2, width: Math.round(qrSize), color: { dark: '#000000', light: '#FFFFFF' } });
  ctx.drawImage(tmp, pad, headerH + (minimal ? pad : pad / 2), qrSize, qrSize);
  let y = headerH + (minimal ? pad : pad / 2) + qrSize;

  if (minimal && showCross) drawCross(ctx, width - pad - 9 * u, y + 1.5 * u, 8 * u);
  if (showText) {
    ctx.fillStyle = '#A8261D'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `700 ${5.6 * u}px "IBM Plex Sans", Arial, sans-serif`;
    ctx.fillText('EMERGENCY MEDICAL INFO', width / 2, y + textH / 2);
    y += textH;
  }
  ctx.fillStyle = '#2E1F1A'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = `500 ${3.4 * u}px "IBM Plex Sans", Arial, sans-serif`;
  ctx.fillText('NIJAAT AI · no app or login needed', width / 2, y + footerH / 2);

  ctx.strokeStyle = '#2E1F1A'; ctx.lineWidth = Math.max(2, 0.8 * u);
  ctx.strokeRect(ctx.lineWidth / 2, ctx.lineWidth / 2, canvas.width - ctx.lineWidth, canvas.height - ctx.lineWidth);
}

function drawCross(ctx, x, y, s) {
  ctx.fillStyle = '#FFFFFF'; ctx.fillRect(x, y, s, s);
  ctx.fillStyle = '#C8201A';
  ctx.fillRect(x + s * 0.38, y + s * 0.12, s * 0.24, s * 0.76);
  ctx.fillRect(x + s * 0.12, y + s * 0.38, s * 0.76, s * 0.24);
}

/* ---------- U-06 QR code centre (FR-08 to FR-12) ---------- */
export function QrPage() {
  const toast = useToast();
  const { data, loading, error, reload } = useAsync(() => api.get('/qr'), []);
  const [template, setTemplate] = useState('classic');
  const [size, setSize] = useState('medium');
  const [indicator, setIndicator] = useState('both');
  const [confirm, setConfirm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);
  const preview = useRef(null);

  const url = data?.qr?.url;
  useEffect(() => {
    if (url && preview.current) renderSticker(preview.current, { url, template, indicator, width: 520 }).catch(() => {});
  }, [url, template, indicator]);

  if (loading && !data) return <PageLoading />;
  if (error && !data) return <ErrorState error={error} onRetry={reload} />;

  const act = async (path, message) => {
    setBusy(true); setActionError(null);
    try {
      await api.post(path);
      await reload();
      window.dispatchEvent(new Event('nijaat:qr'));
      toast(message);
    } catch (err) { setActionError(err); } finally { setBusy(false); setConfirm(null); }
  };

  const download = async (format) => {
    const canvas = document.createElement('canvas');
    await renderSticker(canvas, { url, template, indicator, width: SIZES[size].px });
    const name = `nijaat-emergency-qr-${size}`;
    if (format === 'PDF') {
      const { jsPDF } = await import('jspdf');
      const mm = SIZES[size].mm; const h = (mm * canvas.height) / canvas.width;
      const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
      pdf.addImage(canvas.toDataURL('image/png'), 'PNG', (210 - mm) / 2, 30, mm, h);
      pdf.setFontSize(10);
      pdf.text(`Print at 100% scale. Sticker width: ${mm} mm. Fix it where a rescuer will see it: helmet, vehicle or phone.`, 105, 30 + h + 12, { align: 'center' });
      pdf.save(`${name}.pdf`);
    } else {
      const a = document.createElement('a');
      a.href = canvas.toDataURL(format === 'PNG' ? 'image/png' : 'image/jpeg', 0.95);
      a.download = `${name}.${format === 'PNG' ? 'png' : 'jpg'}`;
      a.click();
    }
    api.post('/qr/download-log', { format }).then(reload).catch(() => {});
    toast(`${format} downloaded`);
  };

  const status = data.status;
  return (
    <div className="stack-lg">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div><h1>My QR Code</h1><p className="muted">Print it and fix it to your helmet, vehicle or phone. It always shows your latest emergency data.</p></div>
        <QrStatusChip status={status} />
      </div>
      {actionError && <Banner kind="critical">{actionError.message}</Banner>}

      {status !== 'active' && (
        <section className="glass panel stack">
          {status === 'deactivated' && <Banner kind="critical" title="Your previous code is switched off">Anyone who scans the old sticker sees that it was deactivated, not your medical data.</Banner>}
          {data.missing.length > 0 ? (
            <>
              <h3>Complete your profile first</h3>
              <p>These are needed before a QR code can be generated:</p>
              <ul>{data.missing.map((m) => <li key={m}>{m}</li>)}</ul>
              <div><Link className="btn btn-primary" to="/app/profile">Complete medical profile</Link></div>
            </>
          ) : (
            <>
              <h3>{status === 'deactivated' ? 'Generate a new code' : 'Your profile is ready'}</h3>
              <p>Generate your personal emergency QR code. It stays valid until you deactivate or replace it.</p>
              <div><button className="btn btn-primary" disabled={busy} onClick={() => act(status === 'deactivated' ? '/qr/regenerate' : '/qr/generate', 'QR code generated')}><QrIcon size={20} aria-hidden="true" />Generate QR code</button></div>
            </>
          )}
        </section>
      )}

      {status === 'active' && (
        <div className="grid-12">
          <section className="glass panel stack col-4" aria-label="Preview">
            <h3>Preview</h3>
            <div className="qr-preview"><canvas ref={preview} aria-label="Preview of your emergency QR sticker" role="img" /></div>
            <p className="caption">Created {fmtDateTime(data.qr.createdAt)} · scanned {data.totalScans} time{data.totalScans === 1 ? '' : 's'} · downloaded {data.qr.downloadCount} time{data.qr.downloadCount === 1 ? '' : 's'}</p>
          </section>

          <section className="glass panel stack col-8">
            <h3>Customise and download</h3>
            <Choice label="Design template" value={template} onChange={setTemplate} options={TEMPLATES} />
            <Choice label="Emergency indicator" value={indicator} onChange={setIndicator} options={INDICATORS} />
            <Choice label="Print size" value={size} onChange={setSize} options={Object.entries(SIZES).map(([k, v]) => [k, v.label])} />
            <div className="stack-sm">
              <span className="label">Download in high resolution</span>
              <div className="row">
                {['PNG', 'JPEG', 'PDF'].map((f) => <button key={f} className="btn btn-primary" onClick={() => download(f)}><Download size={20} aria-hidden="true" />{f}</button>)}
              </div>
              <span className="hint">PDF places the sticker on an A4 page at the exact print size.</span>
            </div>
            <hr style={{ border: 0, borderTop: '1px solid var(--platinum-300)', width: '100%' }} />
            <div className="stack-sm">
              <span className="label">Lost the sticker, or think someone copied it?</span>
              <div className="row">
                <button className="btn btn-secondary" onClick={() => setConfirm('regenerate')}><RefreshCw size={20} aria-hidden="true" />Replace with a new code</button>
                <button className="btn btn-secondary" onClick={() => setConfirm('deactivate')}><Power size={20} aria-hidden="true" />Deactivate</button>
              </div>
            </div>
          </section>
        </div>
      )}

      {confirm === 'regenerate' && <Confirm title="Replace your QR code?" confirmLabel="Replace code" busy={busy} onCancel={() => setConfirm(null)} onConfirm={() => act('/qr/regenerate', 'New QR code generated')}
        body="The current code stops working at once. Every printed sticker must be replaced with the new one." />}
      {confirm === 'deactivate' && <Confirm title="Deactivate your QR code?" danger confirmLabel="Deactivate" busy={busy} onCancel={() => setConfirm(null)} onConfirm={() => act('/qr/deactivate', 'QR code deactivated')}
        body="Scanning your sticker will no longer show your medical data or alert your family until you generate a new code." />}
    </div>
  );
}

function Choice({ label, value, onChange, options }) {
  return (
    <div className="stack-sm" role="radiogroup" aria-label={label}>
      <span className="label">{label}</span>
      <div className="chips">
        {options.map(([key, text]) => <button key={key} type="button" role="radio" aria-checked={value === key} className="chip-option" onClick={() => onChange(key)}>{text}</button>)}
      </div>
    </div>
  );
}

const ALERT = { pending: ['caution', 'Waiting'], cancelled: ['neutral', 'Cancelled by scanner'], dispatching: ['caution', 'Sending'], dispatched: ['safe', 'Family alerted'] };
const SMS = { queued: ['caution', 'Queued'], sent: ['safe', 'Sent'], delivered: ['safe', 'Delivered'], failed: ['caution', 'Failed, retried'], unreachable: ['critical', 'Not reached'] };
const LOG = { generated: 'Code generated', regenerated: 'New code generated', deactivated: 'Code deactivated', downloaded: 'Downloaded', data_refreshed: 'Emergency data refreshed' };

/* ---------- U-07 Scan and QR activity (FR-12, FR-13) ---------- */
export function ActivityPage() {
  const { data, loading, error, reload } = useAsync(() => api.get('/qr/activity'), []);
  if (loading && !data) return <PageLoading />;
  if (error && !data) return <ErrorState error={error} onRetry={reload} />;
  return (
    <div className="stack-lg">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div><h1>Activity</h1><p className="muted">Every scan of your code and every change to it.</p></div>
        <div className="glass tile"><span className="small muted">Total scans</span><span className="value">{data.totalScans}</span></div>
      </div>

      <section className="glass panel stack">
        <h3>Recent scans</h3>
        {data.scans.length === 0 && <div className="empty">Your code has not been scanned yet.</div>}
        <ul className="list">
          {data.scans.map((s) => {
            const [kind, word] = ALERT[s.alertStatus];
            return (
              <li key={s.id} className="stack-sm">
                <div className="row-between">
                  <strong>{fmtDateTime(s.scannedAt)}</strong>
                  <span className={`tag tag-${kind}`}>{word}</span>
                </div>
                <div className="small">
                  {s.latitude != null
                    ? <a href={`https://www.google.com/maps/search/?api=1&query=${s.latitude},${s.longitude}`} target="_blank" rel="noreferrer"><MapPin size={14} aria-hidden="true" style={{ verticalAlign: -2 }} /> Approximate location: {s.latitude.toFixed(3)}, {s.longitude.toFixed(3)}</a>
                    : <span className="muted">Location was not shared</span>}
                </div>
                {s.sms.length > 0 && (
                  <details>
                    <summary className="small" style={{ cursor: 'pointer', minHeight: 32 }}>SMS delivery log ({s.sms.length} attempt{s.sms.length === 1 ? '' : 's'})</summary>
                    <table className="table">
                      <thead><tr><th>Contact</th><th>Number</th><th>Attempt</th><th>Status</th><th>Error</th><th>Time</th></tr></thead>
                      <tbody>
                        {s.sms.map((m, i) => (
                          <tr key={i}>
                            <td>{m.contactName}</td><td data-label="Number">{m.recipientNumber}</td><td data-label="Attempt">{m.attempt}</td>
                            <td data-label="Status"><span className={`tag tag-${SMS[m.status][0]}`}>{SMS[m.status][1]}</span></td>
                            <td data-label="Error">{m.errorCode || '–'}</td><td data-label="Time">{fmtDateTime(m.at)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </details>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="glass panel stack">
        <h3>QR code log</h3>
        {data.log.length === 0 && <div className="empty">No QR code has been generated yet.</div>}
        <ul className="list">
          {data.log.map((l, i) => (
            <li key={i} className="row-between" style={{ alignItems: 'flex-start' }}>
              <span><strong>{LOG[l.action] || l.action}</strong>{l.detail && <span className="small muted"> · {l.detail}</span>}</span>
              <span className="small muted nowrap">{fmtDateTime(l.at)}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
