import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Camera, UploadCloud, Pill, ArrowLeft, Trash2, Plus, CheckCircle2, AlertTriangle, CalendarClock, RefreshCw, CameraOff, Wand2,
} from 'lucide-react';
import { api, fmtDate, fmtDateTime } from '../api.js';
import { Banner, Confirm, ErrorState, PageLoading, Spinner, TextField, useAsync, useToast } from '../ui.jsx';

const ACCEPT = ['image/jpeg', 'image/png', 'image/webp'];

/** Live camera with a framing guide (FR-37). Falls back to file upload when no camera is available. */
function CameraCapture({ onCapture, onCancel }) {
  const video = useRef(null);
  const stream = useRef(null);
  const [state, setState] = useState('starting');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 2560 }, height: { ideal: 1440 } } });
        if (cancelled) { s.getTracks().forEach((t) => t.stop()); return; }
        stream.current = s;
        if (video.current) { video.current.srcObject = s; await video.current.play().catch(() => {}); }
        setState('ready');
      } catch (err) {
        if (!cancelled) setState(/NotAllowed|Permission/i.test(String(err?.name || err)) ? 'denied' : 'unsupported');
      }
    })();
    return () => { cancelled = true; stream.current?.getTracks().forEach((t) => t.stop()); };
  }, []);

  const shoot = () => {
    const v = video.current;
    const canvas = document.createElement('canvas');
    canvas.width = v.videoWidth; canvas.height = v.videoHeight;
    canvas.getContext('2d').drawImage(v, 0, 0);
    canvas.toBlob((blob) => {
      if (blob) onCapture(new File([blob], `prescription-${Date.now()}.jpg`, { type: 'image/jpeg' }));
    }, 'image/jpeg', 0.92);
  };

  if (state === 'denied' || state === 'unsupported') {
    return (
      <Banner kind="caution" title={state === 'denied' ? 'Camera access was blocked' : 'No camera is available here'} action={<div><button className="btn btn-secondary btn-sm" onClick={onCancel}>Upload a photo instead</button></div>}>
        {state === 'denied' ? 'Allow camera access for this site in your browser settings, or upload a photo you have already taken.' : 'Upload a photo of the prescription instead.'}
      </Banner>
    );
  }
  return (
    <div className="stack">
      <div className="camera">
        <video ref={video} playsInline muted aria-label="Camera view of the prescription" />
        <div className="frame" />
        <div className="frame-hint">Fit the whole prescription inside the frame</div>
      </div>
      {state === 'starting' && <Spinner label="Starting the camera" />}
      <div className="row">
        <button className="btn btn-primary grow" onClick={shoot} disabled={state !== 'ready'}><Camera size={20} aria-hidden="true" />Capture</button>
        <button className="btn btn-secondary" onClick={onCancel}>Cancel</button>
      </div>
      <p className="hint">Good light, no shadow on the page, and hold the phone steady. Blurred photos are rejected.</p>
    </div>
  );
}

