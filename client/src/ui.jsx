import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, XCircle, AlertCircle } from 'lucide-react';

/* ---------- Toasts ---------- */
const ToastContext = createContext(() => {});
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((message, kind = 'safe') => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, message, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toast-region no-print" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="glass-raised toast">
            {t.kind === 'critical' ? <XCircle size={20} color="var(--critical)" /> : <CheckCircle2 size={20} color="var(--safe)" />}
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/* ---------- Basics ---------- */
export function Spinner({ label = 'Loading' }) {
  return <span className="row" role="status"><span className="spinner" aria-hidden="true" /><span>{label}</span></span>;
}

export function PageLoading() {
  return <div className="stack" aria-busy="true" aria-label="Loading"><div className="skeleton" style={{ height: 40, width: '40%' }} /><div className="skeleton" style={{ height: 160 }} /><div className="skeleton" style={{ height: 160 }} /></div>;
}

const bannerIcons = { critical: XCircle, caution: AlertTriangle, safe: CheckCircle2, info: Info };
export function Banner({ kind = 'info', title, children, action }) {
  const Icon = bannerIcons[kind];
  return (
    <div className={`banner banner-${kind}`} role={kind === 'critical' ? 'alert' : 'status'}>
      <Icon size={20} aria-hidden="true" />
      <div className="grow stack-sm">
        {title && <strong>{title}</strong>}
        {children && <div>{children}</div>}
        {action}
      </div>
    </div>
  );
}

const urgencyMeta = {
  red: { cls: 'critical', word: 'Critical', Icon: AlertTriangle },
  amber: { cls: 'caution', word: 'Ongoing', Icon: AlertCircle },
  green: { cls: 'safe', word: 'Normal', Icon: CheckCircle2 },
};
/** FR-22: colour always comes with an icon and a word. */
export function UrgencyTag({ urgency }) {
  const m = urgencyMeta[urgency] || urgencyMeta.green;
  return <span className={`tag tag-${m.cls}`}><m.Icon size={14} aria-hidden="true" />{m.word}</span>;
}

export function StatusTag({ kind = 'neutral', children, icon: Icon }) {
  return <span className={`tag tag-${kind}`}>{Icon && <Icon size={14} aria-hidden="true" />}{children}</span>;
}

/** FR-25 */
export function Confidence({ value }) {
  const pct = Math.round((value || 0) * 100);
  return (
    <span className="meter" title="How sure the system is that this item was read correctly">
      <span className="meter-bar" aria-hidden="true"><span style={{ width: `${pct}%` }} /></span>
      <span>{pct}% confidence</span>
    </span>
  );
}

/* ---------- Form field with linked error text (USE-4) ---------- */
export function Field({ label, error, hint, children, required }) {
  const id = useId();
  const describedBy = [error && `${id}-err`, hint && `${id}-hint`].filter(Boolean).join(' ') || undefined;
  return (
    <div className="field">
      <label htmlFor={id}>{label}{required && <span aria-hidden="true"> *</span>}</label>
      {children({ id, 'aria-invalid': error ? 'true' : undefined, 'aria-describedby': describedBy, required })}
      {hint && !error && <span id={`${id}-hint`} className="hint">{hint}</span>}
      {error && <span id={`${id}-err`} className="error-text"><AlertCircle size={16} aria-hidden="true" />{error}</span>}
    </div>
  );
}

export function TextField({ label, error, hint, required, value, onChange, type = 'text', ...rest }) {
  return (
    <Field label={label} error={error} hint={hint} required={required}>
      {(p) => <input className="input" type={type} value={value ?? ''} onChange={(e) => onChange(e.target.value)} {...p} {...rest} />}
    </Field>
  );
}

export function SelectField({ label, error, hint, value, onChange, options, required }) {
  return (
    <Field label={label} error={error} hint={hint} required={required}>
      {(p) => (
        <select className="select" value={value ?? ''} onChange={(e) => onChange(e.target.value)} {...p}>
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      )}
    </Field>
  );
}

/* ---------- Modal with focus trap ---------- */
export function Modal({ title, children, onClose, actions }) {
  const ref = useRef(null);
  const titleId = useId();
  useEffect(() => {
    const previous = document.activeElement;
    const node = ref.current;
    const focusables = () => node.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    focusables()[0]?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape' && onClose) onClose();
      if (e.key !== 'Tab') return;
      const f = [...focusables()];
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); previous?.focus?.(); };
  }, [onClose]);
  return (
    <div className="modal-backdrop no-print" onMouseDown={(e) => { if (e.target === e.currentTarget && onClose) onClose(); }}>
      <div ref={ref} className="glass-raised modal stack" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <h2 id={titleId}>{title}</h2>
        <div>{children}</div>
        <div className="row" style={{ justifyContent: 'flex-end' }}>{actions}</div>
      </div>
    </div>
  );
}

export function Confirm({ title, body, confirmLabel, danger, onConfirm, onCancel, busy }) {
  return (
    <Modal title={title} onClose={onCancel} actions={(
      <>
        <button className="btn btn-secondary" onClick={onCancel}>Cancel</button>
        <button className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={onConfirm} disabled={busy}>{confirmLabel}</button>
      </>
    )}>{body}</Modal>
  );
}

const HEART = 'M50 87.5C50 87.5 6.5 58.5 6.5 30.5 6.5 15.8 17.6 5 29.8 5c9 0 16.8 4.9 20.2 12.9C53.4 9.9 61.2 5 70.2 5c12.2 0 23.3 10.8 23.3 25.5 0 28-43.5 57-43.5 57z';
const PULSE = 'M13 44h17.5l5.5-13.5L47 59l7-17 5 8.5h27';

/**
 * The product's signature mark: a heart with a pulse line through it.
 * `filled` for the logo, plain outline for the large watermark behind a panel.
 */
export function HeartMark({ size = 44, filled = false, pulse = true, className = '', style, strokeWidth = 5 }) {
  return (
    <svg className={className} style={style} width={size} height={size * 0.92} viewBox="0 0 100 92" fill="none" aria-hidden="true">
      <path d={HEART} fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={strokeWidth} strokeLinejoin="round" />
      {pulse && (
        <path d={PULSE} fill="none" stroke={filled ? 'var(--heart-pulse, #FAF7F2)' : 'currentColor'}
          strokeWidth={filled ? strokeWidth + 1 : strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      )}
    </svg>
  );
}

/** Large decorative heart behind a panel. One per screen. */
export function HeartWatermark({ style, size = 260, className = 'heart-watermark' }) {
  return <HeartMark className={className} style={style} size={size} strokeWidth={2} />;
}

export function useAsync(fn, deps = []) {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  const reload = useCallback(async () => {
    try {
      const data = await fn();
      setState({ loading: false, data, error: null });
      return data;
    } catch (error) {
      setState((s) => ({ loading: false, data: s.data, error }));
      return null;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { setState((s) => ({ ...s, loading: true })); reload(); }, [reload]);
  return { ...state, reload, setData: (data) => setState((s) => ({ ...s, data })) };
}

export function ErrorState({ error, onRetry }) {
  return (
    <Banner kind="critical" title="This could not be loaded" action={onRetry && <div><button className="btn btn-secondary btn-sm" onClick={onRetry}>Try again</button></div>}>
      {error?.message}
    </Banner>
  );
}
