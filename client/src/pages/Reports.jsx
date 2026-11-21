import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { UploadCloud, FileText, RefreshCw, Trash2, Plus, GitCompare, ArrowLeft, ExternalLink, Info } from 'lucide-react';
import { api, fmtDateTime } from '../api.js';
import { Banner, Confidence, Confirm, ErrorState, PageLoading, Spinner, UrgencyTag, useAsync, useToast } from '../ui.jsx';

export const SECTIONS = [
  ['demographics', 'Demographics'], ['primaryDiagnoses', 'Primary diagnoses'], ['secondaryConditions', 'Secondary conditions'],
  ['medications', 'Medications'], ['allergies', 'Allergies'], ['testResults', 'Test results'],
  ['surgicalHistory', 'Surgical history'], ['recommendations', 'Recommendations'],
];
const ACCEPT = ['application/pdf', 'image/jpeg', 'image/png'];
const STATUS = { uploaded: ['neutral', 'Uploaded'], processing: ['caution', 'Processing'], summarized: ['safe', 'Summarised'], failed: ['critical', 'Failed'] };

function StatusChip({ status }) {
  const [kind, word] = STATUS[status];
  return <span className={`tag tag-${kind}`}>{status === 'processing' && <span className="spinner" style={{ width: 12, height: 12, borderWidth: 2 }} aria-hidden="true" />}{word}</span>;
}

