import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { MailCheck, CheckCircle2 } from 'lucide-react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Banner, HeartMark, HeartWatermark, Spinner, TextField } from '../ui.jsx';

function AuthCard({ title, lead, children }) {
  useEffect(() => { document.title = `${title} · NIJAAT AI`; }, [title]);
  return (
    <div className="auth-wrap">
      <div className="bg-wash" />
      <HeartWatermark size={280} style={{ right: '2%', bottom: -60 }} />
      <main id="main" className="glass auth-card stack-lg">
        <Link to="/" className="wordmark"><HeartMark className="mark" size={30} filled /><span>NIJAAT AI</span></Link>
        <div className="stack-sm">
          <h1>{title}</h1>
          {lead && <p className="muted">{lead}</p>}
        </div>
        {children}
      </main>
    </div>
  );
}

/** Shown only when the API runs without SMTP, so the flow can be completed in development. */
function DevLink({ link, label }) {
  if (!link) return null;
  const path = (() => { try { const u = new URL(link); return u.pathname + u.search; } catch { return link; } })();
  return <Banner kind="caution" title="Development mode">Email is not configured, so no message was sent. <Link to={path}>{label}</Link></Banner>;
}

function useForm(initial) {
  const [values, setValues] = useState(initial);
  const [fields, setFields] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const bind = (name) => ({ value: values[name], onChange: (v) => setValues((s) => ({ ...s, [name]: v })), error: fields[name] });
  const submit = (fn) => async (e) => {
    e.preventDefault();
    setBusy(true); setError(null); setFields({});
    try { await fn(values); } catch (err) { setFields(err.fields || {}); setError(err); } finally { setBusy(false); }
  };
  return { values, bind, submit, error, fields, busy };
}

/* A-01 (FR-01) */
export function Register() {
  const navigate = useNavigate();
  const f = useForm({ fullName: '', email: '', phone: '', password: '' });
  const onSubmit = f.submit(async (v) => {
    const r = await api.post('/auth/register', v, { token: null });
    navigate('/verify-pending', { state: { email: v.email, devLink: r.devLink } });
  });
  return (
    <AuthCard title="Create your account" lead="Your medical profile and QR code are set up after you verify your email.">
      <form className="stack" onSubmit={onSubmit} noValidate>
        {f.error && f.error.code === 'EMAIL_EXISTS' && <Banner kind="caution" title="This email is already registered"><Link to="/login">Log in instead</Link></Banner>}
        {f.error && f.error.code !== 'EMAIL_EXISTS' && !Object.keys(f.fields).length && <Banner kind="critical">{f.error.message}</Banner>}
        <TextField label="Full name" required autoComplete="name" {...f.bind('fullName')} />
        <TextField label="Email address" required type="email" autoComplete="email" {...f.bind('email')} />
        <TextField label="Phone number" required type="tel" autoComplete="tel" hint="With country code, for example +923001234567" {...f.bind('phone')} />
        <TextField label="Password" required type="password" autoComplete="new-password" hint="At least 8 characters, with a letter and a number" {...f.bind('password')} />
        <button className="btn btn-primary btn-block" disabled={f.busy}>{f.busy ? 'Creating account' : 'Create account'}</button>
      </form>
      <p className="center">Already registered? <Link to="/login">Log in</Link></p>
    </AuthCard>
  );
}

/* A-02 (FR-02) */
export function VerifyPending() {
  const { state } = useLocation();
  const [devLink, setDevLink] = useState(state?.devLink);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const email = state?.email;
  const resend = async () => {
    setBusy(true);
    try { const r = await api.post('/auth/resend-verification', { email }, { token: null }); setDevLink(r.devLink); setSent(true); } catch { /* same message either way */ } finally { setBusy(false); }
  };
  return (
    <AuthCard title="Check your email" lead={email ? `We sent a verification link to ${email}. Your account is activated when you open it.` : 'Open the verification link we sent you to activate your account.'}>
      <div className="row"><MailCheck size={28} color="var(--mocha-600)" aria-hidden="true" /><span>The link works for 24 hours.</span></div>
      <DevLink link={devLink} label="Open the verification link" />
      {sent && <Banner kind="safe">A new link has been sent.</Banner>}
      {email && <button className="btn btn-secondary" onClick={resend} disabled={busy}>Send the link again</button>}
      <p className="center"><Link to="/login">Back to log in</Link></p>
    </AuthCard>
  );
}

