import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Trash2, ArrowUp, ArrowDown, Send, History, AlertCircle } from 'lucide-react';
import { api, fmtDateTime } from '../api.js';
import { Banner, ErrorState, PageLoading, SelectField, TextField, useAsync, useToast } from '../ui.jsx';

const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
const DRAFT_KEY = 'nijaat.profileDraft';
const FIELD_LABELS = {
  personal: 'Personal details', bloodGroup: 'Blood group', allergies: 'Allergies', chronicConditions: 'Chronic conditions',
  medications: 'Medications', surgeries: 'Surgeries', implants: 'Implants', emergencyContacts: 'Emergency contacts',
};

/** Repeating list editor: add, edit, remove, reorder. */
function ListEditor({ title, description, items, onChange, columns, blank, errors, prefix, addLabel, reorder }) {
  const update = (i, key, value) => onChange(items.map((it, n) => (n === i ? { ...it, [key]: value } : it)));
  const move = (i, d) => { const next = [...items]; [next[i], next[i + d]] = [next[i + d], next[i]]; onChange(next); };
  return (
    <section className="glass panel stack" id={prefix}>
      <div><h3>{title}</h3>{description && <p className="small muted">{description}</p>}</div>
      {errors[prefix] && <span className="error-text"><AlertCircle size={16} aria-hidden="true" />{errors[prefix]}</span>}
      {items.length === 0 && <p className="muted">Nothing added yet.</p>}
      {items.map((item, i) => (
        <div key={i} className="item-card stack-sm">
          <div className="row-between">
            <span className="label muted">{reorder ? `Priority ${i + 1}` : `${title} ${i + 1}`}{item.source === 'prescription' && ' · from a verified prescription'}</span>
            <span className="row" style={{ gap: 0 }}>
              {reorder && <button type="button" className="icon-btn" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move ${item.name || 'entry'} up`}><ArrowUp size={20} /></button>}
              {reorder && <button type="button" className="icon-btn" onClick={() => move(i, 1)} disabled={i === items.length - 1} aria-label={`Move ${item.name || 'entry'} down`}><ArrowDown size={20} /></button>}
              <button type="button" className="icon-btn" onClick={() => onChange(items.filter((_, n) => n !== i))} aria-label={`Remove ${item.name || 'entry'}`}><Trash2 size={20} /></button>
            </span>
          </div>
          <div className="form-grid">
            {columns.map((col) => {
              const error = errors[`${prefix}.${i}.${col.key}`];
              if (col.options) return <SelectField key={col.key} label={col.label} value={item[col.key]} onChange={(v) => update(i, col.key, v)} options={col.options} error={error} />;
              if (col.type === 'checkbox') {
                return (
                  <label key={col.key} className="row" style={{ minHeight: 48 }}>
                    <input type="checkbox" checked={!!item[col.key]} onChange={(e) => update(i, col.key, e.target.checked)} style={{ width: 22, height: 22, accentColor: 'var(--cocoa-900)' }} />
                    {col.label}
                  </label>
                );
              }
              return <TextField key={col.key} label={col.label} value={item[col.key]} onChange={(v) => update(i, col.key, v)} error={error} hint={col.hint} required={col.required} type={col.type || 'text'} placeholder={col.placeholder} />;
            })}
          </div>
        </div>
      ))}
      <div><button type="button" className="btn btn-secondary" onClick={() => onChange([...items, { ...blank }])}><Plus size={20} aria-hidden="true" />{addLabel}</button></div>
    </section>
  );
}

const dateHint = 'Year, or YYYY-MM-DD';
const CONTACT_COLUMNS = [
  { key: 'name', label: 'Full name', required: true },
  { key: 'relationship', label: 'Relationship', required: true, placeholder: 'Father, spouse, friend' },
  { key: 'phone', label: 'Mobile number', required: true, type: 'tel', hint: 'With country code, e.g. +923001234567' },
];

async function saveProfile(profile) {
  return api.put('/profile', profile);
}

/* ---------- U-02 / U-03 Medical profile, U-05 history (FR-05, FR-07) ---------- */
export function ProfilePage() {
  const toast = useToast();
  const { data, loading, error, reload } = useAsync(() => api.get('/profile'), []);
  const [p, setP] = useState(null);
  const [meta, setMeta] = useState(null);
  const [errors, setErrors] = useState({});
  const [saveError, setSaveError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState('details');
  const [draft, setDraft] = useState(() => { try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); } catch { return null; } });
  const history = useAsync(() => (tab === 'history' ? api.get('/profile/history') : Promise.resolve(null)), [tab]);

  useEffect(() => { if (data) { setP(data.profile); setMeta(data); } }, [data]);

  if (loading && !p) return <PageLoading />;
  if (error && !p) return <ErrorState error={error} onRetry={reload} />;
  if (!p) return null;

  const set = (key, value) => setP((s) => ({ ...s, [key]: value }));
  const setPersonal = (key, value) => setP((s) => ({ ...s, personal: { ...s.personal, [key]: value } }));

  const save = async (e) => {
    e?.preventDefault();
    setBusy(true); setErrors({}); setSaveError(null);
    try {
      const r = await saveProfile(p);
      setP(r.profile); setMeta((m) => ({ ...m, ...r, updatedAt: new Date().toISOString() }));
      localStorage.removeItem(DRAFT_KEY); setDraft(null);
      toast(r.changedFields.length ? `Profile saved as version ${r.version}` : 'No changes to save');
    } catch (err) {
      setErrors(err.fields || {}); setSaveError(err);
      if (err.status === 0) localStorage.setItem(DRAFT_KEY, JSON.stringify(p)); // UC-2 E2: keep the draft
      else if (Object.keys(err.fields || {}).length) {
        const first = Object.keys(err.fields)[0].split('.')[0];
        document.getElementById(first)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    } finally { setBusy(false); }
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Medical Profile</h1>
          <p className="muted">{meta.version ? `Version ${meta.version}, last updated ${fmtDateTime(meta.updatedAt)}` : 'Not saved yet. Fill in the sections below and save.'}</p>
        </div>
      </div>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'details'} onClick={() => setTab('details')}>Details</button>
        <button role="tab" aria-selected={tab === 'history'} onClick={() => setTab('history')}><History size={18} aria-hidden="true" style={{ marginRight: 6 }} />History</button>
      </div>

      {tab === 'history' && (
        <div className="glass panel">
          {history.loading && <PageLoading />}
          {history.data && history.data.history.length === 0 && <div className="empty">No changes recorded yet.</div>}
          {history.data && history.data.history.length > 0 && (
            <table className="table">
              <thead><tr><th>Version</th><th>Date and time</th><th>Sections changed</th><th>Emergency data</th></tr></thead>
              <tbody>
                {history.data.history.map((h) => (
                  <tr key={h.version}>
                    <td><strong>Version {h.version}</strong></td>
                    <td data-label="When">{fmtDateTime(h.at)}</td>
                    <td data-label="Changed">{h.changedFields.map((f) => FIELD_LABELS[f] || f).join(', ')}</td>
                    <td data-label="Emergency data">{h.critical ? <span className="tag tag-caution">Changed</span> : <span className="muted">Unchanged</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === 'details' && (
        <form className="stack-lg" onSubmit={save} noValidate>
          {draft && (
            <Banner kind="caution" title="You have an unsaved draft" action={(
              <div className="row">
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setP(draft); setDraft(null); }}>Restore draft</button>
                <button type="button" className="btn btn-quiet btn-sm" onClick={() => { localStorage.removeItem(DRAFT_KEY); setDraft(null); }}>Discard</button>
              </div>
            )}>A previous save did not reach the server.</Banner>
          )}
          {meta.missing?.length > 0 && (
            <Banner kind="caution" title="Your profile is not complete yet">Needed before a QR code can be generated: {meta.missing.join(', ')}.</Banner>
          )}
          {saveError && (
            <Banner kind="critical" title={saveError.status === 0 ? 'Not saved: no connection' : 'Not saved'} action={saveError.status === 0 && <div><button type="button" className="btn btn-secondary btn-sm" onClick={save}>Try again</button></div>}>
              {saveError.status === 0 ? 'Your changes are kept on this device as a draft.' : saveError.message}
            </Banner>
          )}

          <section className="glass panel stack" id="personal">
            <h3>Personal details</h3>
            <div className="form-grid">
              <TextField label="Date of birth" required type="date" value={p.personal.dateOfBirth} onChange={(v) => setPersonal('dateOfBirth', v)} error={errors['personal.dateOfBirth']} />
              <SelectField label="Gender" value={p.personal.gender} onChange={(v) => setPersonal('gender', v)} options={[{ value: '', label: 'Prefer not to say' }, { value: 'male', label: 'Male' }, { value: 'female', label: 'Female' }, { value: 'other', label: 'Other' }]} />
              <TextField label="City" value={p.personal.city} onChange={(v) => setPersonal('city', v)} error={errors['personal.city']} />
            </div>
            <TextField label="Address" value={p.personal.address} onChange={(v) => setPersonal('address', v)} error={errors['personal.address']} hint="Never shown to bystanders" />
          </section>

          <section className="glass panel stack" id="bloodGroup">
            <div><h3>Blood group</h3><p className="small muted">Shown first on your emergency profile.</p></div>
            <div className="chips" role="radiogroup" aria-label="Blood group">
              {BLOOD_GROUPS.map((g) => (
                <button key={g} type="button" role="radio" aria-checked={p.bloodGroup === g} className="chip-option" onClick={() => set('bloodGroup', g)}>{g}</button>
              ))}
            </div>
            {errors.bloodGroup && <span className="error-text"><AlertCircle size={16} aria-hidden="true" />{errors.bloodGroup}</span>}
          </section>

          <ListEditor title="Allergies" prefix="allergies" description="Shown as warnings on your emergency profile." items={p.allergies} onChange={(v) => set('allergies', v)} errors={errors}
            addLabel="Add allergy" blank={{ name: '', severity: 'moderate', reaction: '' }}
            columns={[{ key: 'name', label: 'Allergic to', required: true, placeholder: 'Penicillin' },
              { key: 'severity', label: 'Severity', options: [{ value: 'severe', label: 'Severe' }, { value: 'moderate', label: 'Moderate' }, { value: 'mild', label: 'Mild' }] },
              { key: 'reaction', label: 'Reaction', placeholder: 'Swelling, rash' }]} />

          <ListEditor title="Chronic conditions" prefix="chronicConditions" items={p.chronicConditions} onChange={(v) => set('chronicConditions', v)} errors={errors}
            addLabel="Add condition" blank={{ name: '', since: '', notes: '' }}
            columns={[{ key: 'name', label: 'Condition', required: true, placeholder: 'Type 2 diabetes' }, { key: 'since', label: 'Since', hint: dateHint }, { key: 'notes', label: 'Notes' }]} />

          <ListEditor title="Current medications" prefix="medications" items={p.medications} onChange={(v) => set('medications', v)} errors={errors}
            addLabel="Add medication" blank={{ name: '', dosage: '', frequency: '', duration: '', active: true, source: 'manual' }}
            columns={[{ key: 'name', label: 'Medication', required: true }, { key: 'dosage', label: 'Dosage', placeholder: '500 mg' },
              { key: 'frequency', label: 'Frequency', placeholder: 'Twice daily' }, { key: 'duration', label: 'Duration' }, { key: 'active', label: 'Currently taking', type: 'checkbox' }]} />

          <ListEditor title="Past surgeries" prefix="surgeries" items={p.surgeries} onChange={(v) => set('surgeries', v)} errors={errors}
            addLabel="Add surgery" blank={{ name: '', date: '', notes: '' }}
            columns={[{ key: 'name', label: 'Surgery', required: true }, { key: 'date', label: 'Date', hint: dateHint }, { key: 'notes', label: 'Notes' }]} />

          <ListEditor title="Implants" prefix="implants" items={p.implants} onChange={(v) => set('implants', v)} errors={errors}
            addLabel="Add implant" blank={{ name: '', date: '', notes: '' }}
            columns={[{ key: 'name', label: 'Implant', required: true, placeholder: 'Pacemaker' }, { key: 'date', label: 'Date', hint: dateHint }, { key: 'notes', label: 'Notes' }]} />

          <ListEditor title="Emergency contacts" prefix="emergencyContacts" description="Alerted by SMS in this order when your code is scanned. Up to five." items={p.emergencyContacts} onChange={(v) => set('emergencyContacts', v)} errors={errors}
            addLabel="Add contact" blank={{ name: '', relationship: '', phone: '' }} columns={CONTACT_COLUMNS} reorder />

          <div className="glass panel-sm row-between" style={{ position: 'sticky', bottom: 16, zIndex: 5 }}>
            <span className="small muted">Every save is recorded in your history.</span>
            <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving' : 'Save profile'}</button>
          </div>
        </form>
      )}
    </div>
  );
}

/* ---------- U-04 Emergency contacts with test SMS (FR-27, FR-29) ---------- */
export function ContactsPage() {
  const toast = useToast();
  const { data, loading, error, reload } = useAsync(() => api.get('/profile'), []);
  const [contacts, setContacts] = useState(null);
  const [errors, setErrors] = useState({});
  const [saveError, setSaveError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [test, setTest] = useState(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => { if (data) setContacts(data.profile.emergencyContacts); }, [data]);
  if (loading && !contacts) return <PageLoading />;
  if (error && !contacts) return <ErrorState error={error} onRetry={reload} />;
  if (!contacts) return null;

  const dirty = JSON.stringify(contacts) !== JSON.stringify(data.profile.emergencyContacts);
  const save = async () => {
    setBusy(true); setErrors({}); setSaveError(null);
    try {
      const r = await saveProfile({ ...data.profile, emergencyContacts: contacts });
      setContacts(r.profile.emergencyContacts);
      await reload();
      toast('Emergency contacts saved');
    } catch (err) { setErrors(err.fields || {}); setSaveError(err); } finally { setBusy(false); }
  };
  const sendTest = async () => {
    setTesting(true); setTest(null);
    try { setTest(await api.post('/profile/test-sms')); } catch (err) { setTest({ error: err.message }); } finally { setTesting(false); }
  };

  return (
    <div className="stack-lg">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div><h1>Emergency Contacts</h1><p className="muted">These people receive an SMS with the scan location, 30 seconds after your code is scanned.</p></div>
      </div>
      {saveError && !Object.keys(errors).length && <Banner kind="critical" title="Not saved">{saveError.message}</Banner>}
      <ListEditor title="Contacts" prefix="emergencyContacts" description="The first contact is alerted first. Each SMS is retried up to three times." items={contacts} onChange={setContacts} errors={errors}
        addLabel="Add contact" blank={{ name: '', relationship: '', phone: '' }} columns={CONTACT_COLUMNS} reorder />
      <div className="row">
        <button className="btn btn-primary" onClick={save} disabled={busy || !dirty}>{busy ? 'Saving' : 'Save contacts'}</button>
        {dirty && <span className="small muted">You have unsaved changes.</span>}
      </div>

      <section className="glass panel stack">
        <div><h3>Test the alert chain</h3><p className="small muted">Sends a sample SMS to every saved contact so you know the numbers work before an emergency.</p></div>
        <div><button className="btn btn-secondary" onClick={sendTest} disabled={testing || dirty || !data.profile.emergencyContacts.length}><Send size={20} aria-hidden="true" />{testing ? 'Sending' : 'Send test SMS'}</button></div>
        {dirty && <span className="small muted">Save your changes before sending a test.</span>}
        {test?.error && <Banner kind="critical">{test.error}</Banner>}
        {test?.results && (
          <>
            {test.devMode && <Banner kind="caution" title="Development mode">No SMS gateway is configured. Messages were written to the server log, not sent.</Banner>}
            <ul className="list">
              {test.results.map((r) => (
                <li key={r.phone} className="row-between"><span>{r.name} · {r.phone}</span><span className={`tag ${r.delivered ? 'tag-safe' : 'tag-critical'}`}>{r.delivered ? 'Sent' : 'Failed'}</span></li>
              ))}
            </ul>
          </>
        )}
      </section>
      <p className="small muted">Contacts are part of your medical profile. <Link to="/app/profile">Open the full profile</Link></p>
    </div>
  );
}
