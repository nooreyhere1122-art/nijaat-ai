import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ScanLine, MapPin, LogIn, Phone, AlertTriangle, CheckCircle2, Navigation, Stethoscope, ShieldAlert, CameraOff, XCircle, RefreshCw, BellRing, BellOff, Clock,
} from 'lucide-react';
import { api, tokens, fmtDateTime } from '../api.js';
import { HeartMark, HeartWatermark, Spinner } from '../ui.jsx';
import { useAuth } from '../auth.jsx';

/* ---------- P-01 Landing ---------- */
export function Landing() {
  const { user } = useAuth();
  useEffect(() => { document.title = 'NIJAAT AI'; }, []);
  return (
    <div className="landing">
      <div className="bg-wash" />
      <HeartWatermark size={300} style={{ right: -50, top: 20 }} />
      <header className="landing-top">
        <Link to="/" className="wordmark"><HeartMark className="mark" size={32} filled /><span>NIJAAT AI</span></Link>
        <Link className="btn btn-secondary btn-sm" to={user ? '/app' : '/login'}><LogIn size={18} aria-hidden="true" />{user ? 'Open my account' : 'Log in'}</Link>
      </header>
      <main id="main" className="landing-main">
        <div className="glass landing-card stack-lg">
          <div className="stack">
            <h1 className="display">Your medical identity, one scan away</h1>
            <p className="muted" style={{ fontSize: 18, lineHeight: '28px', maxWidth: 540, margin: '0 auto' }}>
              A QR code on your helmet, vehicle or phone shows a bystander your blood group and allergies, and alerts your family with your location.
            </p>
          </div>
          <div className="action-grid">
            <Link className="btn btn-primary btn-xl" to="/scan"><ScanLine size={24} aria-hidden="true" />Scan a QR code</Link>
            <Link className="btn btn-secondary btn-xl" to="/hospitals"><MapPin size={24} aria-hidden="true" />Find hospitals</Link>
          </div>
          {!user && <p>New here? <Link to="/register">Create your medical profile</Link></p>}
        </div>
      </main>
    </div>
  );
}

/* ---------- P-02 QR scanner (FR-15) ---------- */
export function Scanner() {
  const navigate = useNavigate();
  const [state, setState] = useState('starting'); // starting | scanning | denied | unsupported | wrong
  const instance = useRef(null);

  useEffect(() => {
    document.title = 'Scan a QR code · NIJAAT AI';
    let cancelled = false;
    let scanner;
    (async () => {
      const { Html5Qrcode } = await import('html5-qrcode');
      if (cancelled) return;
      scanner = new Html5Qrcode('qr-reader');
      instance.current = scanner;
      try {
        await scanner.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: (w, h) => { const s = Math.floor(Math.min(w, h) * 0.75); return { width: s, height: s }; } },
          (text) => {
            const match = text.match(/\/e\/([\w-]{8,64})/);
            if (!match) { setState('wrong'); return; }
            navigator.vibrate?.(200); // haptic feedback after a successful scan (SRS 6.3)
            scanner.stop().catch(() => {}).finally(() => navigate(`/e/${match[1]}`));
          },
          () => {},
        );
        if (!cancelled) setState('scanning');
      } catch (err) {
        if (cancelled) return;
        setState(/NotAllowed|Permission/i.test(String(err?.name || err)) ? 'denied' : 'unsupported');
      }
    })();
    return () => {
      cancelled = true;
      const s = instance.current;
      if (s?.isScanning) s.stop().catch(() => {});
    };
  }, [navigate]);

  return (
    <div className="emergency">
      <div className="emergency-bar"><ScanLine size={20} aria-hidden="true" />Scan emergency QR code</div>
      <main id="main" className="emergency-inner">
        <div id="qr-reader" style={{ borderRadius: 16, overflow: 'hidden', background: '#000', minHeight: state === 'scanning' || state === 'wrong' ? 0 : 0 }} />
        {state === 'starting' && <div className="e-card"><Spinner label="Starting the camera. Allow camera access when asked." /></div>}
        {state === 'scanning' && <p className="center" aria-live="polite"><strong>Point the camera at the QR code.</strong> It opens automatically.</p>}
        {state === 'wrong' && (
          <div className="e-card stack-sm" role="alert">
            <strong><AlertTriangle size={20} aria-hidden="true" style={{ verticalAlign: -3 }} /> This is not a NIJAAT AI code</strong>
            <span>Keep the camera on the emergency sticker. Scanning continues.</span>
          </div>
        )}
        {(state === 'denied' || state === 'unsupported') && (
          <div className="e-card stack" role="alert">
            <strong><CameraOff size={22} aria-hidden="true" style={{ verticalAlign: -4 }} /> {state === 'denied' ? 'Camera access was blocked' : 'The camera could not be started'}</strong>
            <span>{state === 'denied'
              ? 'Allow camera access for this site in your browser settings, then try again.'
              : 'This browser cannot open the camera here.'} You can also scan the sticker with your phone’s own camera app and open the link it shows.</span>
            <button className="btn btn-primary btn-xl" onClick={() => window.location.reload()}><RefreshCw size={22} aria-hidden="true" />Try again</button>
          </div>
        )}
        <Link className="btn btn-secondary" to="/">Back</Link>
      </main>
    </div>
  );
}