/* ---------- U-08 Reports library with upload (FR-20) ---------- */
export function ReportsPage() {
  const toast = useToast();
  const { data, loading, error, reload } = useAsync(() => api.get('/reports'), []);
  const [over, setOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const input = useRef(null);

  // Poll while anything is being processed.
  const processing = data?.reports.some((r) => r.status === 'processing' || r.status === 'uploaded');
  useEffect(() => {
    if (!processing) return undefined;
    const t = setInterval(reload, 2500);
    return () => clearInterval(t);
  }, [processing, reload]);

  const upload = async (file) => {
    if (!file) return;
    setUploadError(null);
    if (!ACCEPT.includes(file.type)) { setUploadError('This file type is not supported. Accepted formats: PDF, JPEG, PNG.'); return; } // UC-5 E1
    setUploading(true);
    try { await api.upload('/reports', file); toast('Report uploaded. The summary is being prepared.'); await reload(); }
    catch (err) { setUploadError(err.message); } finally { setUploading(false); if (input.current) input.current.value = ''; }
  };

  const summarised = data?.reports.filter((r) => r.status === 'summarized') || [];
  return (
    <div className="stack-lg">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div><h1>Reports</h1><p className="muted">Upload a medical report and get a structured summary to review. You confirm every summary before relying on it.</p></div>
        {summarised.length >= 2 && <Link className="btn btn-secondary" to="/app/reports/compare"><GitCompare size={20} aria-hidden="true" />Compare summaries</Link>}
      </div>

      <div className={`dropzone${over ? ' over' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); upload(e.dataTransfer.files[0]); }}>
        <div className="stack" style={{ alignItems: 'center' }}>
          <UploadCloud size={36} color="var(--mocha-600)" aria-hidden="true" />
          {uploading ? <Spinner label="Uploading" /> : (
            <>
              <strong>Drag a report here</strong>
              <span className="muted">or</span>
              <button className="btn btn-primary" onClick={() => input.current?.click()}>Browse files</button>
              <span className="hint">PDF, JPEG or PNG, up to 10 MB</span>
            </>
          )}
          <input ref={input} type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" className="sr-only" tabIndex={-1} onChange={(e) => upload(e.target.files[0])} aria-label="Choose a report file" />
        </div>
      </div>
      {uploadError && <Banner kind="critical" title="Upload failed">{uploadError}</Banner>}

      <section className="glass panel stack">
        <h3>Your reports</h3>
        {loading && !data && <PageLoading />}
        {error && !data && <ErrorState error={error} onRetry={reload} />}
        {data && data.reports.length === 0 && <div className="empty">No reports yet. Upload your first one above.</div>}
        {data && data.reports.length > 0 && (
          <ul className="list">
            {data.reports.map((r) => (
              <li key={r.id}>
                <Link to={`/app/reports/${r.id}`} className="row-between" style={{ textDecoration: 'none', color: 'inherit', minHeight: 48 }}>
                  <span className="row grow" style={{ flexWrap: 'nowrap' }}>
                    <FileText size={22} color="var(--mocha-600)" aria-hidden="true" style={{ flex: 'none' }} />
                    <span style={{ minWidth: 0 }}><strong style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.fileName}</strong><span className="small muted">{r.fileType} · {fmtDateTime(r.uploadedAt)}</span></span>
                  </span>
                  <span className="row">{r.urgency && <UrgencyTag urgency={r.urgency} />}<StatusChip status={r.status} /></span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function SectionView({ title, items }) {
  return (
    <section className="item-card stack-sm">
      <h3>{title}</h3>
      {items.length === 0 ? <p className="muted small">Nothing found in this report.</p> : (
        <ul className="list">
          {items.map((i, n) => (
            <li key={n} className="stack-sm">
              <div className="row-between" style={{ alignItems: 'flex-start' }}><span className="grow">{i.text}</span><UrgencyTag urgency={i.urgency} /></div>
              <div className="row small"><Confidence value={i.confidence} />{i.note && <span className="muted">Your note: {i.note}</span>}</div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ---------- U-09 Summary review and edit (FR-21 to FR-25) ---------- */
export function ReportDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { data, loading, error, reload } = useAsync(() => api.get(`/reports/${id}`), [id]);
  const [sections, setSections] = useState(null);
  const [editing, setEditing] = useState(false);
  const [fields, setFields] = useState({});
  const [saveError, setSaveError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => { if (data?.summary && !editing) setSections(data.summary.sections); }, [data, editing]);
  const status = data?.report.status;
  useEffect(() => {
    if (status !== 'processing' && status !== 'uploaded') return undefined;
    const t = setInterval(reload, 2500);
    return () => clearInterval(t);
  }, [status, reload]);

  if (loading && !data) return <PageLoading />;
  if (error && !data) return <ErrorState error={error} onRetry={reload} />;
  const { report, summary } = data;

  const update = (key, i, patch) => setSections((s) => ({ ...s, [key]: s[key].map((it, n) => (n === i ? { ...it, ...patch } : it)) }));
  const save = async () => {
    setBusy(true); setFields({}); setSaveError(null);
    try {
      const r = await api.put(`/reports/${id}/summary`, { sections });
      toast(r.changed.length ? 'Summary saved. The change is recorded in your audit log.' : 'No changes to save');
      setEditing(false); await reload();
    } catch (err) { setFields(err.fields || {}); setSaveError(err); } finally { setBusy(false); }
  };
  const openFile = async () => { try { window.open(await api.blobUrl(`/reports/${id}/file`), '_blank', 'noopener'); } catch (err) { toast(err.message, 'critical'); } };
  const retry = async () => { await api.post(`/reports/${id}/retry`).catch(() => {}); reload(); };
  const remove = async () => { setBusy(true); try { await api.del(`/reports/${id}`); toast('Report deleted'); navigate('/app/reports'); } finally { setBusy(false); } };

  return (
    <div className="stack-lg">
      <div><Link className="btn btn-quiet btn-sm" to="/app/reports"><ArrowLeft size={18} aria-hidden="true" />All reports</Link></div>
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div style={{ minWidth: 0 }}>
          <h1 style={{ overflowWrap: 'anywhere' }}>{report.fileName}</h1>
          <p className="muted">{report.fileType} · uploaded {fmtDateTime(report.uploadedAt)}{summary?.edited && ' · edited by you'}</p>
        </div>
        <div className="row">
          <StatusChip status={report.status} />
          <button className="btn btn-secondary btn-sm" onClick={openFile}><ExternalLink size={18} aria-hidden="true" />Original file</button>
          <button className="icon-btn" onClick={() => setConfirmDelete(true)} aria-label="Delete report"><Trash2 size={20} /></button>
        </div>
      </div>

      {(report.status === 'processing' || report.status === 'uploaded') && <div className="glass panel"><Spinner label="Reading the report and preparing the summary. This can take up to a minute." /></div>}
      {report.status === 'failed' && (
        <Banner kind="critical" title="The summary could not be created" action={<div><button className="btn btn-secondary btn-sm" onClick={retry}><RefreshCw size={18} aria-hidden="true" />Try again</button></div>}>
          {report.error} Your file is saved, so you do not need to upload it again.
        </Banner>
      )}

      {report.status === 'summarized' && sections && (
        <>
          <Banner kind="info" title="Check this summary against your report">
            It was generated by AI and may contain mistakes. Items with a low confidence score need the most attention. Correct anything that is wrong.
          </Banner>
          <div className="row-between">
            <div className="row small"><Info size={16} aria-hidden="true" /><span><UrgencyTag urgency="red" /> critical · <UrgencyTag urgency="amber" /> ongoing treatment · <UrgencyTag urgency="green" /> normal</span></div>
            {!editing
              ? <button className="btn btn-primary" onClick={() => setEditing(true)}>Edit summary</button>
              : <div className="row"><button className="btn btn-secondary" onClick={() => { setEditing(false); setSections(summary.sections); setFields({}); }}>Cancel</button><button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving' : 'Save changes'}</button></div>}
          </div>
          {saveError && <Banner kind="critical" title="Not saved">{saveError.message}</Banner>}

          <div className="grid-12">
            {SECTIONS.map(([key, title]) => (
              <div key={key} className="col-6">
                {!editing ? <SectionView title={title} items={sections[key]} /> : (
                  <section className="item-card stack">
                    <h3>{title}</h3>
                    {sections[key].map((item, i) => (
                      <div key={i} className="stack-sm" style={{ borderBottom: '1px solid var(--platinum-300)', paddingBottom: 12 }}>
                        <div className="field">
                          <label htmlFor={`${key}-${i}-t`}>Finding {i + 1}</label>
                          <textarea id={`${key}-${i}-t`} className="textarea" style={{ minHeight: 64 }} value={item.text} onChange={(e) => update(key, i, { text: e.target.value })} aria-invalid={fields[`sections.${key}.${i}.text`] ? 'true' : undefined} />
                          {fields[`sections.${key}.${i}.text`] && <span className="error-text">{fields[`sections.${key}.${i}.text`]}</span>}
                        </div>
                        <div className="form-grid">
                          <div className="field">
                            <label htmlFor={`${key}-${i}-u`}>Urgency</label>
                            <select id={`${key}-${i}-u`} className="select" value={item.urgency} onChange={(e) => update(key, i, { urgency: e.target.value })}>
                              <option value="red">Critical</option><option value="amber">Ongoing</option><option value="green">Normal</option>
                            </select>
                          </div>
                          <div className="field">
                            <label htmlFor={`${key}-${i}-n`}>Your note</label>
                            <input id={`${key}-${i}-n`} className="input" value={item.note || ''} onChange={(e) => update(key, i, { note: e.target.value })} />
                          </div>
                        </div>
                        <div className="row-between small"><Confidence value={item.confidence} />
                          <button className="btn btn-quiet btn-sm" onClick={() => setSections((s) => ({ ...s, [key]: s[key].filter((_, n) => n !== i) }))}><Trash2 size={16} aria-hidden="true" />Remove</button>
                        </div>
                      </div>
                    ))}
                    <div><button className="btn btn-secondary btn-sm" onClick={() => setSections((s) => ({ ...s, [key]: [...s[key], { text: '', urgency: 'green', confidence: 1, note: 'Added by me' }] }))}><Plus size={18} aria-hidden="true" />Add finding</button></div>
                  </section>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {confirmDelete && <Confirm title="Delete this report?" danger confirmLabel="Delete report" busy={busy} onCancel={() => setConfirmDelete(false)} onConfirm={remove}
        body="The file and its summary are removed permanently. Physicians will no longer see this summary." />}
    </div>
  );
}

/* ---------- U-10 Compare two summaries (UC-5 alt 6.1) ---------- */
export function ComparePage() {
  const [params, setParams] = useSearchParams();
  const list = useAsync(() => api.get('/reports'), []);
  const a = params.get('a') || ''; const b = params.get('b') || '';
  const left = useAsync(() => (a ? api.get(`/reports/${a}`) : Promise.resolve(null)), [a]);
  const right = useAsync(() => (b ? api.get(`/reports/${b}`) : Promise.resolve(null)), [b]);
  const options = (list.data?.reports || []).filter((r) => r.status === 'summarized');

  useEffect(() => {
    if (options.length >= 2 && !a && !b) setParams({ a: options[1].id, b: options[0].id }, { replace: true });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.length]);

  const picker = (which, value) => (
    <div className="field">
      <label htmlFor={`pick-${which}`}>{which === 'a' ? 'Earlier report' : 'Later report'}</label>
      <select id={`pick-${which}`} className="select" value={value} onChange={(e) => setParams({ a, b, [which]: e.target.value }, { replace: true })}>
        <option value="">Choose a report</option>
        {options.map((r) => <option key={r.id} value={r.id}>{r.fileName} ({fmtDateTime(r.uploadedAt)})</option>)}
      </select>
    </div>
  );

  return (
    <div className="stack-lg">
      <div><Link className="btn btn-quiet btn-sm" to="/app/reports"><ArrowLeft size={18} aria-hidden="true" />All reports</Link></div>
      <div><h1>Compare summaries</h1><p className="muted">See two report summaries side by side, section by section.</p></div>
      {list.data && options.length < 2 && <Banner kind="info">You need at least two summarised reports to compare.</Banner>}
      <div className="grid-12">
        <div className="col-6">{picker('a', a)}</div>
        <div className="col-6">{picker('b', b)}</div>
      </div>
      {SECTIONS.map(([key, title]) => (
        <div key={key} className="grid-12">
          <div className="col-6">{left.data?.summary ? <SectionView title={title} items={left.data.summary.sections[key]} /> : <div className="item-card muted">{a ? 'Loading' : 'No report selected'}</div>}</div>
          <div className="col-6">{right.data?.summary ? <SectionView title={title} items={right.data.summary.sections[key]} /> : <div className="item-card muted">{b ? 'Loading' : 'No report selected'}</div>}</div>
        </div>
      ))}
    </div>
  );
}
