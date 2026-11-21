import { useEffect, useState } from 'react';
import { LogOut, ShieldCheck, Save } from 'lucide-react';
import { api, fmtDateTime } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Banner, PageLoading, TextField, useAsync, useToast } from '../ui.jsx';

const ACTIONS = {
  profile_updated: 'Medical profile updated',
  password_changed: 'Password changed',
  password_reset: 'Password reset',
  qr_generated: 'QR code generated',
  qr_regenerated: 'QR code replaced',
  qr_deactivated: 'QR code deactivated',
  qr_scanned: 'QR code scanned',
  alert_dispatched: 'Family alert sent',
  alert_cancelled: 'Family alert cancelled by the scanner',
  test_sms_sent: 'Test SMS sent',
  report_uploaded: 'Report uploaded',
  report_deleted: 'Report deleted',
  summary_edited: 'Report summary edited',
  prescription_verified: 'Prescription confirmed',
  prescription_updated: 'Prescription updated',
  prescription_deleted: 'Prescription deleted',
  physician_code_requested: 'Physician requested access',
  physician_access_granted: 'Physician access granted',
  physician_access_denied: 'Physician access attempt refused',
  physician_record_viewed: 'Physician viewed the medical record',
  physician_session_ended: 'Physician session ended',
  physician_session_expired: 'Physician session expired',
};
const HIGHLIGHT = ['physician_code_requested', 'physician_access_granted', 'physician_access_denied', 'physician_record_viewed', 'qr_scanned'];

/* ---------- U-14 Account settings (FR-03) with the owner's access log (BR-06) ---------- */
export default function Settings() {
  const { user, setUser, logout } = useAuth();
  const toast = useToast();
  const [details, setDetails] = useState({ fullName: '', phone: '' });
  const [detailFields, setDetailFields] = useState({});
  const [detailError, setDetailError] = useState(null);
  const [savingDetails, setSavingDetails] = useState(false);
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' });
  const [pwFields, setPwFields] = useState({});
  const [pwError, setPwError] = useState(null);
  const [savingPw, setSavingPw] = useState(false);
  const audit = useAsync(() => api.get('/audit'), []);

  useEffect(() => { setDetails({ fullName: user.fullName, phone: user.phone }); }, [user]);

  const saveDetails = async (e) => {
    e.preventDefault();
    setSavingDetails(true); setDetailFields({}); setDetailError(null);
    try { const r = await api.put('/auth/me', details); setUser(r.user); toast('Account details saved'); }
    catch (err) { setDetailFields(err.fields || {}); setDetailError(err); } finally { setSavingDetails(false); }
  };

  const changePassword = async (e) => {
    e.preventDefault();
    setSavingPw(true); setPwFields({}); setPwError(null);
    try { await api.post('/auth/change-password', pw); setPw({ currentPassword: '', newPassword: '' }); toast('Password changed'); audit.reload(); }
    catch (err) { setPwFields(err.fields || {}); setPwError(err); } finally { setSavingPw(false); }
  };

  const dirty = details.fullName !== user.fullName || details.phone !== user.phone;

  return (
    <div className="stack-lg">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div><h1>Settings</h1><p className="muted">Your account details, password and access history.</p></div>
      </div>

      <section className="glass panel stack">
        <h3>Account details</h3>
        <form className="stack" onSubmit={saveDetails} noValidate>
          {detailError && !Object.keys(detailFields).length && <Banner kind="critical" title="Not saved">{detailError.message}</Banner>}
          <div className="form-grid">
            <TextField label="Full name" required value={details.fullName} onChange={(v) => setDetails({ ...details, fullName: v })} error={detailFields.fullName} autoComplete="name" />
            <TextField label="Phone number" required type="tel" value={details.phone} onChange={(v) => setDetails({ ...details, phone: v })} error={detailFields.phone} hint="With country code" autoComplete="tel" />
          </div>
          <TextField label="Email address" value={user.email} onChange={() => {}} readOnly hint="Your email is used to log in and cannot be changed here." />
          <div><button className="btn btn-primary" disabled={savingDetails || !dirty}><Save size={20} aria-hidden="true" />{savingDetails ? 'Saving' : 'Save details'}</button></div>
        </form>
      </section>

      <section className="glass panel stack">
        <h3>Change password</h3>
        <form className="stack" onSubmit={changePassword} noValidate>
          {pwError && !Object.keys(pwFields).length && <Banner kind="critical">{pwError.message}</Banner>}
          <div className="form-grid">
            <TextField label="Current password" required type="password" value={pw.currentPassword} onChange={(v) => setPw({ ...pw, currentPassword: v })} error={pwFields.currentPassword} autoComplete="current-password" />
            <TextField label="New password" required type="password" value={pw.newPassword} onChange={(v) => setPw({ ...pw, newPassword: v })} error={pwFields.newPassword} hint="At least 8 characters, with a letter and a number" autoComplete="new-password" />
          </div>
          <div><button className="btn btn-primary" disabled={savingPw || !pw.currentPassword || !pw.newPassword}>{savingPw ? 'Changing' : 'Change password'}</button></div>
        </form>
      </section>

      <section className="glass panel stack">
        <div><h3 className="row" style={{ gap: 8 }}><ShieldCheck size={20} color="var(--mocha-600)" aria-hidden="true" />Access history</h3>
          <p className="small muted">Everything that happened to your record, including every physician who opened it.</p></div>
        {audit.loading && <PageLoading />}
        {audit.error && <Banner kind="critical">{audit.error.message}</Banner>}
        {audit.data && audit.data.entries.length === 0 && <div className="empty">Nothing recorded yet.</div>}
        {audit.data && audit.data.entries.length > 0 && (
          <table className="table">
            <thead><tr><th>Event</th><th>Who</th><th>Details</th><th>When</th></tr></thead>
            <tbody>
              {audit.data.entries.map((e, i) => (
                <tr key={i}>
                  <td><strong>{ACTIONS[e.action] || e.action}</strong>{HIGHLIGHT.includes(e.action) && <span className={`tag ${e.action === 'physician_access_denied' ? 'tag-critical' : 'tag-neutral'}`} style={{ marginLeft: 8 }}>{e.actorType === 'physician' ? 'Physician' : 'Scan'}</span>}</td>
                  <td data-label="Who">{e.actorLabel || (e.actorType === 'user' ? 'You' : e.actorType === 'system' ? 'System' : e.actorType === 'bystander' ? 'Whoever scanned your code' : e.actorType)}</td>
                  <td data-label="Details">{e.detail || '–'}</td>
                  <td data-label="When" className="nowrap">{fmtDateTime(e.timestamp)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="glass panel stack">
        <h3>Log out</h3>
        <p className="muted">Your QR code keeps working while you are logged out. It only stops if you deactivate it.</p>
        <div><button className="btn btn-secondary" onClick={logout}><LogOut size={20} aria-hidden="true" />Log out</button></div>
      </section>
    </div>
  );
}
