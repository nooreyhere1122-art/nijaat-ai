import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, HeartPulse, Users, QrCode, FileText, Pill, MapPin, Activity, Settings as SettingsIcon, LogOut,
  FolderHeart, Menu, Search, Bell, ScanLine, AlertTriangle, CheckCircle2, CircleSlash, MailWarning, CalendarClock, X,
} from 'lucide-react';
import { useAuth } from './auth.jsx';
import { api, fmtDateTime } from './api.js';
import { StatusTag, HeartMark, HeartWatermark } from './ui.jsx';

const NAV = [
  { to: '/app', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/app/profile', label: 'My Profile', icon: HeartPulse },
  { to: '/app/contacts', label: 'Emergency Contacts', icon: Users },
  { to: '/app/qr', label: 'QR Management', icon: QrCode },
  { to: '/app/reports', label: 'Medical Reports', icon: FileText },
  { to: '/app/prescriptions', label: 'Prescription Scanner', icon: Pill },
  { to: '/app/hospitals', label: 'Hospital Locator', icon: MapPin },
  { to: '/app/activity', label: 'Activity', icon: Activity },
];

const TITLES = [
  ['/app/profile', 'My Profile'], ['/app/contacts', 'Emergency Contacts'], ['/app/qr', 'QR Management'],
  ['/app/reports', 'Medical Reports'], ['/app/prescriptions', 'Prescription Scanner'], ['/app/hospitals', 'Hospital Locator'],
  ['/app/activity', 'Activity'], ['/app/settings', 'Settings'], ['/app', 'Dashboard'],
];

export function useOnline() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true); const off = () => setOnline(false);
    window.addEventListener('online', on); window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  return online;
}

export function QrStatusChip({ status }) {
  if (status === 'active') return <StatusTag kind="safe" icon={CheckCircle2}>QR active</StatusTag>;
  if (status === 'deactivated') return <StatusTag kind="critical" icon={CircleSlash}>QR deactivated</StatusTag>;
  return <StatusTag kind="caution" icon={AlertTriangle}>QR not generated</StatusTag>;
}

const initials = (name) => name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

/** Closes a popover on an outside click or Escape. */
function useDismiss(open, close) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) close(); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open, close]);
  return ref;
}