/* A-03 */
export function VerifyEmail() {
  const [params] = useSearchParams();
  const [state, setState] = useState({ status: 'checking' });
  const [email, setEmail] = useState('');
  const [resent, setResent] = useState(null);
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    api.post('/auth/verify-email', { token: params.get('token') || '' }, { token: null })
      .then(() => setState({ status: 'ok' }))
      .catch((err) => setState({ status: err.code === 'LINK_EXPIRED' ? 'expired' : 'invalid', message: err.message }));
  }, [params]);
  const resend = async (e) => {
    e.preventDefault();
    const r = await api.post('/auth/resend-verification', { email }, { token: null }).catch(() => ({}));
    setResent(r);
  };
  if (state.status === 'checking') return <AuthCard title="Verifying your email"><Spinner label="One moment" /></AuthCard>;
  if (state.status === 'ok') {
    return (
      <AuthCard title="Email verified" lead="Your account is active.">
        <div className="row"><CheckCircle2 size={28} color="var(--safe)" aria-hidden="true" /><span>You can now log in and set up your medical profile.</span></div>
        <Link className="btn btn-primary btn-block" to="/login">Log in</Link>
      </AuthCard>
    );
  }
  return (
    <AuthCard title={state.status === 'expired' ? 'This link has expired' : 'This link is not valid'} lead="Enter your email address and we will send a new verification link.">
      <form className="stack" onSubmit={resend}>
        <TextField label="Email address" type="email" required autoComplete="email" value={email} onChange={setEmail} />
        <button className="btn btn-primary btn-block">Send a new link</button>
      </form>
      {resent && <Banner kind="safe">If the account exists and is not verified, a new link has been sent.</Banner>}
      <DevLink link={resent?.devLink} label="Open the verification link" />
    </AuthCard>
  );
}

/* A-04 (FR-03) */
export function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const { login, user } = useAuth();
  const f = useForm({ email: '', password: '' });
  useEffect(() => { if (user) navigate('/app', { replace: true }); }, [user, navigate]);
  const onSubmit = f.submit(async (v) => {
    const r = await api.post('/auth/login', v, { token: null });
    login(r.token, r.user);
    navigate(location.state?.from || '/app', { replace: true });
  });
  return (
    <AuthCard title="Log in" lead="Manage your medical profile, QR code and records.">
      <form className="stack" onSubmit={onSubmit} noValidate>
        {f.error?.code === 'EMAIL_UNVERIFIED' && (
          <Banner kind="caution" title="Verify your email first"><Link to="/verify-pending" state={{ email: f.values.email }}>Send the verification link again</Link></Banner>
        )}
        {f.error && f.error.code !== 'EMAIL_UNVERIFIED' && !Object.keys(f.fields).length && <Banner kind="critical">{f.error.message}</Banner>}
        <TextField label="Email address" required type="email" autoComplete="email" {...f.bind('email')} />
        <TextField label="Password" required type="password" autoComplete="current-password" {...f.bind('password')} />
        <button className="btn btn-primary btn-block" disabled={f.busy}>{f.busy ? 'Logging in' : 'Log in'}</button>
      </form>
      <div className="row-between">
        <Link to="/forgot-password">Forgot password?</Link>
        <Link to="/register">Create an account</Link>
      </div>
    </AuthCard>
  );
}

/* A-05 (FR-04) */
export function ForgotPassword() {
  const f = useForm({ email: '' });
  const [done, setDone] = useState(null);
  const onSubmit = f.submit(async (v) => setDone(await api.post('/auth/forgot-password', v, { token: null })));
  return (
    <AuthCard title="Reset your password" lead="Enter your registered email address and we will send a reset link.">
      {done ? (
        <>
          <Banner kind="safe">If the email is registered, a reset link has been sent. It works for 1 hour.</Banner>
          <DevLink link={done.devLink} label="Open the reset link" />
        </>
      ) : (
        <form className="stack" onSubmit={onSubmit} noValidate>
          {f.error && !Object.keys(f.fields).length && <Banner kind="critical">{f.error.message}</Banner>}
          <TextField label="Email address" required type="email" autoComplete="email" {...f.bind('email')} />
          <button className="btn btn-primary btn-block" disabled={f.busy}>Send reset link</button>
        </form>
      )}
      <p className="center"><Link to="/login">Back to log in</Link></p>
    </AuthCard>
  );
}

/* A-06 */
export function ResetPassword() {
  const [params] = useSearchParams();
  const f = useForm({ password: '' });
  const [done, setDone] = useState(false);
  const onSubmit = f.submit(async (v) => { await api.post('/auth/reset-password', { token: params.get('token') || '', password: v.password }, { token: null }); setDone(true); });
  return (
    <AuthCard title="Choose a new password">
      {done ? (
        <>
          <Banner kind="safe">Your password has been changed.</Banner>
          <Link className="btn btn-primary btn-block" to="/login">Log in</Link>
        </>
      ) : (
        <form className="stack" onSubmit={onSubmit} noValidate>
          {f.error && !f.fields.password && <Banner kind="critical">{f.error.message} <Link to="/forgot-password">Request a new link</Link></Banner>}
          <TextField label="New password" required type="password" autoComplete="new-password" hint="At least 8 characters, with a letter and a number" {...f.bind('password')} />
          <button className="btn btn-primary btn-block" disabled={f.busy}>Change password</button>
        </form>
      )}
    </AuthCard>
  );
}
