import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { HttpError, wrap, parse, haversineM } from '../util.js';
import { publicLimiter } from '../middleware.js';

const router = Router();
router.use(publicLimiter);

/**
 * Two providers for FR-30 to FR-36:
 *   osm     OpenStreetMap through Overpass. No key, no billing, no credit card.
 *   google  Google Places and Routes. Better coverage and live traffic, but the project
 *           needs a billing account even to stay inside the free monthly allowance.
 * Google is used when a key is set, otherwise OpenStreetMap. MAPS_PROVIDER forces one.
 */
export const mapsProvider = () => config.mapsProvider || (config.googleMapsKey ? 'google' : 'osm');

// Tests stand in for the network here so both providers can be exercised for real.
let fetchOverride = null;
export const setMapsFetch = (fn) => { fetchOverride = fn; };

async function fetchJson(url, init = {}) {
  if (fetchOverride) return fetchOverride(url, init);
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(init.timeoutMs || 20_000) });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`${url.split('/')[2]} returned ${res.status} ${detail.slice(0, 120)}`);
  }
  return res.json();
}

/* ---------- OpenStreetMap ---------- */

function osmFacilityType(tags, name) {
  if (tags.emergency === 'yes' || /trauma|emergency|accident/i.test(name)) return 'trauma_center';
  if (tags.amenity === 'hospital' || tags.healthcare === 'hospital') return 'hospital';
  return 'clinic';
}

function fromOsm(element) {
  const tags = element.tags || {};
  const name = tags.name || tags['name:en'];
  const latitude = element.lat ?? element.center?.lat;
  const longitude = element.lon ?? element.center?.lon;
  if (!name || latitude == null || longitude == null) return null;
  return {
    id: `osm-${element.type}-${element.id}`,
    name,
    address: [tags['addr:housenumber'], tags['addr:street'], tags['addr:city']].filter(Boolean).join(', '),
    phone: tags.phone || tags['contact:phone'] || null,
    latitude,
    longitude,
    facilityType: osmFacilityType(tags, name),
  };
}

async function osmProvider(latitude, longitude, radius) {
  const query = `[out:json][timeout:25];nwr["amenity"~"^(hospital|clinic|doctors)$"](around:${radius},${latitude},${longitude});out center tags;`;
  const json = await fetchJson('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'NIJAAT-AI/1.0 (emergency medical locator)' },
    body: new URLSearchParams({ data: query }).toString(),
    timeoutMs: 30_000,
  });
  return (json.elements || []).map(fromOsm).filter(Boolean);
}

/* ---------- Google ---------- */

const FIELD_MASK = 'places.id,places.displayName,places.formattedAddress,places.location,places.nationalPhoneNumber,places.internationalPhoneNumber,places.types,places.primaryType';

const googleCall = (url, body, fieldMask) => fetchJson(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': config.googleMapsKey, 'X-Goog-FieldMask': fieldMask },
  body: JSON.stringify(body),
  timeoutMs: 12_000,
});

function googleFacilityType(place) {
  const name = (place.displayName?.text || '').toLowerCase();
  if (/trauma|emergency|accident/.test(name)) return 'trauma_center';
  if (/clinic|dispensary|polyclinic|medical cent/.test(name) && !/hospital/.test(name)) return 'clinic';
  if ((place.types || []).includes('hospital') || /hospital/.test(name)) return 'hospital';
  return 'clinic';
}

function fromGoogle(place) {
  if (!place?.location) return null;
  return {
    id: place.id,
    name: place.displayName?.text || 'Unnamed facility',
    address: place.formattedAddress || '',
    phone: place.internationalPhoneNumber || place.nationalPhoneNumber || null,
    latitude: place.location.latitude,
    longitude: place.location.longitude,
    facilityType: googleFacilityType(place),
  };
}

async function googleProvider(latitude, longitude, radius) {
  const circle = { center: { latitude, longitude }, radius };
  const [nearby, trauma, clinics] = await Promise.all([
    googleCall('https://places.googleapis.com/v1/places:searchNearby',
      { includedTypes: ['hospital'], maxResultCount: 20, rankPreference: 'DISTANCE', locationRestriction: { circle } }, FIELD_MASK),
    googleCall('https://places.googleapis.com/v1/places:searchText',
      { textQuery: 'trauma centre emergency hospital', pageSize: 10, locationBias: { circle } }, FIELD_MASK).catch(() => ({})),
    googleCall('https://places.googleapis.com/v1/places:searchText',
      { textQuery: 'medical clinic', pageSize: 15, locationBias: { circle } }, FIELD_MASK).catch(() => ({})),
  ]);
  return [...(nearby.places || []), ...(trauma.places || []), ...(clinics.places || [])].map(fromGoogle).filter(Boolean);
}

