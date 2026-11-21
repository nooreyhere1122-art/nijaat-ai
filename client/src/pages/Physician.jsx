import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertTriangle, Phone, Printer, ShieldCheck, Stethoscope, Timer, ZoomIn, ZoomOut, ListTree, ArrowLeft, LogOut, AlertCircle, Info } from 'lucide-react';
import { api, tokens, fmtDate, fmtDateTime } from '../api.js';
import { Banner, Modal, Spinner, TextField, UrgencyTag, PageLoading } from '../ui.jsx';

/* ---------- C-01 Physician access (FR-43) ---------- */
export function PhysicianAccess() {
  const navigate = useNavigate();
  const scan = tokens.scan;
  const [step, setStep] = useState('identify');
  const [form, setForm] = useState({ name: '', hospital: '', registrationNo: '' });
  const [fields, setFields] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState(null);
  const [code, setCode] = useState('');

  useEffect(() => { document.title = 'Physician access · NIJAAT AI'; }, []);

  if (!scan?.session) {
    return (
      <div className="clinical"><div className="auth-wrap"><div className="solid auth-card stack">
        <h1>Scan the patient’s QR code first</h1>
        <p>Physician access starts from the emergency profile that opens after scanning the patient’s code.</p>
        <Link className="btn btn-primary" to="/scan">Scan a QR code</Link>
      </div></div></div>
    );
  }

  const request = async (e) => {
    e?.preventDefault();
    setBusy(true); setError(null); setFields({});
    try {
      const r = await api.post('/public/physician/request', form, { token: scan.session });
      setInfo(r); setStep('code'); setCode('');
    } catch (err) { setFields(err.fields); setError(err); } finally { setBusy(false); }
  };

  const verify = async (e) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const r = await api.post('/public/physician/verify', { code }, { token: scan.session });
      tokens.physician = r.physicianSession;
      navigate('/physician/record', { replace: true });
    } catch (err) { setError(err); } finally { setBusy(false); }
  };

  return (
    <div className="clinical">
      <div className="auth-wrap">
        <main id="main" className="solid auth-card stack-lg">
          <div className="stack-sm">
            <span className="row muted"><Stethoscope size={20} aria-hidden="true" />Physician access</span>
            <h1>{step === 'identify' ? 'Request the full medical record' : 'Enter the access code'}</h1>
          </div>

          {step === 'identify' && (
            <form className="stack" onSubmit={request} noValidate>
              <p>A one-time code will be sent by SMS to the patient’s emergency contacts, with your name and hospital. Ask a contact to read the code to you.</p>
              {error && !Object.keys(fields).length && <Banner kind="critical">{error.message}</Banner>}
              <TextField label="Your full name" required value={form.name} onChange={(v) => setForm({ ...form, name: v })} error={fields.name} autoComplete="name" />
              <TextField label="Hospital" required value={form.hospital} onChange={(v) => setForm({ ...form, hospital: v })} error={fields.hospital} autoComplete="organization" />
              <TextField label="Medical registration number" required value={form.registrationNo} onChange={(v) => setForm({ ...form, registrationNo: v })} error={fields.registrationNo} hint="Your PMDC registration number. It is recorded in the patient’s access log." />
              <button className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Sending the code' : 'Send code to emergency contacts'}</button>
              <Link className="btn btn-quiet" to={`/e/${scan.token}`}><ArrowLeft size={18} aria-hidden="true" />Back to emergency profile</Link>
            </form>
          )}

          {step === 'code' && info && (
            <form className="stack" onSubmit={verify} noValidate>
              <Banner kind="safe" title={info.message}>The code expires in {info.expiresInMinutes} minutes and works once.</Banner>
              {info.devCode && <Banner kind="caution" title="Development mode">No SMS gateway is configured, so the code is shown here: <strong>{info.devCode}</strong></Banner>}
              <div className="stack-sm">
                {info.contacts.map((c) => (
                  <a key={c.phone} className="btn btn-secondary btn-block" href={`tel:${c.phone}`}><Phone size={18} aria-hidden="true" />Call {c.name} ({c.relationship})</a>
                ))}
              </div>
              <div className="field">
                <label htmlFor="otc">6-digit code</label>
                <input id="otc" className="input code-input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} aria-invalid={error ? 'true' : undefined} aria-describedby={error ? 'otc-err' : undefined} />
                {error && <span id="otc-err" className="error-text" role="alert"><AlertCircle size={16} aria-hidden="true" />{error.message}</span>}
              </div>
              <button className="btn btn-primary btn-block" disabled={busy || code.length !== 6}>{busy ? 'Checking' : 'Open medical record'}</button>
              <button type="button" className="btn btn-quiet" onClick={() => request()} disabled={busy}>Send a new code</button>
            </form>
          )}
        </main>
      </div>
    </div>
  );
}

