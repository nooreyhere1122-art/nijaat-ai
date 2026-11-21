import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Phone, Navigation, Share2, LocateFixed, ChevronDown, ChevronUp, ArrowLeft, Clock, Route } from 'lucide-react';
import { api, tokens, fmtDateTime } from '../api.js';
import { Banner, Spinner, useToast } from '../ui.jsx';

const MAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_KEY || '';
const CACHE_KEY = 'nijaat.hospitals';

// Facility categories never use the clinical urgency colours: shape, icon, brand tone and text label.
export const FACILITY = {
  trauma_center: { label: 'Trauma centre', short: 'Trauma', color: '#2E1F1A' },
  hospital: { label: 'General hospital', short: 'Hospital', color: '#7A5A48' },
  clinic: { label: 'Clinic', short: 'Clinic', color: '#5B4E8C' },
};

function pinSvg(type, size = 40) {
  const c = FACILITY[type].color;
  const stroke = 'stroke="#fff" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"';
  const shapes = {
    trauma_center: `<path d="M20 2 36 8v11c0 9-6.5 15.5-16 19C10.500 34.500 4 28 4 19V8z" fill="${c}" stroke="#fff" stroke-width="2"/><path d="M20 12v14M13 19h14" ${stroke}/>`,
    hospital: `<path d="M20 38C11 28 5 22 5 15a15 15 0 0 1 30 0c0 7-6 13-15 23z" fill="${c}" stroke="#fff" stroke-width="2"/><path d="M15 9v12M25 9v12M15 15h10" ${stroke}/>`,
    clinic: `<rect x="4" y="4" width="32" height="32" rx="9" fill="${c}" stroke="#fff" stroke-width="2"/><path d="M13 11v6a5 5 0 0 0 10 0v-6M18 22v2a5 5 0 0 0 10 0v-3" ${stroke}/><circle cx="28" cy="19" r="2" fill="#fff"/>`,
  };
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 40 40">${shapes[type]}</svg>`;
}
const pinUrl = (type, size) => `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(pinSvg(type, size))}`;
export const PinIcon = ({ type, size = 32 }) => <img className="pin-icon" src={pinUrl(type, size)} width={size} height={size} alt="" />;