/* ---------- U-11 capture and U-13 history (FR-37, FR-38, FR-42) ---------- */
export function PrescriptionsPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { data, loading, error, reload } = useAsync(() => api.get('/prescriptions'), []);
  const [mode, setMode] = useState(null); // null | camera
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);
  const input = useRef(null);

  const send = async (file) => {
    if (!file) return;
    setProblem(null);
    if (!ACCEPT.includes(file.type)) { setProblem({ title: 'This file type is not supported', text: 'Use a JPEG, PNG or WebP photo.' }); return; }
    setBusy(true); setMode(null);
    try {
      const r = await api.upload('/prescriptions', file);
      toast(`${r.prescription.medications.length} medication${r.prescription.medications.length === 1 ? '' : 's'} read. Check them before saving.`);
      navigate(`/app/prescriptions/${r.prescription.id}`);
    } catch (err) {
      // UC-6 E1 and E2
      if (err.code === 'IMAGE_BLURRED') setProblem({ title: 'The image is too blurred to read', text: err.message });
      else if (err.code === 'NO_MEDICATION') setProblem({ title: 'No medication could be read', text: err.message });
      else if (err.code === 'OCR_UNAVAILABLE') setProblem({ title: 'The prescription reader is unavailable', text: err.message });
      else setProblem({ title: 'The photo could not be processed', text: err.message });
    } finally { setBusy(false); if (input.current) input.current.value = ''; }
  };

  const upcoming = (data?.prescriptions || []).filter((p) => p.refillDate).sort((a, b) => new Date(a.refillDate) - new Date(b.refillDate));

  return (
    <div className="stack-lg">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div><h1>Prescriptions</h1><p className="muted">Photograph a prescription to turn it into a medication list. Nothing is added to your profile until you confirm it.</p></div>
      </div>

      {problem && <Banner kind="critical" title={problem.title} action={<div><button className="btn btn-secondary btn-sm" onClick={() => { setProblem(null); setMode('camera'); }}><RefreshCw size={18} aria-hidden="true" />Take another photo</button></div>}>{problem.text}</Banner>}

      {busy ? (
        <div className="glass panel"><Spinner label="Reading the prescription. This can take up to a minute." /></div>
      ) : mode === 'camera' ? (
        <div className="glass panel"><CameraCapture onCapture={send} onCancel={() => { setMode(null); input.current?.click(); }} /></div>
      ) : (
        <div className="glass panel stack">
          <h3>Add a prescription</h3>
          <div className="row">
            <button className="btn btn-primary" onClick={() => setMode('camera')}><Camera size={20} aria-hidden="true" />Use the camera</button>
            <button className="btn btn-secondary" onClick={() => input.current?.click()}><UploadCloud size={20} aria-hidden="true" />Upload a photo</button>
          </div>
          <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className="sr-only" tabIndex={-1} onChange={(e) => send(e.target.files[0])} aria-label="Choose a prescription photo" />
          <p className="hint">JPEG, PNG or WebP, up to 10 MB. The handwriting is read automatically and you confirm every medication.</p>
        </div>
      )}

      {upcoming.length > 0 && (
        <section className="glass panel stack">
          <h3>Refill reminders</h3>
          <ul className="list">
            {upcoming.map((p) => {
              const days = Math.ceil((new Date(p.refillDate) - Date.now()) / 86400000);
              const kind = days < 0 ? 'critical' : days <= 7 ? 'caution' : 'neutral';
              return (
                <li key={p.id} className="row-between">
                  <span><CalendarClock size={18} aria-hidden="true" style={{ verticalAlign: -3, color: 'var(--mocha-600)' }} /> {p.medications.map((m) => m.name).join(', ')}</span>
                  <span className={`tag tag-${kind}`}>{days < 0 ? `Overdue since ${fmtDate(p.refillDate)}` : days === 0 ? 'Refill today' : `Refill in ${days} day${days === 1 ? '' : 's'}`}</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="glass panel stack">
        <h3>Saved prescriptions</h3>
        {loading && !data && <PageLoading />}
        {error && !data && <ErrorState error={error} onRetry={reload} />}
        {data && data.prescriptions.length === 0 && <div className="empty">No prescriptions yet.</div>}
        {data && data.prescriptions.length > 0 && (
          <ul className="list">
            {data.prescriptions.map((p) => (
              <li key={p.id}>
                <Link to={`/app/prescriptions/${p.id}`} className="row-between" style={{ textDecoration: 'none', color: 'inherit', minHeight: 48 }}>
                  <span className="row grow" style={{ flexWrap: 'nowrap' }}>
                    <Pill size={22} color="var(--mocha-600)" aria-hidden="true" style={{ flex: 'none' }} />
                    <span style={{ minWidth: 0 }}>
                      <strong style={{ display: 'block' }}>{p.medications.map((m) => m.name).join(', ') || 'No medication'}</strong>
                      <span className="small muted">{fmtDateTime(p.uploadedAt)}</span>
                    </span>
                  </span>
                  <span className={`tag ${p.verified ? 'tag-safe' : 'tag-caution'}`}>{p.verified ? 'Confirmed' : 'Needs checking'}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/* ---------- U-12 Medication verification (FR-39 to FR-42) ---------- */
export function VerifyPrescription() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { data, loading, error, reload } = useAsync(() => api.get(`/prescriptions/${id}`), [id]);
  const [meds, setMeds] = useState(null);
  const [refill, setRefill] = useState('');
  const [image, setImage] = useState(null);
  const [fields, setFields] = useState({});
  const [saveError, setSaveError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!data) return undefined;
    setMeds(data.prescription.medications.map((m) => ({ ...m })));
    setRefill(data.prescription.refillDate ? data.prescription.refillDate.slice(0, 10) : '');
    let url;
    api.blobUrl(`/prescriptions/${id}/image`).then((u) => { url = u; setImage(u); }).catch(() => {});
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [data, id]);

  if (loading && !data) return <PageLoading />;
  if (error && !data) return <ErrorState error={error} onRetry={reload} />;
  if (!meds) return <PageLoading />;

  const p = data.prescription;
  const update = (i, key, value) => setMeds(meds.map((m, n) => (n === i ? { ...m, [key]: value } : m)));
  const save = async () => {
    setBusy(true); setFields({}); setSaveError(null);
    try {
      await api.put(`/prescriptions/${id}/verify`, {
        medications: meds.map(({ name, dosage, frequency, duration }) => ({ name, dosage, frequency, duration })),
        refillDate: refill || null,
      });
      toast('Saved. These medications are now part of your medical profile.');
      navigate('/app/prescriptions');
    } catch (err) { setFields(err.fields || {}); setSaveError(err); } finally { setBusy(false); }
  };
  const remove = async () => { setBusy(true); try { await api.del(`/prescriptions/${id}`); toast('Prescription deleted'); navigate('/app/prescriptions'); } finally { setBusy(false); } };
  const corrected = meds.filter((m) => m.autocorrected).length;

  return (
    <div className="stack-lg">
      <div><Link className="btn btn-quiet btn-sm" to="/app/prescriptions"><ArrowLeft size={18} aria-hidden="true" />All prescriptions</Link></div>
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div><h1>{p.verified ? 'Edit prescription' : 'Check the medications'}</h1><p className="muted">Read from the photo on {fmtDateTime(p.uploadedAt)}. Compare each line with the image and correct anything wrong.</p></div>
        <button className="icon-btn" onClick={() => setConfirmDelete(true)} aria-label="Delete prescription"><Trash2 size={20} /></button>
      </div>

      {corrected > 0 && (
        <Banner kind="caution" title={`${corrected} name${corrected === 1 ? ' was' : 's were'} corrected automatically`}>
          Where the handwriting was unclear, the closest known medicine name was used. Check these against the image before saving.
        </Banner>
      )}
      {saveError && !Object.keys(fields).length && <Banner kind="critical" title="Not saved">{saveError.message}</Banner>}

      <div className="split">
        <div className="sticky stack">
          <h3>Original photo</h3>
          {image ? <img className="rx-image" src={image} alt="Photograph of the prescription" /> : <div className="skeleton" style={{ height: 320 }} />}
          {p.extractedText && (
            <details>
              <summary className="small" style={{ cursor: 'pointer', minHeight: 32 }}>Show the raw text that was read</summary>
              <pre className="small muted" style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>{p.extractedText}</pre>
            </details>
          )}
        </div>

        <div className="stack">
          {meds.length === 0 && <Banner kind="caution" title="No medications left">Add at least one medication, or delete this prescription.</Banner>}
          {meds.map((m, i) => (
            <section key={i} className="glass panel stack-sm">
              <div className="row-between">
                <span className="label muted">Medication {i + 1}</span>
                <button className="icon-btn" onClick={() => setMeds(meds.filter((_, n) => n !== i))} aria-label={`Remove ${m.name || `medication ${i + 1}`}`}><Trash2 size={20} /></button>
              </div>
              {m.autocorrected && (
                <div className="small" style={{ color: 'var(--caution)' }}>
                  <Wand2 size={16} aria-hidden="true" style={{ verticalAlign: -3 }} /> Read as <strong>{m.originalName}</strong>, corrected to <strong>{m.name}</strong>.{' '}
                  <button className="btn btn-quiet btn-sm" style={{ minHeight: 32 }} onClick={() => update(i, 'name', m.originalName)}>Keep the original reading</button>
                </div>
              )}
              {!m.autocorrected && m.inDictionary === false && m.name && (
                <div className="small muted"><AlertTriangle size={16} aria-hidden="true" style={{ verticalAlign: -3, color: 'var(--caution)' }} /> This name is not in the medicine list. Check the spelling against the photo.</div>
              )}
              <TextField label="Medication name" required value={m.name} onChange={(v) => update(i, 'name', v)} error={fields[`medications.${i}.name`]} />
              <div className="form-grid">
                <TextField label="Dosage" value={m.dosage} onChange={(v) => update(i, 'dosage', v)} placeholder="500 mg" error={fields[`medications.${i}.dosage`]} />
                <TextField label="Frequency" value={m.frequency} onChange={(v) => update(i, 'frequency', v)} placeholder="Twice daily" error={fields[`medications.${i}.frequency`]} />
                <TextField label="Duration" value={m.duration} onChange={(v) => update(i, 'duration', v)} placeholder="7 days" error={fields[`medications.${i}.duration`]} />
              </div>
              {m.sourceLine && <p className="caption">Read from: “{m.sourceLine}”</p>}
            </section>
          ))}

          <div><button className="btn btn-secondary" onClick={() => setMeds([...meds, { name: '', dosage: '', frequency: '', duration: '' }])}><Plus size={20} aria-hidden="true" />Add a medication by hand</button></div>

          <section className="glass panel stack-sm">
            <h3>Refill reminder</h3>
            <TextField label="Remind me to refill on" type="date" value={refill} onChange={setRefill} hint="Optional. The reminder appears on your dashboard." />
          </section>

          <div className="glass panel-sm row-between" style={{ position: 'sticky', bottom: 16, zIndex: 5 }}>
            <span className="small muted">Confirmed medications are added to your medical profile.</span>
            <button className="btn btn-primary" onClick={save} disabled={busy || meds.length === 0}><CheckCircle2 size={20} aria-hidden="true" />{busy ? 'Saving' : p.verified ? 'Save changes' : 'Confirm and save'}</button>
          </div>
        </div>
      </div>

      {confirmDelete && <Confirm title="Delete this prescription?" danger confirmLabel="Delete" busy={busy} onCancel={() => setConfirmDelete(false)} onConfirm={remove}
        body="The photo and its medications are removed permanently. Medications it added to your profile are removed too." />}
    </div>
  );
}