/* ---------- Shared emergency profile body (FR-16, USE-2) ---------- */
function EmergencyBody({ profile }) {
  const severe = profile.allergies.filter((a) => a.severity === 'severe');
  const others = profile.allergies.filter((a) => a.severity !== 'severe');
  return (
    <>
      <div className="e-card">
        <div className="muted" style={{ fontSize: 16 }}>Name</div>
        <div className="e-name">{profile.name}</div>
      </div>
      <div className="e-card e-blood">
        <div>
          <div className="muted" style={{ fontSize: 16 }}>Blood group</div>
          <div style={{ fontWeight: 600 }}>Tell the medical team</div>
        </div>
        <div className="value" aria-label={`Blood group ${profile.bloodGroup || 'not recorded'}`}>{profile.bloodGroup || '?'}</div>
      </div>
      {profile.allergies.length === 0 ? (
        <div className="e-safe"><CheckCircle2 size={28} aria-hidden="true" /><span>No allergies recorded</span></div>
      ) : (
        <div className="e-allergy" role="region" aria-label="Allergy warnings">
          <h2><ShieldAlert size={26} aria-hidden="true" />Allergy warning</h2>
          <ul>
            {[...severe, ...others].map((a) => (
              <li key={a.name}>
                {a.name}{a.severity === 'severe' ? ' (SEVERE)' : ''}
                {(a.reaction || a.severity !== 'severe') && <span>{[a.severity !== 'severe' && `${a.severity[0].toUpperCase()}${a.severity.slice(1)}`, a.reaction].filter(Boolean).join(' · ')}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      <section className="stack-sm" aria-label="Emergency contacts">
        <h2 style={{ fontSize: 20 }}>Call family</h2>
        {profile.contacts.map((c) => (
          <a key={c.phone} className="e-call" href={`tel:${c.phone}`}>
            <Phone size={28} aria-hidden="true" />
            <span><strong>Call {c.name}</strong><span>{c.relationship} · {c.phone}</span></span>
          </a>
        ))}
      </section>
    </>
  );
}

function Countdown({ secondsLeft, total = 30 }) {
  const r = 42; const c = 2 * Math.PI * r;
  return (
    <div className="countdown-ring" aria-hidden="true">
      <svg width="96" height="96" viewBox="0 0 96 96">
        <circle cx="48" cy="48" r={r} fill="none" stroke="var(--platinum-300)" strokeWidth="8" />
        <circle cx="48" cy="48" r={r} fill="none" stroke="var(--cocoa-900)" strokeWidth="8" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - Math.min(1, secondsLeft / total))} />
      </svg>
      <div className="num">{secondsLeft}</div>
    </div>
  );
}

const SMS_STATUS = {
  sent: ['safe', 'Sent'], delivered: ['safe', 'Delivered'], queued: ['caution', 'Sending'],
  failed: ['caution', 'Retrying'], unreachable: ['critical', 'Not reached'],
};

/** FR-19 alert status indicator with the PER-1 cancel buffer. */
function AlertPanel({ alert, contactCount, onCancel, cancelling }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (alert.status !== 'pending') return undefined;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [alert.status]);
  const secondsLeft = alert.status === 'pending' ? Math.max(0, Math.ceil((new Date(alert.dispatchAt).getTime() - now) / 1000)) : 0;
  const announce = [30, 20, 10, 5].includes(secondsLeft) ? `Family alert will be sent in ${secondsLeft} seconds` : '';

  if (alert.status === 'pending') {
    return (
      <div className="e-card stack">
        <div className="countdown">
          <Countdown secondsLeft={secondsLeft} />
          <div>
            <strong style={{ fontSize: 20 }}>Alerting family in {secondsLeft} seconds</strong>
            <div className="muted">An SMS with this location goes to {contactCount} contact{contactCount === 1 ? '' : 's'}.</div>
          </div>
        </div>
        <span className="sr-only" aria-live="assertive">{announce}</span>
        <button className="btn btn-danger btn-xl btn-block" onClick={onCancel} disabled={cancelling}><BellOff size={24} aria-hidden="true" />Cancel alert (scanned by mistake)</button>
      </div>
    );
  }
  if (alert.status === 'cancelled') {
    return <div className="e-card row" role="status"><XCircle size={28} aria-hidden="true" /><div><strong>Alert cancelled</strong><div className="muted">No message was sent to the family.</div></div></div>;
  }
  const done = alert.status === 'dispatched';
  return (
    <div className="e-card" role="status" aria-live="polite">
      <div className="row">
        {done ? <BellRing size={28} color="var(--safe)" aria-hidden="true" /> : <span className="spinner" aria-hidden="true" />}
        <strong style={{ fontSize: 20 }}>{done ? 'Family has been alerted' : 'Sending the family alert'}</strong>
      </div>
      <ul className="status-list">
        {alert.contacts.map((c) => {
          const [kind, word] = SMS_STATUS[c.status] || ['neutral', c.status];
          return <li key={c.name}><span>{c.name}</span><span className={`tag tag-${kind}`}>{word}</span></li>;
        })}
      </ul>
      {done && alert.contacts.length > 0 && alert.contacts.every((c) => c.status === 'unreachable') && (
        <p style={{ marginTop: 8, fontWeight: 600 }}>No contact could be reached by SMS. Please call them using the buttons above.</p>
      )}
    </div>
  );
}

function Failure({ title, children, action }) {
  return (
    <div className="emergency">
      <div className="emergency-bar"><AlertTriangle size={20} aria-hidden="true" />NIJAAT AI</div>
      <main id="main" className="emergency-inner">
        <div className="e-card stack" role="alert">
          <h1 style={{ fontSize: 26, lineHeight: '32px' }}>{title}</h1>
          <div>{children}</div>
          {action}
        </div>
        <a className="e-call" href="tel:1122"><Phone size={28} aria-hidden="true" /><span><strong>Call Rescue 1122</strong><span>Emergency service</span></span></a>
        <Link className="btn btn-secondary btn-xl" to="/hospitals"><Navigation size={22} aria-hidden="true" />Find the nearest hospital</Link>
      </main>
    </div>
  );
}

/* ---------- P-03 Emergency profile and P-04 failure states ---------- */
export function EmergencyScan() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [cancelling, setCancelling] = useState(false);
  const started = useRef(false);

  const apply = useCallback((payload) => {
    tokens.scan = { token, session: payload.session, location: payload.location };
    setData(payload);
    setError(null);
  }, [token]);

  const scan = useCallback(async () => {
    setError(null);
    try {
      const payload = await api.post('/public/scan', { token }, { token: null });
      apply(payload);
      navigator.vibrate?.(120);
      // FR-30: ask for location after the profile is on screen; it is added to the alert if granted in time.
      if (!payload.location && navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(async (pos) => {
          try {
            const r = await api.post('/public/location', { latitude: pos.coords.latitude, longitude: pos.coords.longitude }, { token: payload.session });
            tokens.scan = { token, session: payload.session, location: r.location };
            setData((d) => (d ? { ...d, location: r.location } : d));
          } catch { /* the alert is still sent without a location */ }
        }, () => {}, { enableHighAccuracy: true, timeout: 15000 });
      }
    } catch (err) { setError(err); }
  }, [token, apply]);

  useEffect(() => {
    document.title = 'Emergency medical profile · NIJAAT AI';
    if (started.current) return;
    started.current = true;
    const saved = tokens.scan;
    if (saved?.token === token && saved.session) {
      api.get('/public/session', { token: saved.session }).then(apply).catch((err) => {
        if (err.code === 'SESSION_EXPIRED' || err.code === 'SESSION_MISSING') { tokens.scan = null; setError(err); } else setError(err);
      });
    } else scan();
  }, [token, scan, apply]);

  // Poll while the alert is pending or being sent.
  const status = data?.alert.status;
  const session = data?.session;
  useEffect(() => {
    if (!session || (status !== 'pending' && status !== 'dispatching')) return undefined;
    const t = setInterval(() => {
      api.get('/public/session', { token: session }).then((p) => setData((d) => ({ ...d, alert: p.alert, location: p.location || d.location }))).catch(() => {});
    }, 2000);
    return () => clearInterval(t);
  }, [session, status]);

  const cancel = async () => {
    setCancelling(true);
    try {
      const r = await api.post('/public/cancel', {}, { token: session });
      setData((d) => ({ ...d, alert: r.alert }));
    } catch (err) {
      if (err.body?.alert) setData((d) => ({ ...d, alert: err.body.alert }));
    } finally { setCancelling(false); }
  };

  if (error) {
    if (error.code === 'QR_INVALID') return <Failure title="This QR code is not recognised">The code may be damaged or is not a NIJAAT AI code. No medical information can be shown.</Failure>;
    if (error.code === 'QR_DEACTIVATED') return <Failure title="This QR code has been deactivated">Its owner switched this code off. No medical information can be shown.</Failure>;
    if (error.code === 'SESSION_EXPIRED' || error.code === 'SESSION_MISSING') {
      return <Failure title="This scan has expired" action={<button className="btn btn-primary btn-xl" onClick={scan}><RefreshCw size={22} aria-hidden="true" />Open the emergency profile again</button>}>For the patient’s privacy the profile closes after a while. Opening it again starts a new family alert with a 30-second cancel option.</Failure>;
    }
    if (error.code === 'OFFLINE') return <Failure title="No internet connection" action={<button className="btn btn-primary btn-xl" onClick={scan}><RefreshCw size={22} aria-hidden="true" />Try again</button>}>The medical profile cannot be loaded without a connection. Move to a place with signal and try again.</Failure>;
    return <Failure title="The profile could not be opened" action={<button className="btn btn-primary btn-xl" onClick={scan}><RefreshCw size={22} aria-hidden="true" />Try again</button>}>{error.message}</Failure>;
  }
  if (!data) return <div className="emergency"><div className="emergency-bar">Emergency medical profile</div><div className="emergency-inner"><div className="e-card"><Spinner label="Opening the emergency profile" /></div></div></div>;

  const loc = data.location;
  return (
    <div className="emergency">
      <div className="emergency-bar"><ShieldAlert size={20} aria-hidden="true" />Emergency medical profile</div>
      <main id="main" className="emergency-inner">
        <EmergencyBody profile={data.profile} />
        <AlertPanel alert={data.alert} contactCount={data.profile.contacts.length} onCancel={cancel} cancelling={cancelling} />
        <Link className="btn btn-primary btn-xl btn-block" to={`/hospitals?from=scan${loc ? `&lat=${loc.latitude}&lng=${loc.longitude}` : ''}`}>
          <Navigation size={24} aria-hidden="true" />Navigate to nearest hospital
        </Link>
        <Link className="btn btn-quiet" to="/physician"><Stethoscope size={18} aria-hidden="true" />Physician View</Link>
      </main>
    </div>
  );
}

/* ---------- Read-only profile opened from the SMS link (SRS 6.4) ---------- */
export function AlertView() {
  const { viewToken } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    document.title = 'Emergency alert · NIJAAT AI';
    api.get(`/public/alert-view/${viewToken}`, { token: null }).then(setData).catch(setError);
  }, [viewToken]);
  if (error) return <Failure title={error.code === 'OFFLINE' ? 'No internet connection' : 'This alert link is no longer available'}>{error.code === 'OFFLINE' ? 'Connect to the internet and open the link again.' : 'Alert links stop working after 24 hours. Call your family member directly.'}</Failure>;
  if (!data) return <div className="emergency"><div className="emergency-bar">Emergency alert</div><div className="emergency-inner"><div className="e-card"><Spinner label="Opening" /></div></div></div>;
  const loc = data.location;
  return (
    <div className="emergency">
      <div className="emergency-bar"><BellRing size={20} aria-hidden="true" />Emergency alert</div>
      <main id="main" className="emergency-inner">
        <div className="e-card stack-sm">
          <strong style={{ fontSize: 20 }}><Clock size={20} aria-hidden="true" style={{ verticalAlign: -3 }} /> Code scanned on {fmtDateTime(data.scannedAt)}</strong>
          <span>Someone scanned the emergency QR code of {data.profile.name}. This page is read-only.</span>
          {loc
            ? <a className="btn btn-primary btn-xl" href={`https://www.google.com/maps/search/?api=1&query=${loc.latitude},${loc.longitude}`} target="_blank" rel="noreferrer"><MapPin size={22} aria-hidden="true" />Open the scan location</a>
            : <span className="muted">The scanning device did not share its location.</span>}
        </div>
        <EmergencyBody profile={data.profile} />
        <Link className="btn btn-secondary btn-xl btn-block" to={`/hospitals${loc ? `?lat=${loc.latitude}&lng=${loc.longitude}` : ''}`}><Navigation size={22} aria-hidden="true" />Hospitals near the scan location</Link>
      </main>
    </div>
  );
}