let mapsPromise = null;
function loadGoogleMaps() {
  if (!MAPS_KEY) return Promise.reject(new Error('no key'));
  if (window.google?.maps) return Promise.resolve(window.google.maps);
  mapsPromise ||= new Promise((resolve, reject) => {
    window.__nijaatMapsReady = () => resolve(window.google.maps);
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(MAPS_KEY)}&v=weekly&callback=__nijaatMapsReady`;
    s.async = true;
    s.onerror = () => { mapsPromise = null; reject(new Error('Google Maps failed to load')); };
    document.head.appendChild(s);
  });
  return mapsPromise;
}

/** OpenStreetMap through Leaflet. No key, no billing. Used whenever there is no Google key. */
function OsmMap({ origin, results, selectedId, onSelect }) {
  const el = useRef(null);
  const map = useRef(null);
  const markers = useRef([]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      let L;
      try {
        await import('leaflet/dist/leaflet.css');
        L = (await import('leaflet')).default;
      } catch { if (alive) setFailed(true); return; }
      if (!alive || !el.current) return;

      if (!map.current) {
        map.current = L.map(el.current, { scrollWheelZoom: false }).setView([origin.latitude, origin.longitude], 13);
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19,
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        }).addTo(map.current);
      }
      markers.current.forEach((m) => m.remove());
      markers.current = [];

      const here = L.circleMarker([origin.latitude, origin.longitude], {
        radius: 8, color: '#2E1F1A', weight: 4, fillColor: '#FAF7F2', fillOpacity: 1,
      }).addTo(map.current).bindTooltip('Search location');
      markers.current.push(here);

      const points = [[origin.latitude, origin.longitude]];
      for (const r of results) {
        const selected = r.id === selectedId;
        const size = selected ? 50 : 40; // the selected pin grows by 25%
        const marker = L.marker([r.latitude, r.longitude], {
          icon: L.icon({ iconUrl: pinUrl(r.facilityType, size), iconSize: [size, size], iconAnchor: [size / 2, size], tooltipAnchor: [0, -size + 8] }),
          zIndexOffset: selected ? 1000 : 0,
          alt: `${FACILITY[r.facilityType].label}: ${r.name}`,
          keyboard: true,
          title: r.name,
        }).addTo(map.current);
        marker.bindTooltip(`${FACILITY[r.facilityType].short}: ${r.name}`, { permanent: false });
        marker.on('click', () => onSelect(r.id));
        markers.current.push(marker);
        points.push([r.latitude, r.longitude]);
      }
      if (points.length > 1) map.current.fitBounds(points, { padding: [40, 40] });
    })();
    return () => { alive = false; };
  }, [origin, results, selectedId, onSelect]);

  useEffect(() => () => { map.current?.remove(); map.current = null; }, []);

  if (failed) return <MapUnavailable reason="The map library could not be loaded." />;
  return <div ref={el} className="map" role="application" aria-label="Map of nearby medical facilities. The same facilities are in the list." />;
}

function MapUnavailable({ reason }) {
  return (
    <div className="map" style={{ display: 'grid', placeItems: 'center', padding: 24, textAlign: 'center' }}>
      <p>{reason} The list has every facility, with call and navigation buttons.</p>
    </div>
  );
}

function GoogleMap({ origin, results, selectedId, onSelect }) {
  const el = useRef(null);
  const map = useRef(null);
  const markers = useRef([]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    loadGoogleMaps().then((maps) => {
      if (!alive || !el.current) return;
      map.current ||= new maps.Map(el.current, {
        center: { lat: origin.latitude, lng: origin.longitude }, zoom: 13,
        mapTypeControl: false, streetViewControl: false, fullscreenControl: false,
      });
      markers.current.forEach((m) => m.setMap(null));
      markers.current = [];
      const bounds = new maps.LatLngBounds();
      const here = new maps.Marker({
        map: map.current, position: { lat: origin.latitude, lng: origin.longitude }, title: 'Search location', zIndex: 5,
        icon: { path: maps.SymbolPath.CIRCLE, scale: 8, fillColor: '#FAF7F2', fillOpacity: 1, strokeColor: '#2E1F1A', strokeWeight: 4 },
      });
      markers.current.push(here);
      bounds.extend(here.getPosition());
      results.forEach((r) => {
        const selected = r.id === selectedId;
        const size = selected ? 50 : 40;
        const m = new maps.Marker({
          map: map.current, position: { lat: r.latitude, lng: r.longitude }, title: `${FACILITY[r.facilityType].label}: ${r.name}`,
          zIndex: selected ? 10 : 1,
          icon: { url: pinUrl(r.facilityType, size), scaledSize: new maps.Size(size, size), labelOrigin: new maps.Point(size / 2, size + 9) },
          label: { text: FACILITY[r.facilityType].short, color: '#2E1F1A', fontSize: '12px', fontWeight: '600' },
        });
        m.addListener('click', () => onSelect(r.id));
        markers.current.push(m);
        bounds.extend(m.getPosition());
      });
      if (results.length) map.current.fitBounds(bounds, 48);
    }).catch(() => alive && setFailed(true));
    return () => { alive = false; };
  }, [origin, results, selectedId, onSelect]);

  if (failed) return <MapUnavailable reason="The map could not be loaded right now." />;
  return <div ref={el} className="map" role="application" aria-label="Map of nearby medical facilities. The same facilities are in the list." />;
}

const HospitalMap = MAPS_KEY ? GoogleMap : OsmMap;

function FacilityCard({ f, open, onToggle }) {
  const toast = useToast();
  const meta = FACILITY[f.facilityType];
  const navUrl = `https://www.google.com/maps/dir/?api=1&destination=${f.latitude},${f.longitude}&travelmode=driving`;
  const share = async () => {
    const text = `Route to ${f.name} (${meta.label})`;
    try {
      if (navigator.share) await navigator.share({ title: f.name, text, url: navUrl });
      else { await navigator.clipboard.writeText(`${text}: ${navUrl}`); toast('Route link copied'); }
    } catch { /* share sheet dismissed */ }
  };
  return (
    <div className={`facility${open ? ' selected' : ''}`} id={`facility-${f.id}`}>
      <button onClick={onToggle} aria-expanded={open}>
        <PinIcon type={f.facilityType} />
        <span className="grow">
          <strong style={{ display: 'block' }}>{f.name}</strong>
          <span className="row small" style={{ gap: 8, marginTop: 2 }}>
            <span className="tag tag-neutral">{meta.label}</span>
            <span className="nowrap"><Clock size={14} aria-hidden="true" style={{ verticalAlign: -2 }} /> {f.travelTimeMinutes} min</span>
            <span className="nowrap"><Route size={14} aria-hidden="true" style={{ verticalAlign: -2 }} /> {(f.distanceM / 1000).toFixed(1)} km</span>
          </span>
        </span>
        {open ? <ChevronUp size={20} aria-hidden="true" /> : <ChevronDown size={20} aria-hidden="true" />}
      </button>
      {open && (
        <div className="detail">
          <div className="small">{f.address || 'Address not available'}</div>
          {f.travelTimeSource === 'estimate' && <div className="caption">Travel time is an estimate from distance; live traffic was not available.</div>}
          <div className="row">
            <a className="btn btn-primary grow" href={navUrl} target="_blank" rel="noreferrer"><Navigation size={20} aria-hidden="true" />Navigate</a>
            {f.phone
              ? <a className="btn btn-secondary grow" href={`tel:${f.phone.replace(/\s/g, '')}`}><Phone size={20} aria-hidden="true" />Call {f.phone}</a>
              : <span className="small muted grow">No phone number listed</span>}
            <button className="btn btn-secondary" onClick={share}><Share2 size={20} aria-hidden="true" />Share route</button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- P-05 and P-06 (FR-30 to FR-36) ---------- */
export default function HospitalsPage({ standalone = false }) {
  const [params] = useSearchParams();
  const fromScan = params.get('from') === 'scan';
  const paramOrigin = useMemo(() => {
    const lat = Number(params.get('lat')); const lng = Number(params.get('lng'));
    return params.get('lat') && Number.isFinite(lat) && Number.isFinite(lng) ? { latitude: lat, longitude: lng } : null;
  }, [params]);

  const [origin, setOrigin] = useState(paramOrigin);
  const [state, setState] = useState(paramOrigin ? 'loading' : 'consent'); // consent | locating | loading | ready | error
  const [data, setData] = useState(null);
  const [notice, setNotice] = useState(null);
  const [selected, setSelected] = useState(null);

  const cached = useMemo(() => { try { return JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'); } catch { return null; } }, []);

  const search = useCallback(async (o) => {
    setOrigin(o); setState('loading'); setNotice(null);
    try {
      const r = await api.get(`/hospitals?lat=${o.latitude}&lng=${o.longitude}`, { token: null });
      localStorage.setItem(CACHE_KEY, JSON.stringify(r)); // FR-36
      setData(r); setState('ready'); setSelected(r.results[0]?.id || null);
    } catch (err) {
      if (cached?.results?.length) {
        setData(cached); setOrigin(cached.origin); setState('ready');
        setNotice({ kind: 'caution', title: 'Showing saved results', text: `${err.message} These results were saved on ${fmtDateTime(cached.fetchedAt)} and may be for a different location.` });
      } else { setNotice({ kind: 'critical', title: 'Hospitals could not be loaded', text: err.message }); setState('error'); }
    }
  }, [cached]);

  useEffect(() => { document.title = 'Nearby hospitals · NIJAAT AI'; if (paramOrigin) search(paramOrigin); /* eslint-disable-next-line */ }, []);

  const locate = () => {
    setState('locating');
    const fallback = () => {
      const scanLoc = tokens.scan?.location; // UC-7 E2: use the QR scan location when consent is denied
      if (scanLoc) { setNotice({ kind: 'info', title: 'Using the QR scan location', text: 'Your device location was not shared.' }); search(scanLoc); }
      else if (cached?.results?.length) { setData(cached); setOrigin(cached.origin); setState('ready'); setNotice({ kind: 'caution', title: 'Showing saved results', text: `Location was not shared. These results were saved on ${fmtDateTime(cached.fetchedAt)}.` }); }
      else { setState('consent'); setNotice({ kind: 'critical', title: 'Location is needed', text: 'Allow location access in your browser to find hospitals near you.' }); }
    };
    if (!navigator.geolocation) return fallback();
    navigator.geolocation.getCurrentPosition(
      (pos) => search({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
      fallback, { enableHighAccuracy: true, timeout: 15000 },
    );
    return undefined;
  };

  const select = useCallback((id) => {
    setSelected(id);
    document.getElementById(`facility-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, []);

  const body = (
    <div className="stack">
      {notice && <Banner kind={notice.kind} title={notice.title}>{notice.text}</Banner>}
      {state === 'consent' && (
        <div className={standalone ? 'e-card stack' : 'glass panel stack'}>
          <h2>Find hospitals near you</h2>
          <p>Your location is used once to search within 10 kilometres. It is not stored.</p>
          <button className="btn btn-primary btn-xl" onClick={locate}><LocateFixed size={22} aria-hidden="true" />Use my location</button>
        </div>
      )}
      {state === 'locating' && <Spinner label="Getting your location" />}
      {state === 'loading' && <Spinner label="Searching for hospitals, clinics and trauma centres" />}
      {state === 'error' && origin && <button className="btn btn-primary" onClick={() => search(origin)}>Try again</button>}
      {state === 'ready' && data && (
        <>
          {data.expanded && <Banner kind="info" title={`Search widened to ${data.radiusKm} km`}>Fewer than three facilities were found within 10 km.</Banner>}
          <div className="legend" aria-label="Map legend">
            {Object.entries(FACILITY).map(([type, m]) => <span key={type}><PinIcon type={type} size={24} />{m.label}</span>)}
          </div>
          {data.attribution && <p className="caption">Facility data {data.attribution}. Travel times are estimated from distance, not live traffic.</p>}
          {data.results.length === 0 ? (
            <div className="empty">No medical facility was found within {data.radiusKm} km. Call Rescue 1122.</div>
          ) : (
            <div className="map-layout">
              <div className="results" aria-label="Facilities sorted by travel time">
                <div className="small muted">{data.results.length} facilities, fastest to reach first</div>
                {data.results.map((f) => <FacilityCard key={f.id} f={f} open={selected === f.id} onToggle={() => setSelected(selected === f.id ? null : f.id)} />)}
              </div>
              <HospitalMap origin={data.origin || origin} results={data.results} selectedId={selected} onSelect={select} />
            </div>
          )}
        </>
      )}
    </div>
  );

  if (!standalone) return <div><div className="page-head"><div><h1>Hospitals</h1><p className="muted">Hospitals, clinics and trauma centres near you, sorted by travel time.</p></div></div>{body}</div>;
  return (
    <div className="emergency">
      <div className="emergency-bar"><Navigation size={20} aria-hidden="true" />Nearest hospitals</div>
      <main id="main" style={{ maxWidth: 1100, margin: '0 auto', padding: 16 }} className="stack">
        <div>
          {fromScan && tokens.scan?.token
            ? <Link className="btn btn-secondary btn-sm" to={`/e/${tokens.scan.token}`}><ArrowLeft size={18} aria-hidden="true" />Back to emergency profile</Link>
            : <Link className="btn btn-secondary btn-sm" to="/"><ArrowLeft size={18} aria-hidden="true" />Back</Link>}
        </div>
        {body}
      </main>
    </div>
  );
}