/** Searches the places a user actually has things: destinations, reports, prescriptions. */
function QuickSearch() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [docs, setDocs] = useState(null);
  const close = useCallback(() => setOpen(false), []);
  const box = useDismiss(open, close);

  const load = () => {
    if (docs) return;
    Promise.all([api.get('/reports').catch(() => ({ reports: [] })), api.get('/prescriptions').catch(() => ({ prescriptions: [] }))])
      .then(([r, p]) => setDocs({
        reports: r.reports.map((x) => ({ label: x.fileName, to: `/app/reports/${x.id}`, kind: 'Report', icon: FileText })),
        prescriptions: p.prescriptions.map((x) => ({
          label: x.medications.map((m) => m.name).join(', ') || 'Prescription',
          to: `/app/prescriptions/${x.id}`, kind: 'Prescription', icon: Pill,
        })),
      }));
  };

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const pages = NAV.concat([{ to: '/app/settings', label: 'Settings', icon: SettingsIcon }])
      .filter((n) => n.label.toLowerCase().includes(q))
      .map((n) => ({ label: n.label, to: n.to, kind: 'Page', icon: n.icon }));
    const rest = [...(docs?.reports || []), ...(docs?.prescriptions || [])].filter((d) => d.label.toLowerCase().includes(q));
    return [...pages, ...rest].slice(0, 8);
  }, [query, docs]);

  const go = (to) => { setQuery(''); setOpen(false); navigate(to); };

  return (
    <div className="search" ref={box}>
      <Search size={20} aria-hidden="true" />
      <input
        type="search" placeholder="Search anything…" value={query} aria-label="Search your pages, reports and prescriptions"
        onFocus={() => { load(); setOpen(true); }}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onKeyDown={(e) => { if (e.key === 'Enter' && results[0]) go(results[0].to); }}
      />
      {open && query.trim() && (
        <div className="glass-raised menu-pop" role="listbox" aria-label="Search results">
          {results.length === 0 ? <p className="small muted" style={{ padding: '10px 12px' }}>Nothing matches “{query}”.</p> : results.map((r) => (
            <button key={`${r.kind}-${r.to}-${r.label}`} className="row-item" onClick={() => go(r.to)}>
              <r.icon size={18} aria-hidden="true" />
              <span className="grow"><span style={{ display: 'block' }}>{r.label}</span><span className="caption">{r.kind}</span></span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Things that actually need the owner's attention, newest first. */
function Notifications({ qrStatus }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const close = useCallback(() => setOpen(false), []);
  const box = useDismiss(open, close);
  const seenKey = `nijaat.seenAlerts.${user.id}`;

  useEffect(() => {
    let alive = true;
    Promise.all([
      api.get('/qr/activity').catch(() => ({ scans: [] })),
      api.get('/prescriptions').catch(() => ({ prescriptions: [] })),
    ]).then(([a, p]) => {
      if (!alive) return;
      const list = [];
      if (!user.emailVerified) list.push({ id: 'email', icon: MailWarning, title: 'Your email is not verified', detail: 'Verify it to keep your account secure', to: '/app/settings', kind: 'critical' });
      if (qrStatus === 'deactivated') list.push({ id: 'qr-off', icon: CircleSlash, title: 'Your QR code is deactivated', detail: 'A scan shows no medical data', to: '/app/qr', kind: 'critical' });
      if (qrStatus === 'not_generated') list.push({ id: 'qr-none', icon: QrCode, title: 'No QR code yet', detail: 'Generate and print your code', to: '/app/qr', kind: 'caution' });
      for (const s of (a.scans || []).slice(0, 5)) {
        list.push({
          id: `scan-${s.id}`, icon: ScanLine, at: s.scannedAt,
          title: s.source === 'self' ? 'You triggered an emergency alert' : 'Your QR code was scanned',
          detail: `${fmtDateTime(s.scannedAt)} · ${s.alertStatus === 'dispatched' ? 'family alerted' : s.alertStatus === 'cancelled' ? 'alert cancelled' : 'alert pending'}`,
          to: '/app/activity',
        });
      }
      for (const x of p.prescriptions || []) {
        if (!x.refillDate) continue;
        const days = Math.ceil((new Date(x.refillDate) - Date.now()) / 86400000);
        if (days <= 7) {
          list.push({
            id: `refill-${x.id}`, icon: CalendarClock, kind: days < 0 ? 'critical' : 'caution',
            title: days < 0 ? 'A refill is overdue' : days === 0 ? 'A refill is due today' : `A refill is due in ${days} days`,
            detail: x.medications.map((m) => m.name).join(', '), to: `/app/prescriptions/${x.id}`,
          });
        }
      }
      setItems(list);
    });
    return () => { alive = false; };
  }, [qrStatus, user.emailVerified]);

  let seen = [];
  try { seen = JSON.parse(localStorage.getItem(seenKey) || '[]'); } catch { seen = []; }
  const unread = items.filter((i) => !seen.includes(i.id)).length;

  const toggle = () => {
    setOpen((o) => {
      if (!o) localStorage.setItem(seenKey, JSON.stringify(items.map((i) => i.id)));
      return !o;
    });
  };

  return (
    <div className="bell" ref={box}>
      <button className="icon-btn" onClick={toggle} aria-expanded={open}
        aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}>
        <Bell size={22} />
        {unread > 0 && <span className="badge" aria-hidden="true">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <div className="glass-raised menu-pop">
          <h4>Notifications</h4>
          {items.length === 0 && <p className="small muted" style={{ padding: '10px 12px' }}>Nothing needs your attention.</p>}
          {items.map((i) => (
            <button key={i.id} className="row-item" onClick={() => { setOpen(false); navigate(i.to); }}>
              <i.icon size={18} aria-hidden="true" style={i.kind === 'critical' ? { color: 'var(--critical)' } : i.kind === 'caution' ? { color: 'var(--caution)' } : undefined} />
              <span className="grow"><span style={{ display: 'block', fontWeight: 500 }}>{i.title}</span><span className="caption">{i.detail}</span></span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Shell() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const online = useOnline();
  const [qrStatus, setQrStatus] = useState(null);
  const [more, setMore] = useState(false);
  const title = TITLES.find(([prefix]) => location.pathname.startsWith(prefix))?.[1] || 'NIJAAT AI';

  const refreshQrStatus = useCallback(() => { api.get('/qr').then((r) => setQrStatus(r.status)).catch(() => {}); }, []);

  useEffect(() => {
    setMore(false);
    refreshQrStatus();
    document.title = `${title} · NIJAAT AI`;
  }, [location.pathname, title, refreshQrStatus]);

  // The QR page tells the shell when the code is generated, replaced or switched off.
  useEffect(() => {
    window.addEventListener('nijaat:qr', refreshQrStatus);
    return () => window.removeEventListener('nijaat:qr', refreshQrStatus);
  }, [refreshQrStatus]);

  const tabActive = (...prefixes) => prefixes.some((p) => (p === '/app' ? location.pathname === '/app' : location.pathname.startsWith(p)));

  return (
    <div className="shell">
      <div className="bg-wash" />
      <nav className="sidebar no-print" aria-label="Main">
        <Link to="/app" className="brand">
          <HeartMark className="mark" size={46} filled />
          <span className="name">NIJAAT AI</span>
          <span className="tagline">Your Medical Identity.<br />One Scan Away.</span>
        </Link>
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`} title={label}>
            <Icon size={20} aria-hidden="true" /><span>{label}</span>
          </NavLink>
        ))}
        <NavLink to="/app/settings" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`} title="Settings">
          <SettingsIcon size={20} aria-hidden="true" /><span>Settings</span>
        </NavLink>
        <div className="spacer" />
        <button className="nav-item logout" style={{ cursor: 'pointer', font: 'inherit', fontWeight: 500 }} onClick={logout} title="Log out">
          <LogOut size={20} aria-hidden="true" /><span>Logout</span>
        </button>
        <HeartWatermark size={210} />
        <div className="sidebar-foot">Powered by<br />NIJAAT AI</div>
      </nav>

      <div className="main">
        <header className="glass topbar no-print">
          <QuickSearch />
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            {qrStatus && <Link to="/app/qr" style={{ textDecoration: 'none' }} className="nowrap"><QrStatusChip status={qrStatus} /></Link>}
            <Notifications qrStatus={qrStatus} />
            <Link to="/app/settings" className="user-chip">
              <span className="avatar" aria-hidden="true">{initials(user.fullName)}</span>
              <span className="nowrap">
                <span style={{ display: 'block', fontWeight: 600, lineHeight: '18px' }}>{user.fullName}</span>
                <span className="caption">{user.emailVerified ? 'Verified user' : 'Email not verified'}</span>
              </span>
            </Link>
          </div>
        </header>
        <main id="main" className="content">
          {!online && (
            <div className="banner banner-caution" role="status" style={{ marginBottom: 16 }}>
              <AlertTriangle size={20} aria-hidden="true" />
              <div><strong>You are offline</strong><div>Changes cannot be saved until the connection returns.</div></div>
            </div>
          )}
          <Outlet />
        </main>
      </div>

      <nav className="glass-raised tabbar no-print" aria-label="Main">
        <Link to="/app" className={`tab${tabActive('/app') ? ' active' : ''}`}><LayoutDashboard size={22} aria-hidden="true" />Home</Link>
        <Link to="/app/profile" className={`tab${tabActive('/app/profile', '/app/contacts') ? ' active' : ''}`}><HeartPulse size={22} aria-hidden="true" />Profile</Link>
        <Link to="/app/qr" className="tab tab-qr" aria-current={tabActive('/app/qr') ? 'page' : undefined}><QrCode size={26} aria-hidden="true" />QR</Link>
        <Link to="/app/reports" className={`tab${tabActive('/app/reports', '/app/prescriptions') ? ' active' : ''}`}><FolderHeart size={22} aria-hidden="true" />Records</Link>
        <button className={`tab${more ? ' active' : ''}`} style={{ border: 0, background: 'none', font: 'inherit', fontSize: 12, fontWeight: 500, cursor: 'pointer' }} onClick={() => setMore((m) => !m)} aria-expanded={more}>
          {more ? <X size={22} aria-hidden="true" /> : <Menu size={22} aria-hidden="true" />}More
        </button>
      </nav>
      {more && (
        <div className="glass-raised no-print" style={{ position: 'fixed', left: 12, right: 12, bottom: 92, zIndex: 31, padding: 8 }}>
          {[['/app/contacts', 'Emergency Contacts', Users], ['/app/prescriptions', 'Prescription Scanner', Pill], ['/app/hospitals', 'Hospital Locator', MapPin], ['/app/activity', 'Activity', Activity], ['/app/settings', 'Settings', SettingsIcon]].map(([to, label, Icon]) => (
            <Link key={to} to={to} className="nav-item"><Icon size={20} aria-hidden="true" /><span>{label}</span></Link>
          ))}
          <button className="nav-item" style={{ border: 0, background: 'none', width: '100%', font: 'inherit', fontWeight: 500, cursor: 'pointer' }} onClick={logout}><LogOut size={20} aria-hidden="true" /><span>Log out</span></button>
        </div>
      )}
    </div>
  );
}