/* ---------- Timeline (FR-46): zoomable, with a list alternative ---------- */
function toYear(date) {
  const [y, m = '7', d = '1'] = String(date).split('-');
  return Number(y) + (Number(m) - 1) / 12 + (Number(d) - 1) / 365;
}

function Timeline({ events }) {
  const [pxPerYear, setPx] = useState(120);
  const [asList, setAsList] = useState(false);
  if (!events.length) return <div className="empty">No dated diagnoses, surgeries or medication changes are recorded.</div>;
  const years = events.map((e) => toYear(e.date));
  const first = Math.floor(Math.min(...years)); const last = Math.ceil(Math.max(...years) + 0.01);
  const width = Math.max(600, (last - first) * pxPerYear + 200);
  const x = (yr) => 100 + (yr - first) * pxPerYear;
  const step = pxPerYear >= 60 ? 1 : pxPerYear >= 25 ? 2 : 5;
  const ticks = [];
  for (let y = first; y <= last; y += step) ticks.push(y);
  const typeWord = { diagnosis: 'Diagnosis', surgery: 'Surgery', medication: 'Medication' };
  return (
    <div className="stack">
      <div className="row-between no-print">
        <div className="legend">
          <span><i style={{ width: 12, height: 12, borderRadius: '50%', background: 'var(--cocoa-900)', display: 'inline-block' }} />Diagnosis</span>
          <span><i style={{ width: 12, height: 12, borderRadius: 3, background: 'var(--mocha-600)', display: 'inline-block' }} />Surgery</span>
          <span><i style={{ width: 11, height: 11, background: 'var(--lavender-deep)', transform: 'rotate(45deg)', display: 'inline-block' }} />Medication</span>
        </div>
        <div className="row">
          <button className="btn btn-secondary btn-sm" onClick={() => setPx((p) => Math.max(15, Math.round(p / 1.6)))} disabled={asList}><ZoomOut size={18} aria-hidden="true" />Zoom out</button>
          <button className="btn btn-secondary btn-sm" onClick={() => setPx((p) => Math.min(900, Math.round(p * 1.6)))} disabled={asList}><ZoomIn size={18} aria-hidden="true" />Zoom in</button>
          <button className="btn btn-secondary btn-sm" onClick={() => setAsList((v) => !v)} aria-pressed={asList}><ListTree size={18} aria-hidden="true" />{asList ? 'Show timeline' : 'Show as list'}</button>
        </div>
      </div>
      {asList ? (
        <ul className="list">
          {[...events].reverse().map((e, i) => (
            <li key={i}><strong>{e.date}</strong> · {typeWord[e.type]} · {e.title}{e.detail && <div className="small muted">{e.detail}</div>}</li>
          ))}
        </ul>
      ) : (
        <div className="timeline-scroll" tabIndex={0} role="img" aria-label={`Medical timeline with ${events.length} events from ${first} to ${last}. Use Show as list for a text version.`}>
          <div className="timeline" style={{ width }}>
            <div className="axis" />
            {ticks.map((y) => <div key={y} className="tick" style={{ left: x(y) }}>{y}</div>)}
            {events.map((e, i) => (
              <div key={i} className={`event ${e.type} ${i % 2 ? 'down' : 'up'}`} style={{ left: x(toYear(e.date)) }} title={`${e.date}: ${e.title}${e.detail ? ` (${e.detail})` : ''}`}>
                {i % 2 === 0 && <><strong>{e.title}</strong><div className="caption">{e.date}</div></>}
                <div className="dot" />
                {i % 2 === 1 && <><strong>{e.title}</strong><div className="caption">{e.date}</div></>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const SEVERITY = { severe: 'Severe', moderate: 'Moderate', mild: 'Mild' };

function AllergyPanel({ allergies }) {
  if (!allergies.length) return <Banner kind="safe" title="No allergies recorded">The patient has not listed any allergy.</Banner>;
  return (
    <div className="stack-sm">
      {allergies.map((a) => (
        <div key={a.name} className={`allergy-card ${a.severity}`}>
          <AlertTriangle size={a.severity === 'severe' ? 36 : 28} aria-hidden="true" />
          <div>
            <strong style={{ fontSize: 18 }}>{a.name}</strong>
            <div className="label">{SEVERITY[a.severity]} allergy</div>
            {a.reaction && <div>Reaction: {a.reaction}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

function Soap({ letter, title, children }) {
  return (
    <section className="solid panel stack">
      <div className="row"><span className="soap-letter" aria-hidden="true">{letter}</span><h3>{title}</h3></div>
      {children}
    </section>
  );
}

const itemsOf = (summaries, key) => summaries.flatMap((s) => (s.sections[key] || []).map((i) => ({ ...i, report: s.reportName, date: s.date })));
const order = { red: 0, amber: 1, green: 2 };
const byUrgency = (a, b) => order[a.urgency] - order[b.urgency];

function ItemList({ items, empty }) {
  if (!items.length) return <p className="muted">{empty}</p>;
  return (
    <ul className="list">
      {items.sort(byUrgency).map((i, n) => (
        <li key={n} className="row-between" style={{ alignItems: 'flex-start' }}>
          <span className="grow">{i.text}{i.note && <span className="small muted"> · Patient note: {i.note}</span>}<span className="caption" style={{ display: 'block' }}>{i.report}, {fmtDate(i.date)}</span></span>
          <UrgencyTag urgency={i.urgency} />
        </li>
      ))}
    </ul>
  );
}

/* ---------- C-02 dashboard, C-03 print summary, C-04 session expiry ---------- */
export function PhysicianRecord() {
  const navigate = useNavigate();
  const [record, setRecord] = useState(null);
  const [expired, setExpired] = useState(!tokens.physician);
  const [tab, setTab] = useState('summary');
  const [left, setLeft] = useState(null);
  const lastActivity = useRef(Date.now());
  const lastPing = useRef(Date.now());
  const limitMs = useRef(5 * 60_000);

  const end = useCallback(() => { tokens.physician = null; setExpired(true); }, []);

  useEffect(() => {
    document.title = 'Physician dashboard · NIJAAT AI';
    if (!tokens.physician) return;
    api.get('/public/physician/record', { token: tokens.physician }).then((r) => {
      limitMs.current = r.inactivityMinutes * 60_000;
      lastActivity.current = Date.now(); lastPing.current = Date.now();
      setLeft(r.inactivityMinutes * 60);
      setRecord(r);
    }).catch(end);
  }, [end]);

  // FR-48: inactivity timeout. Activity is reported to the server at most every 20 seconds.
  useEffect(() => {
    if (!record || expired) return undefined;
    const onActivity = () => {
      lastActivity.current = Date.now();
      if (Date.now() - lastPing.current > 20_000) {
        lastPing.current = Date.now();
        api.post('/public/physician/ping', {}, { token: tokens.physician }).catch(end);
      }
    };
    const events = ['pointerdown', 'keydown', 'scroll'];
    events.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));
    const t = setInterval(() => {
      const remaining = limitMs.current - (Date.now() - lastActivity.current);
      setLeft(Math.max(0, Math.ceil(remaining / 1000)));
      if (remaining <= 0) end();
    }, 1000);
    return () => { events.forEach((e) => window.removeEventListener(e, onActivity)); clearInterval(t); };
  }, [record, expired, end]);

  const stay = () => {
    lastActivity.current = Date.now(); lastPing.current = Date.now();
    api.post('/public/physician/ping', {}, { token: tokens.physician }).catch(end);
  };
  const finish = async () => {
    await api.post('/public/physician/end', {}, { token: tokens.physician }).catch(() => {});
    tokens.physician = null;
    navigate(tokens.scan?.token ? `/e/${tokens.scan.token}` : '/', { replace: true });
  };

  if (expired) {
    return (
      <div className="clinical"><div className="auth-wrap"><main id="main" className="solid auth-card stack">
        <span className="row muted"><Timer size={20} aria-hidden="true" />Session ended</span>
        <h1>The physician session has ended</h1>
        <p>For the patient’s privacy the record closes after a period without activity. Verify access again to reopen it.</p>
        <Link className="btn btn-primary" to="/physician">Verify access again</Link>
      </main></div></div>
    );
  }
  if (!record) return <div className="clinical"><div style={{ padding: 24 }}><PageLoading /></div></div>;

  const { patient, summaries } = record;
  const critical = ['primaryDiagnoses', 'secondaryConditions', 'testResults', 'allergies'].flatMap((k) => itemsOf(summaries, k)).filter((i) => i.urgency === 'red');
  const age = patient.dateOfBirth ? Math.floor((Date.now() - new Date(patient.dateOfBirth).getTime()) / 31557600000) : null;
  const mmss = left == null ? '' : `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
  const tabs = [['summary', 'Summary'], ['allergies', `Allergies (${record.allergies.length})`], ['medications', 'Medications'], ['timeline', 'Timeline']];

  return (
    <div className="clinical">
      <header className="clinical-head no-print">
        <div className="row">
          <span className="blood-badge" aria-label={`Blood group ${patient.bloodGroup || 'unknown'}`}>{patient.bloodGroup || '?'}</span>
          <div>
            <h1 style={{ fontSize: 22, lineHeight: '28px' }}>{patient.name}</h1>
            <div className="small muted">{[age != null && `${age} years`, patient.gender, patient.dateOfBirth && `born ${fmtDate(patient.dateOfBirth)}`].filter(Boolean).join(' · ') || 'Age not recorded'}</div>
          </div>
        </div>
        <div className="row">
          <span className={`tag ${left != null && left <= 60 ? 'tag-caution' : 'tag-neutral'}`} title="Time left before the session closes without activity"><Timer size={14} aria-hidden="true" />Session {mmss}</span>
          <button className="btn btn-secondary btn-sm" onClick={() => window.print()}><Printer size={18} aria-hidden="true" />Print summary</button>
          <button className="btn btn-quiet btn-sm" onClick={finish}><LogOut size={18} aria-hidden="true" />End session</button>
        </div>
      </header>

      <main id="main" className="clinical-body no-print">
        {/* Pinned on tablet and desktop: key findings first, then allergies (FR-44, FR-47) */}
        <div className="stack">
          <section className="solid panel stack" aria-label="Critical findings">
            <h2>Key findings</h2>
            {critical.length === 0 && record.chronicConditions.length === 0 && <p className="muted">No critical finding or chronic condition is recorded.</p>}
            {critical.map((i, n) => <div key={n} className="row-between" style={{ alignItems: 'flex-start' }}><span className="grow">{i.text}</span><UrgencyTag urgency="red" /></div>)}
            {record.chronicConditions.map((c) => (
              <div key={c.name} className="row-between" style={{ alignItems: 'flex-start' }}>
                <span className="grow">{c.name}{c.since && <span className="muted"> since {c.since}</span>}</span><UrgencyTag urgency="amber" />
              </div>
            ))}
            <p className="caption"><Info size={12} aria-hidden="true" style={{ verticalAlign: -2 }} /> Report summaries are generated by AI and reviewed by the patient. Verify before acting.</p>
          </section>
          <section className="solid panel stack" aria-label="Allergies">
            <h2>Allergies</h2>
            <AllergyPanel allergies={record.allergies} />
          </section>
        </div>

        <div>
          <div className="tabs" role="tablist" aria-label="Record sections">
            {tabs.map(([key, label]) => <button key={key} role="tab" aria-selected={tab === key} onClick={() => setTab(key)}>{label}</button>)}
          </div>

          {tab === 'summary' && (
            <div className="stack">
              <Soap letter="S" title="Subjective: history reported by the patient">
                <ItemList empty="No history items." items={[
                  ...record.chronicConditions.map((c) => ({ text: `${c.name}${c.since ? `, since ${c.since}` : ''}${c.notes ? `. ${c.notes}` : ''}`, urgency: 'amber', report: 'Patient profile', date: record.generatedAt })),
                  ...record.surgeries.map((s) => ({ text: `Surgery: ${s.name}${s.date ? ` (${s.date})` : ''}${s.notes ? `. ${s.notes}` : ''}`, urgency: 'green', report: 'Patient profile', date: record.generatedAt })),
                  ...record.implants.map((s) => ({ text: `Implant: ${s.name}${s.date ? ` (${s.date})` : ''}${s.notes ? `. ${s.notes}` : ''}`, urgency: 'amber', report: 'Patient profile', date: record.generatedAt })),
                  ...itemsOf(summaries, 'surgicalHistory'),
                ]} />
              </Soap>
              <Soap letter="O" title="Objective: test results from uploaded reports">
                <ItemList empty="No test results in the uploaded reports." items={itemsOf(summaries, 'testResults')} />
              </Soap>
              <Soap letter="A" title="Assessment: diagnoses from uploaded reports">
                <ItemList empty="No diagnoses in the uploaded reports." items={[...itemsOf(summaries, 'primaryDiagnoses'), ...itemsOf(summaries, 'secondaryConditions')]} />
              </Soap>
              <Soap letter="P" title="Plan: recommendations from uploaded reports">
                <ItemList empty="No recommendations in the uploaded reports." items={itemsOf(summaries, 'recommendations')} />
              </Soap>
            </div>
          )}

          {tab === 'allergies' && <div className="solid panel"><AllergyPanel allergies={record.allergies} /></div>}

          {tab === 'medications' && (
            <div className="stack">
              <section className="solid panel stack"><h3>Active medications</h3><MedTable meds={record.activeMedications} empty="No active medication is recorded." /></section>
              <section className="solid panel stack"><h3>Past medications</h3><MedTable meds={record.pastMedications} empty="No past medication is recorded." /></section>
              <section className="solid panel stack">
                <h3>Digitized prescriptions</h3>
                {record.prescriptions.length === 0 && <p className="muted">No verified prescription is recorded.</p>}
                {record.prescriptions.map((p) => <div key={p.id} className="stack-sm"><strong>{fmtDate(p.date)}</strong><MedTable meds={p.medications} /></div>)}
              </section>
              <section className="solid panel stack"><h3>Medications mentioned in reports</h3><ItemList empty="None." items={itemsOf(summaries, 'medications')} /></section>
            </div>
          )}

          {tab === 'timeline' && <div className="solid panel"><Timeline events={record.timeline} /></div>}
        </div>
      </main>

      {left != null && left <= 60 && left > 0 && (
        <Modal title="Are you still reading?" actions={<><button className="btn btn-secondary" onClick={finish}>End session</button><button className="btn btn-primary" onClick={stay}>Continue session</button></>}>
          <p>The record will close in <strong>{left} seconds</strong> without activity.</p>
        </Modal>
      )}

      <PrintSheet record={record} age={age} critical={critical} />
    </div>
  );
}

function MedTable({ meds, empty }) {
  if (!meds.length) return <p className="muted">{empty}</p>;
  return (
    <table className="table">
      <thead><tr><th>Medication</th><th>Dosage</th><th>Frequency</th><th>Duration</th></tr></thead>
      <tbody>
        {meds.map((m, i) => (
          <tr key={i}>
            <td><strong>{m.name}</strong>{m.source === 'prescription' && <span className="caption"> · from prescription</span>}</td>
            <td data-label="Dosage">{m.dosage || '–'}</td><td data-label="Frequency">{m.frequency || '–'}</td><td data-label="Duration">{m.duration || '–'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** FR-49: one-page condensed report. Urgency is written as words so it survives black-and-white printing. */
function PrintSheet({ record, age, critical }) {
  const { patient, summaries } = record;
  const word = { red: 'CRITICAL', amber: 'Ongoing', green: 'Normal' };
  const top = (key, n) => itemsOf(summaries, key).sort(byUrgency).slice(0, n);
  return (
    <div className="print-only print-sheet">
      <h1>NIJAAT AI: Emergency clinical summary</h1>
      <p><strong>{patient.name}</strong> · Blood group <strong>{patient.bloodGroup || 'not recorded'}</strong>{age != null && ` · ${age} years`}{patient.gender && ` · ${patient.gender}`}</p>
      <p>Printed {fmtDateTime(record.generatedAt)} for {record.physician?.name}, {record.physician?.hospital}. AI-generated summaries, reviewed by the patient; verify before acting.</p>
      <h2>Allergies</h2>
      {record.allergies.length ? <ul>{record.allergies.map((a) => <li key={a.name}><strong>{a.name}</strong> ({SEVERITY[a.severity].toUpperCase()}){a.reaction && `: ${a.reaction}`}</li>)}</ul> : <p>None recorded.</p>}
      <div className="cols">
        <div>
          <h2>Critical findings and conditions</h2>
          <ul>
            {critical.slice(0, 6).map((i, n) => <li key={n}>[CRITICAL] {i.text}</li>)}
            {record.chronicConditions.slice(0, 6).map((c) => <li key={c.name}>[Ongoing] {c.name}{c.since && ` since ${c.since}`}</li>)}
            {!critical.length && !record.chronicConditions.length && <li>None recorded.</li>}
          </ul>
          <h2>Diagnoses</h2>
          <ul>{top('primaryDiagnoses', 6).map((i, n) => <li key={n}>[{word[i.urgency]}] {i.text}</li>)}{!top('primaryDiagnoses', 1).length && <li>None in reports.</li>}</ul>
          <h2>Surgeries and implants</h2>
          <ul>
            {record.surgeries.slice(0, 5).map((s) => <li key={s.name}>{s.name}{s.date && ` (${s.date})`}</li>)}
            {record.implants.slice(0, 4).map((s) => <li key={s.name}>Implant: {s.name}{s.date && ` (${s.date})`}</li>)}
            {!record.surgeries.length && !record.implants.length && <li>None recorded.</li>}
          </ul>
        </div>
        <div>
          <h2>Active medications</h2>
          <ul>{record.activeMedications.slice(0, 12).map((m, i) => <li key={i}>{m.name} {m.dosage} {m.frequency}</li>)}{!record.activeMedications.length && <li>None recorded.</li>}</ul>
          <h2>Abnormal test results</h2>
          <ul>{top('testResults', 8).filter((i) => i.urgency !== 'green').map((i, n) => <li key={n}>[{word[i.urgency]}] {i.text}</li>)}{!top('testResults', 8).some((i) => i.urgency !== 'green') && <li>None in reports.</li>}</ul>
          <h2>Recommendations</h2>
          <ul>{top('recommendations', 5).map((i, n) => <li key={n}>{i.text}</li>)}{!top('recommendations', 1).length && <li>None in reports.</li>}</ul>
        </div>
      </div>
    </div>
  );
}

export { ShieldCheck, Spinner };