/* ---------- Travel time ---------- */

// Roads are not straight: about 1.4x the straight-line distance at roughly 30 km/h in city traffic.
const estimateMinutes = (distanceM) => Math.max(1, Math.round((distanceM * 1.4) / 1000 / 30 * 60));

/** Live traffic needs the Routes API. Without it, distance gives an honest estimate (FR-34). */
async function travelTimes(origin, places) {
  if (mapsProvider() !== 'google' || !places.length) {
    return places.map((p) => ({ minutes: estimateMinutes(p.distanceM), source: 'estimate' }));
  }
  try {
    const rows = await googleCall('https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix', {
      origins: [{ waypoint: { location: { latLng: origin } } }],
      destinations: places.map((p) => ({ waypoint: { location: { latLng: { latitude: p.latitude, longitude: p.longitude } } } })),
      travelMode: 'DRIVE', routingPreference: 'TRAFFIC_AWARE',
    }, 'originIndex,destinationIndex,duration,condition');
    const byIndex = new Map(rows.filter((r) => r.condition === 'ROUTE_EXISTS' && r.duration)
      .map((r) => [r.destinationIndex ?? 0, Math.max(1, Math.round(parseInt(r.duration, 10) / 60))]));
    return places.map((p, i) => (byIndex.has(i) ? { minutes: byIndex.get(i), source: 'traffic' } : { minutes: estimateMinutes(p.distanceM), source: 'estimate' }));
  } catch {
    return places.map((p) => ({ minutes: estimateMinutes(p.distanceM), source: 'estimate' }));
  }
}

/* ---------- Search ---------- */

// Overpass asks callers not to hammer it. Repeat searches from the same area reuse the answer.
const cache = new Map();
const CACHE_MS = 10 * 60_000;
const cacheKey = (lat, lng) => `${lat.toFixed(2)},${lng.toFixed(2)}`;

/** FR-31 to FR-34, PER-3, PER-4, SDD 6.3. */
export async function searchHospitals(latitude, longitude) {
  const key = cacheKey(latitude, longitude);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return { ...hit.value, cached: true };

  const query = mapsProvider() === 'google' ? googleProvider : osmProvider;
  let radius = config.hospitalRadiusM;
  let found = [];
  for (;;) {
    const raw = await query(latitude, longitude, radius);
    const seen = new Set();
    found = [];
    for (const place of raw) {
      if (seen.has(place.id)) continue;
      seen.add(place.id);
      const distanceM = Math.round(haversineM(latitude, longitude, place.latitude, place.longitude));
      if (distanceM > radius) continue;
      found.push({ ...place, distanceM });
    }
    if (found.length >= config.hospitalMinResults || radius >= config.hospitalMaxRadiusM) break;
    radius = Math.min(radius * 2, config.hospitalMaxRadiusM);
  }
  found.sort((a, b) => a.distanceM - b.distanceM);
  found = found.slice(0, 25);

  const times = await travelTimes({ latitude, longitude }, found);
  const results = found.map((p, i) => ({ ...p, travelTimeMinutes: times[i].minutes, travelTimeSource: times[i].source }));
  results.sort((a, b) => a.travelTimeMinutes - b.travelTimeMinutes || a.distanceM - b.distanceM);

  const value = {
    results,
    radiusKm: radius / 1000,
    expanded: radius > config.hospitalRadiusM,
    provider: mapsProvider(),
    attribution: mapsProvider() === 'osm' ? '© OpenStreetMap contributors' : null,
  };
  cache.set(key, { at: Date.now(), value });
  return value;
}

router.get('/', wrap(async (req, res) => {
  const q = parse(z.object({
    lat: z.coerce.number().min(-90).max(90),
    lng: z.coerce.number().min(-180).max(180),
  }), req.query);
  try {
    res.json({ ...(await searchHospitals(q.lat, q.lng)), origin: { latitude: q.lat, longitude: q.lng }, fetchedAt: new Date().toISOString() });
  } catch (err) {
    console.error('hospital search failed:', err.message);
    throw new HttpError(502, 'The map service could not be reached. Showing saved results if available.', { code: 'MAPS_UNAVAILABLE' });
  }
}));

export default router;
