import { z } from 'zod';
import { MedicalProfile, ProfileVersion, QRCode, QRLog, BLOOD_GROUPS } from '../models.js';
import { seal, open } from './crypto.js';
import { normalizePhone } from '../util.js';

const text = (max = 200) => z.string().trim().max(max);
const optionalText = (max = 500) => text(max).optional().default('');
const optionalDate = z.string().trim().regex(/^(\d{4}(-\d{2}(-\d{2})?)?)?$/, 'Use the format YYYY, YYYY-MM or YYYY-MM-DD').optional().default('');

const phone = z.string().transform((value, ctx) => {
  const normalized = normalizePhone(value);
  if (!normalized) {
    ctx.addIssue({ code: 'custom', message: 'Enter a phone number with country code, for example +923001234567' });
    return z.NEVER;
  }
  return normalized;
});

export const profileSchema = z.object({
  personal: z.object({
    dateOfBirth: z.string().trim().regex(/^(\d{4}-\d{2}-\d{2})?$/, 'Use the format YYYY-MM-DD').optional().default(''),
    gender: z.enum(['', 'male', 'female', 'other']).optional().default(''),
    city: optionalText(100),
    address: optionalText(300),
  }).default({}),
  bloodGroup: z.enum(['', ...BLOOD_GROUPS]).default(''),
  allergies: z.array(z.object({
    name: text().min(1, 'Allergy name is required'),
    severity: z.enum(['mild', 'moderate', 'severe']),
    reaction: optionalText(),
  })).max(50).default([]),
  chronicConditions: z.array(z.object({
    name: text().min(1, 'Condition name is required'),
    since: optionalDate,
    notes: optionalText(),
  })).max(50).default([]),
  medications: z.array(z.object({
    name: text().min(1, 'Medication name is required'),
    dosage: optionalText(100),
    frequency: optionalText(100),
    duration: optionalText(100),
    active: z.boolean().default(true),
    source: z.enum(['manual', 'prescription']).default('manual'),
    prescriptionId: z.string().optional(),
    addedAt: z.string().optional(),
  })).max(100).default([]),
  surgeries: z.array(z.object({
    name: text().min(1, 'Surgery name is required'),
    date: optionalDate,
    notes: optionalText(),
  })).max(50).default([]),
  implants: z.array(z.object({
    name: text().min(1, 'Implant name is required'),
    date: optionalDate,
    notes: optionalText(),
  })).max(50).default([]),
  emergencyContacts: z.array(z.object({
    name: text().min(1, 'Contact name is required'),
    relationship: text(60).min(1, 'Relationship is required'),
    phone,
  })).max(5, 'You can add up to five emergency contacts').default([]),
});

export const emptyProfile = () => profileSchema.parse({});

// A change to any of these makes the emergency view different (FR-09).
const CRITICAL_FIELDS = ['allergies', 'emergencyContacts', 'bloodGroup'];

export function missingFields(data) {
  const missing = [];
  if (!data.bloodGroup) missing.push('Blood group');
  if (!data.personal?.dateOfBirth) missing.push('Date of birth');
  if (!data.emergencyContacts?.length) missing.push('At least one emergency contact');
  return missing;
}

export async function loadProfile(userId) {
  const doc = await MedicalProfile.findOne({ userId });
  if (!doc) return { doc: null, data: emptyProfile(), version: 0 };
  return { doc, data: { ...emptyProfile(), ...open(doc.data) }, version: doc.version };
}

/** Saves the profile, records a version entry (FR-07) and reports whether critical data changed (FR-09). */
export async function saveProfile(userId, nextData) {
  const { doc, data: previous } = await loadProfile(userId);
  const changedFields = Object.keys(nextData).filter(
    (key) => JSON.stringify(nextData[key]) !== JSON.stringify(previous[key]),
  );
  const complete = missingFields(nextData).length === 0;
  if (doc && changedFields.length === 0) {
    return { data: previous, version: doc.version, changedFields, critical: false, complete: doc.complete };
  }
  const version = (doc?.version || 0) + 1;
  const critical = changedFields.some((f) => CRITICAL_FIELDS.includes(f));
  await MedicalProfile.findOneAndUpdate(
    { userId },
    { userId, data: seal(nextData), version, complete },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  await ProfileVersion.create({ userId, version, changedFields, critical });
  if (critical) {
    const qr = await QRCode.findOne({ userId, status: 'active' });
    if (qr) {
      await QRLog.create({
        userId, qrId: qr._id, action: 'data_refreshed',
        detail: `Emergency data updated (${changedFields.filter((f) => CRITICAL_FIELDS.includes(f)).join(', ')}). The printed code now shows the new data.`,
      });
    }
  }
  return { data: nextData, version, changedFields, critical, complete };
}

const severityRank = { severe: 0, moderate: 1, mild: 2 };

/** BR-04: only emergency-relevant fields leave the server for a bystander. */
export function emergencyView(user, data) {
  return {
    name: user.fullName,
    bloodGroup: data.bloodGroup || null,
    allergies: [...data.allergies]
      .sort((a, b) => severityRank[a.severity] - severityRank[b.severity])
      .map(({ name, severity, reaction }) => ({ name, severity, reaction })),
    contacts: data.emergencyContacts.map(({ name, relationship, phone: number }) => ({ name, relationship, phone: number })),
  };
}
