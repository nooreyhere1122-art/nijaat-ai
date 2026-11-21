import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import QRCode from 'qrcode';
import {
  HeartPulse, QrCode as QrIcon, Users, ScanLine, UploadCloud, Camera, Send, Eye, ArrowRight, CalendarClock,
  Droplet, AlertTriangle, Sparkles, Download, MapPin, FileText, Pill, UserCog, BellRing, BellOff, CheckCircle2,
  ShieldCheck, Navigation, LocateFixed,
} from 'lucide-react';
import { api, fmtDate, fmtDateTime } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Banner, Confirm, HeartMark, HeartWatermark, Modal, PageLoading, Spinner, UrgencyTag, useAsync, useToast } from '../ui.jsx';
import { PinIcon, FACILITY } from './Hospitals.jsx';

const SEVERITY = { severe: 'Severe', moderate: 'Moderate', mild: 'Mild' };

/* ---------- Hero artwork: the heart and pulse motif, drawn, not photographed ---------- */
function HeroArt() {
  return (
    <svg className="art" width="300" height="230" viewBox="0 0 300 230" fill="none" aria-hidden="true">
      <circle cx="168" cy="112" r="104" stroke="rgba(250,247,242,.18)" strokeWidth="1.5" />
      <circle cx="168" cy="112" r="76" stroke="rgba(250,247,242,.12)" strokeWidth="1.5" />
      <g transform="translate(112 62) scale(1.12)">
        <path d="M50 87.5C50 87.5 6.5 58.5 6.5 30.5 6.5 15.8 17.6 5 29.8 5c9 0 16.8 4.9 20.2 12.9C53.4 9.9 61.2 5 70.2 5c12.2 0 23.3 10.8 23.3 25.5 0 28-43.5 57-43.5 57z"
          fill="rgba(250,247,242,.14)" stroke="rgba(250,247,242,.85)" strokeWidth="3.5" strokeLinejoin="round" />
        <path d="M13 44h17.5l5.5-13.5L47 59l7-17 5 8.5h27" fill="none" stroke="#FAF7F2" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      </g>
      <path d="M44 150h26l9-22 15 46 11-28 8 14h22" stroke="rgba(250,247,242,.4)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

function Tile({ icon: Icon, label, value, note, to, badge }) {
  const inner = (
    <>
      <span className="ring"><Icon size={24} aria-hidden="true" /></span>
      <span className="grow" style={{ minWidth: 0 }}>
        <span className="label" style={{ display: 'block' }}>{label}</span>
        <span className="value" style={{ display: 'block' }}>{value}</span>
        {note && <span className="note">{note}</span>}
      </span>
      {badge}
    </>
  );
  const className = 'glass stat col-3';
  return to
    ? <Link to={to} className={className} style={{ textDecoration: 'none', color: 'inherit' }}>{inner}</Link>
    : <div className={className}>{inner}</div>;
}

function Section({ icon: Icon, title, children, to, linkLabel }) {
  return (
    <section className="item-card stack-sm">
      <div className="row-between">
        <h3 className="row" style={{ gap: 8 }}><Icon size={18} color="var(--mocha-600)" aria-hidden="true" />{title}</h3>
        {to && <Link className="btn btn-quiet btn-sm" to={to}>{linkLabel || 'Edit'}</Link>}
      </div>
      {children}
    </section>
  );
}

/** Optional emergency preview (U-15): shows the owner exactly what a bystander sees. */
function EmergencyPreview({ onClose }) {
  const { data, loading, error } = useAsync(() => api.get('/profile/emergency-preview'), []);
  return (
    <Modal title="What a bystander sees" onClose={onClose} actions={<button className="btn btn-primary" onClick={onClose}>Close</button>}>
      {loading && <Spinner label="Loading" />}
      {error && <Banner kind="critical">{error.message}</Banner>}
      {data && (
        <div className="stack-sm">
          <p className="small muted">Only these details leave your account when your code is scanned. Everything else stays private.</p>
          <div className="solid panel-sm stack-sm">
            <div><span className="small muted">Name</span><div style={{ fontSize: 20, fontWeight: 600 }}>{data.profile.name}</div></div>
            <div className="row-between"><span className="small muted">Blood group</span><span className="blood-badge">{data.profile.bloodGroup || '?'}</span></div>
            <div>
              <span className="small muted">Allergy warnings</span>
              {data.profile.allergies.length === 0 ? <div>None recorded</div> : (
                <ul className="list">{data.profile.allergies.map((a) => <li key={a.name}><strong>{a.name}</strong> · {SEVERITY[a.severity]}{a.reaction && ` · ${a.reaction}`}</li>)}</ul>
              )}
            </div>
            <div>
              <span className="small muted">One-tap call buttons</span>
              {data.profile.contacts.length === 0 ? <div>No contacts</div> : (
                <ul className="list">{data.profile.contacts.map((c) => <li key={c.phone}>{c.name} · {c.relationship} · {c.phone}</li>)}</ul>
              )}
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

/**
 * Emergency Alert panel. Sends the same alert a QR scan sends, with the same 30-second
 * cancel window, so nothing goes out before the owner can stop it.
 */
function EmergencyAlertCard({ contactCount, onSent }) {
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [alertId, setAlertId] = useState(null);
  const [alert, setAlert] = useState(null);
  const [now, setNow] = useState(Date.now());

  const status = alert?.status;
  useEffect(() => {
    if (!alertId || (status !== 'pending' && status !== 'dispatching')) return undefined;
    const tick = setInterval(() => setNow(Date.now()), 250);
    const poll = setInterval(() => {
      api.get(`/profile/panic/${alertId}`).then((r) => setAlert(r.alert)).catch(() => {});
    }, 2000);
    return () => { clearInterval(tick); clearInterval(poll); };
  }, [alertId, status]);

  const trigger = async () => {
    setBusy(true);
    const send = async (coords) => {
      try {
        const r = await api.post('/profile/panic', coords);
        setAlertId(r.alertId); setAlert(r.alert); setNow(Date.now());
        onSent?.();
      } catch (err) { toast(err.message, 'critical'); } finally { setBusy(false); setConfirm(false); }
    };
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => send({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
        () => send({}), { enableHighAccuracy: true, timeout: 8000 },
      );
    } else send({});
  };

  const cancel = async () => {
    try { const r = await api.post(`/profile/panic/${alertId}/cancel`); setAlert(r.alert); } catch (err) { toast(err.message, 'critical'); }
  };

  const secondsLeft = status === 'pending' ? Math.max(0, Math.ceil((new Date(alert.dispatchAt).getTime() - now) / 1000)) : 0;

  return (
    <div className="cocoa-card col-4">
      <HeartWatermark size={200} />
      {!alert && (
        <>
          <h3 className="row" style={{ gap: 10 }}><span className="live-dot" aria-hidden="true" />Emergency Alert</h3>
          <p>Notify your {contactCount === 1 ? 'emergency contact' : `${contactCount} emergency contacts`} with your location, without waiting for anyone to scan your code.</p>
          <div>
            <button className="btn btn-secondary" disabled={busy || contactCount === 0} onClick={() => setConfirm(true)}>
              <BellRing size={20} aria-hidden="true" />{busy ? 'Sending' : 'Trigger Alert'}<ArrowRight size={18} aria-hidden="true" />
            </button>
          </div>
          {contactCount === 0 && <p className="small">Add an emergency contact first.</p>}
        </>
      )}
      {status === 'pending' && (
        <>
          <h3 className="row" style={{ gap: 10 }}><span className="live-dot" aria-hidden="true" />Sending in {secondsLeft}s</h3>
          <p>Your contacts will get an SMS with your location. You can still stop it.</p>
          <div><button className="btn btn-danger" onClick={cancel}><BellOff size={20} aria-hidden="true" />Cancel alert</button></div>
        </>
      )}
      {(status === 'dispatching' || status === 'dispatched') && (
        <>
          <h3 className="row" style={{ gap: 10 }}>{status === 'dispatched' ? <CheckCircle2 size={20} aria-hidden="true" /> : <span className="spinner" aria-hidden="true" />}{status === 'dispatched' ? 'Family alerted' : 'Sending the alert'}</h3>
          <ul className="list" style={{ borderColor: 'rgba(250,247,242,.2)' }}>
            {alert.contacts.map((c) => (
              <li key={c.name} className="row-between" style={{ borderColor: 'rgba(250,247,242,.2)' }}>
                <span>{c.name}</span>
                <span className={`tag ${c.status === 'unreachable' ? 'tag-critical' : c.status === 'delivered' || c.status === 'sent' ? 'tag-safe' : 'tag-caution'}`}>
                  {c.status === 'unreachable' ? 'Not reached' : c.status === 'failed' ? 'Retrying' : c.status === 'queued' ? 'Sending' : c.status === 'delivered' ? 'Delivered' : 'Sent'}
                </span>
              </li>
            ))}
          </ul>
          <Link className="btn btn-secondary btn-sm" to="/app/activity">See the delivery log</Link>
        </>
      )}
      {status === 'cancelled' && (
        <>
          <h3>Alert cancelled</h3>
          <p>No message was sent. You can trigger a new alert at any time.</p>
          <div><button className="btn btn-secondary" onClick={() => { setAlert(null); setAlertId(null); }}>Back</button></div>
        </>
      )}
      {confirm && (
        <Confirm title="Send an emergency alert now?" danger confirmLabel="Yes, alert my family" busy={busy}
          onCancel={() => setConfirm(false)} onConfirm={trigger}
          body={`An SMS with your location goes to your ${contactCount} emergency contact${contactCount === 1 ? '' : 's'} after a 30-second countdown. You can cancel during the countdown.`} />
      )}
    </div>
  );
}

/* ---------- U-01 Dashboard (SRS 6.1.2) ---------- */
export default function Dashboard() {
  const { user } = useAuth();
  const toast = useToast();
  const profile = useAsync(() => api.get('/profile'), []);
  const qr = useAsync(() => api.get('/qr'), []);
  const activity = useAsync(() => api.get('/qr/activity'), []);
  const reports = useAsync(() => api.get('/reports'), []);
  const prescriptions = useAsync(() => api.get('/prescriptions'), []);
  const [preview, setPreview] = useState(false);
  const [testing, setTesting] = useState(false);
  const canvas = useRef(null);

  const url = qr.data?.qr?.url;
  useEffect(() => {
    if (url && canvas.current) QRCode.toCanvas(canvas.current, url, { errorCorrectionLevel: 'H', margin: 1, width: 180, color: { dark: '#2E1F1A', light: '#FFFFFF' } }).catch(() => {});
  }, [url]);

  if (profile.loading && !profile.data) return <PageLoading />;

  const p = profile.data?.profile;
  const complete = profile.data?.complete;
  const missing = profile.data?.missing || [];
  const status = qr.data?.status;
  const scans = activity.data?.scans || [];
  const realScans = scans.filter((s) => s.source !== 'self');
  const refills = (prescriptions.data?.prescriptions || []).filter((x) => x.refillDate).sort((a, b) => new Date(a.refillDate) - new Date(b.refillDate));
  const activeMeds = (p?.medications || []).filter((m) => m.active);
  const firstName = user.fullName.split(' ')[0];

  const sendTest = async () => {
    setTesting(true);
    try { const r = await api.post('/profile/test-sms'); toast(`Test SMS sent to ${r.results.filter((x) => x.delivered).length} of ${r.results.length} contacts`); activity.reload(); }
    catch (err) { toast(err.message, 'critical'); } finally { setTesting(false); }
  };

  // A new user sees only the setup card.
  if (!complete) {
    return (
      <div className="stack-lg">
        <div className="hero">
          <HeroArt />
          <h1>Welcome, {firstName}</h1>
          <p>Three steps and your emergency QR code is ready to print.</p>
          <Link className="btn btn-primary" to="/app/profile"><HeartPulse size={20} aria-hidden="true" />Start my medical profile</Link>
        </div>
        {!user.emailVerified && <Banner kind="caution" title="Your email is not verified"><Link to="/verify-pending" state={{ email: user.email }}>Send the verification link again</Link></Banner>}
        <section className="glass panel stack-lg" style={{ position: 'relative', overflow: 'hidden' }}>
          <HeartWatermark size={240} style={{ right: -60, bottom: -70 }} />
          <h2>Set up your medical identity</h2>
          <ol className="stack">
            <li><strong>Blood group and date of birth</strong><div className="small muted">Shown first to whoever finds you.</div></li>
            <li><strong>Allergies and conditions</strong><div className="small muted">Severe allergies appear as a warning on the emergency screen.</div></li>
            <li><strong>Emergency contacts</strong><div className="small muted">They receive an SMS with your location when your code is scanned.</div></li>
          </ol>
          {missing.length > 0 && <Banner kind="caution" title="Still needed">{missing.join(', ')}</Banner>}
          <div className="row">
            <Link className="btn btn-primary" to="/app/profile"><HeartPulse size={20} aria-hidden="true" />{profile.data.version ? 'Continue setting up' : 'Start my medical profile'}</Link>
            <Link className="btn btn-secondary" to="/app/contacts"><Users size={20} aria-hidden="true" />Add emergency contacts</Link>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="stack-lg">
      {/* Hero and emergency alert */}
      <div className="grid-12">
        <div className="hero col-8">
          <HeroArt />
          <h1>Your Health,<br />Our Priority</h1>
          <p>Welcome back, {firstName}. Your emergency identity is set up and ready.</p>
          <Link className="btn btn-primary" to="/app/profile">View My Profile<ArrowRight size={18} aria-hidden="true" /></Link>
        </div>
        <EmergencyAlertCard contactCount={p.emergencyContacts.length} onSent={() => activity.reload()} />
      </div>

      {/* Status tiles */}
      <div className="grid-12">
        <Tile icon={HeartPulse} label="Medical profile" value="Complete" note={`Version ${profile.data.version} · ${fmtDate(profile.data.updatedAt)}`} to="/app/profile"
          badge={<CheckCircle2 size={22} color="var(--safe)" aria-hidden="true" />} />
        <Tile icon={QrIcon} label="Total scans" value={activity.data?.totalScans ?? '–'} note={realScans[0] ? `Last ${fmtDateTime(realScans[0].scannedAt)}` : 'Never scanned'} to="/app/activity" />
        <Tile icon={Users} label="Emergency contacts" value={p.emergencyContacts.length} note={activity.data?.lastTestSmsAt ? `Tested ${fmtDate(activity.data.lastTestSmsAt)}` : 'Not tested yet'} to="/app/contacts" />
        <Tile icon={Droplet} label="Blood group" value={p.bloodGroup || '–'}
          note={p.bloodGroup === 'O-' ? 'Universal donor' : p.bloodGroup === 'AB+' ? 'Universal recipient' : p.bloodGroup ? `Rh ${p.bloodGroup.endsWith('+') ? 'positive' : 'negative'}` : 'Not recorded'} to="/app/profile" />
      </div>

      {/* Attention banners */}
      {!user.emailVerified && <Banner kind="caution" title="Your email is not verified"><Link to="/verify-pending" state={{ email: user.email }}>Send the verification link again</Link></Banner>}
      {status === 'not_generated' && <Banner kind="caution" title="Your QR code is not generated yet" action={<div><Link className="btn btn-secondary btn-sm" to="/app/qr">Generate my QR code</Link></div>}>Your profile is complete, so you can generate and print it now.</Banner>}
      {status === 'deactivated' && <Banner kind="critical" title="Your QR code is deactivated" action={<div><Link className="btn btn-secondary btn-sm" to="/app/qr">Generate a new code</Link></div>}>A scan of your printed sticker shows no medical data and alerts nobody.</Banner>}
      {p.emergencyContacts.length === 0 && <Banner kind="critical" title="No emergency contact" action={<div><Link className="btn btn-secondary btn-sm" to="/app/contacts">Add a contact</Link></div>}>Nobody will be alerted when your code is scanned.</Banner>}

      {/* QR, activity, AI summary */}
      <div className="grid-12">
        <section className="glass panel stack-sm col-4" aria-label="Your QR code" style={{ position: 'relative', overflow: 'hidden' }}>
          <HeartWatermark size={190} style={{ left: -50, bottom: -60, opacity: .07 }} />
          <h3>Your QR Code</h3>
          <p className="small muted">Scan to open your emergency medical information.</p>
          {status === 'active' ? (
            <>
              <div className="qr-preview"><canvas ref={canvas} role="img" aria-label="Your emergency QR code" /></div>
              <p className="caption">Scanned {qr.data.qr.scanCount} time{qr.data.qr.scanCount === 1 ? '' : 's'} · downloaded {qr.data.qr.downloadCount} time{qr.data.qr.downloadCount === 1 ? '' : 's'}</p>
              <div className="row">
                <Link className="btn btn-primary grow" to="/app/qr"><Download size={18} aria-hidden="true" />Download QR</Link>
                <button className="btn btn-secondary" onClick={() => setPreview(true)}><Eye size={18} aria-hidden="true" />Preview</button>
              </div>
            </>
          ) : (
            <>
              <p>{status === 'deactivated' ? 'Your code is switched off.' : 'Generate your code to print it.'}</p>
              <Link className="btn btn-primary btn-block" to="/app/qr"><QrIcon size={20} aria-hidden="true" />Go to QR Management</Link>
            </>
          )}
        </section>

        <section className="glass panel stack col-4" aria-label="Recent activity">
          <div className="row-between"><h3>Recent Activity</h3><Link className="btn btn-quiet btn-sm" to="/app/activity">View All <ArrowRight size={16} aria-hidden="true" /></Link></div>
          {scans.length === 0 && (reports.data?.reports.length || 0) === 0
            ? <p className="muted">Nothing has happened yet. Upload a report or print your QR code to get started.</p>
            : (
              <ul className="feed">
                {scans.slice(0, 2).map((s) => (
                  <li key={s.id}>
                    <span className="dot"><ScanLine size={20} aria-hidden="true" /></span>
                    <span>
                      <strong>{s.source === 'self' ? 'Alert triggered by you' : 'QR scanned'}</strong>
                      <span className="caption" style={{ display: 'block' }}>{fmtDateTime(s.scannedAt)}</span>
                      <span className="small muted">{s.alertStatus === 'dispatched' ? 'Family alerted' : s.alertStatus === 'cancelled' ? 'Alert cancelled' : 'Alert pending'}</span>
                    </span>
                  </li>
                ))}
                {(reports.data?.reports || []).slice(0, 2).map((r) => (
                  <li key={r.id}>
                    <span className="dot"><FileText size={20} aria-hidden="true" /></span>
                    <span style={{ minWidth: 0 }}>
                      <strong>Report uploaded</strong>
                      <span className="caption" style={{ display: 'block' }}>{fmtDateTime(r.uploadedAt)}</span>
                      <span className="small muted" style={{ wordBreak: 'break-word' }}>{r.fileName}</span>
                    </span>
                  </li>
                ))}
                <li>
                  <span className="dot"><UserCog size={20} aria-hidden="true" /></span>
                  <span>
                    <strong>Profile updated</strong>
                    <span className="caption" style={{ display: 'block' }}>{fmtDateTime(profile.data.updatedAt)}</span>
                    <span className="small muted">Version {profile.data.version}</span>
                  </span>
                </li>
              </ul>
            )}
        </section>

        <AiSummaryCard reports={reports} />
      </div>

      {/* Profile detail */}
      <div className="grid-12">
        <div className="col-8 stack">
          <Section icon={AlertTriangle} title={`Allergies (${p.allergies.length})`} to="/app/profile">
            {p.allergies.length === 0 ? <p className="muted">None recorded.</p> : (
              <ul className="list">
                {p.allergies.map((a) => (
                  <li key={a.name} className="row-between">
                    <span><strong>{a.name}</strong>{a.reaction && <span className="small muted"> · {a.reaction}</span>}</span>
                    <span className={`tag ${a.severity === 'severe' ? 'tag-critical' : a.severity === 'moderate' ? 'tag-caution' : 'tag-neutral'}`}>{SEVERITY[a.severity]}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
          <div className="grid-12" style={{ gap: 16 }}>
            <div className="col-6">
              <Section icon={HeartPulse} title={`Chronic conditions (${p.chronicConditions.length})`} to="/app/profile">
                {p.chronicConditions.length === 0 ? <p className="muted">None recorded.</p> : (
                  <ul className="list">{p.chronicConditions.map((c) => <li key={c.name}><strong>{c.name}</strong>{c.since && <span className="small muted"> · since {c.since}</span>}</li>)}</ul>
                )}
              </Section>
            </div>
            <div className="col-6">
              <Section icon={Pill} title={`Active medications (${activeMeds.length})`} to="/app/profile">
                {activeMeds.length === 0 ? <p className="muted">None recorded.</p> : (
                  <ul className="list">{activeMeds.slice(0, 5).map((m, i) => <li key={i}><strong>{m.name}</strong><span className="small muted"> {[m.dosage, m.frequency].filter(Boolean).join(' · ')}</span></li>)}</ul>
                )}
              </Section>
            </div>
          </div>
          <Section icon={Users} title={`Emergency contacts (${p.emergencyContacts.length})`} to="/app/contacts">
            {p.emergencyContacts.length === 0 ? <p className="muted">None recorded.</p> : (
              <ul className="list">{p.emergencyContacts.map((c, i) => <li key={c.phone} className="row-between"><span><strong>{c.name}</strong> <span className="small muted">{c.relationship} · {c.phone}</span></span><span className="tag tag-neutral">Priority {i + 1}</span></li>)}</ul>
            )}
          </Section>
        </div>

        <div className="col-4 stack">
          <section className="glass panel stack-sm" aria-label="Quick actions">
            <h3>Quick actions</h3>
            <Link className="btn btn-secondary btn-block" to="/app/reports"><UploadCloud size={18} aria-hidden="true" />Upload a report</Link>
            <Link className="btn btn-secondary btn-block" to="/app/prescriptions"><Camera size={18} aria-hidden="true" />Scan a prescription</Link>
            <button className="btn btn-secondary btn-block" onClick={sendTest} disabled={testing || !p.emergencyContacts.length}><Send size={18} aria-hidden="true" />{testing ? 'Sending' : 'Send test SMS'}</button>
          </section>

          <section className="glass panel stack-sm" aria-label="Refill reminders">
            <div className="row-between"><h3>Refill reminders</h3><Link className="btn btn-quiet btn-sm" to="/app/prescriptions">All <ArrowRight size={16} aria-hidden="true" /></Link></div>
            {refills.length === 0 ? <p className="muted">No refill dates set.</p> : (
              <ul className="list">
                {refills.slice(0, 3).map((x) => {
                  const days = Math.ceil((new Date(x.refillDate) - Date.now()) / 86400000);
                  return (
                    <li key={x.id} className="row-between">
                      <span className="small"><CalendarClock size={16} aria-hidden="true" style={{ verticalAlign: -3 }} /> {x.medications.map((m) => m.name).join(', ')}</span>
                      <span className={`tag ${days < 0 ? 'tag-critical' : days <= 7 ? 'tag-caution' : 'tag-neutral'}`}>{days < 0 ? 'Overdue' : days === 0 ? 'Today' : `${days} d`}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      </div>

      {/* Hospitals and the closing card */}
      <div className="grid-12">
        <NearbyHospitals />
        <div className="cocoa-card col-4" style={{ justifyContent: 'center', minHeight: 170 }}>
          <HeartWatermark size={190} style={{ right: -30, bottom: -40 }} />
          <div className="quote-line">Because<br />Your Life Matters</div>
          <HeartMark size={34} filled style={{ color: 'var(--pearl-50)', '--heart-pulse': '#2E1F1A' }} />
        </div>
      </div>

      {preview && <EmergencyPreview onClose={() => setPreview(false)} />}
    </div>
  );
}

/**
 * Summarises what the uploaded reports actually say. It never offers reassurance the data
 * does not support: with no summarised report it says so instead.
 */
function AiSummaryCard({ reports }) {
  const list = reports.data?.reports || [];
  const summarised = list.filter((r) => r.status === 'summarized');
  const critical = summarised.filter((r) => r.urgency === 'red').length;
  const ongoing = summarised.filter((r) => r.urgency === 'amber').length;
  const pending = list.filter((r) => r.status === 'processing' || r.status === 'uploaded').length;

  return (
    <section className="glass panel stack-sm col-4" aria-label="Report summary" style={{ position: 'relative', overflow: 'hidden' }}>
      <div className="row-between">
        <h3>Report Summary</h3>
        <span className="tag tag-neutral"><Sparkles size={14} aria-hidden="true" />AI generated</span>
      </div>
      {reports.loading && <Spinner label="Loading" />}
      {!reports.loading && list.length === 0 && (
        <>
          <p className="muted">No medical report has been uploaded yet. Upload one and it is read into eight sections you can check and correct.</p>
          <Link className="btn btn-secondary btn-sm" to="/app/reports"><UploadCloud size={18} aria-hidden="true" />Upload a report</Link>
        </>
      )}
      {!reports.loading && list.length > 0 && (
        <>
          {summarised.length === 0
            ? <p>{pending ? `${pending} report${pending === 1 ? ' is' : 's are'} still being read.` : 'No report has been summarised yet.'}</p>
            : (
              <>
                <p>
                  Across {summarised.length} summarised report{summarised.length === 1 ? '' : 's'}:{' '}
                  {critical > 0
                    ? <><strong>{critical}</strong> with a critical finding{ongoing > 0 && <>, <strong>{ongoing}</strong> with ongoing treatment</>}.</>
                    : ongoing > 0
                      ? <><strong>{ongoing}</strong> with ongoing treatment, none critical.</>
                      : 'no critical or ongoing findings were flagged.'}
                </p>
                <div className="row">
                  {critical > 0 && <UrgencyTag urgency="red" />}
                  {ongoing > 0 && <UrgencyTag urgency="amber" />}
                  {critical === 0 && ongoing === 0 && <UrgencyTag urgency="green" />}
                </div>
              </>
            )}
          <p className="caption">Generated by AI from your uploads and reviewed by you. It is not a diagnosis; check it with your doctor.</p>
          <Link className="btn btn-secondary btn-sm" to="/app/reports">View Detailed Report<ArrowRight size={16} aria-hidden="true" /></Link>
        </>
      )}
    </section>
  );
}

/** Top three facilities from the last search, or an invitation to run one. */
function NearbyHospitals() {
  const [cached, setCached] = useState(null);
  useEffect(() => {
    try { setCached(JSON.parse(localStorage.getItem('nijaat.hospitals') || 'null')); } catch { setCached(null); }
  }, []);
  const results = (cached?.results || []).slice(0, 3);

  return (
    <section className="glass panel stack col-8" aria-label="Nearby hospitals">
      <div className="row-between">
        <h3 className="row" style={{ gap: 8 }}><MapPin size={18} color="var(--mocha-600)" aria-hidden="true" />Nearby Hospitals{cached && <span className="small muted">Within {cached.radiusKm} km</span>}</h3>
        <Link className="btn btn-quiet btn-sm" to="/app/hospitals">View on Map <ArrowRight size={16} aria-hidden="true" /></Link>
      </div>
      {results.length === 0 ? (
        <div className="row" style={{ gap: 16 }}>
          <p className="muted grow">Find hospitals, clinics and trauma centres near you, sorted by travel time.</p>
          <Link className="btn btn-primary" to="/app/hospitals"><LocateFixed size={18} aria-hidden="true" />Find hospitals</Link>
        </div>
      ) : (
        <>
          <div className="grid-12" style={{ gap: 16 }}>
            {results.map((f) => (
              <div key={f.id} className="col-4 item-card stack-sm">
                <div className="row" style={{ flexWrap: 'nowrap' }}>
                  <PinIcon type={f.facilityType} size={28} />
                  <span style={{ minWidth: 0 }}>
                    <strong style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</strong>
                    <span className="caption">{FACILITY[f.facilityType].label}</span>
                  </span>
                </div>
                <div className="row small"><span>{(f.distanceM / 1000).toFixed(1)} km</span><span className="muted">·</span><span>{f.travelTimeMinutes} min</span></div>
                <a className="btn btn-secondary btn-sm" href={`https://www.google.com/maps/dir/?api=1&destination=${f.latitude},${f.longitude}&travelmode=driving`} target="_blank" rel="noreferrer">
                  <Navigation size={16} aria-hidden="true" />Navigate
                </a>
              </div>
            ))}
          </div>
          <p className="caption">From your last search on {fmtDateTime(cached.fetchedAt)}. Open the map for live travel times.</p>
        </>
      )}
    </section>
  );
}

export { ShieldCheck };
