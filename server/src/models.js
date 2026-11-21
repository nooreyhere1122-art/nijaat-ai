import mongoose from 'mongoose';

const { Schema, model } = mongoose;
const ObjectId = Schema.Types.ObjectId;

export const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

export const User = model('User', new Schema({
  fullName: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  phone: { type: String, required: true },
  passwordHash: { type: String, required: true },
  emailVerified: { type: Boolean, default: false },
  role: { type: String, enum: ['user', 'admin'], default: 'user' },
  verifyTokenHash: String,
  verifyExpires: Date,
  resetTokenHash: String,
  resetExpires: Date,
}, { timestamps: true }));

// The whole medical payload is stored encrypted in `data` (CO-5).
export const MedicalProfile = model('MedicalProfile', new Schema({
  userId: { type: ObjectId, ref: 'User', unique: true, required: true },
  data: { type: Buffer, required: true },
  version: { type: Number, default: 0 },
  complete: { type: Boolean, default: false },
}, { timestamps: true }));

export const ProfileVersion = model('ProfileVersion', new Schema({
  userId: { type: ObjectId, ref: 'User', index: true, required: true },
  version: Number,
  changedFields: [String],
  critical: Boolean,
  at: { type: Date, default: Date.now },
}));

export const QRCode = model('QRCode', new Schema({
  userId: { type: ObjectId, ref: 'User', index: true, required: true },
  tokenHash: { type: String, unique: true, required: true },
  tokenEnc: { type: Buffer, required: true },
  status: { type: String, enum: ['active', 'deactivated'], default: 'active' },
  downloadCount: { type: Number, default: 0 },
  scanCount: { type: Number, default: 0 },
  deactivatedAt: Date,
}, { timestamps: true }));

export const QRLog = model('QRLog', new Schema({
  userId: { type: ObjectId, ref: 'User', index: true, required: true },
  qrId: { type: ObjectId, ref: 'QRCode' },
  action: { type: String, required: true }, // generated | regenerated | deactivated | downloaded | data_refreshed
  detail: String,
  at: { type: Date, default: Date.now },
}));

export const ScanEvent = model('ScanEvent', new Schema({
  // A self-triggered alert has no QR code behind it, so qrId is optional.
  qrId: { type: ObjectId, ref: 'QRCode', index: true },
  source: { type: String, enum: ['scan', 'self'], default: 'scan' },
  userId: { type: ObjectId, ref: 'User', index: true, required: true },
  scannedAt: { type: Date, default: Date.now },
  latitude: Number,
  longitude: Number,
  ip: String,
  alertStatus: { type: String, enum: ['pending', 'cancelled', 'dispatching', 'dispatched'], default: 'pending' },
  dispatchAt: Date,
  viewToken: { type: String, index: true },
  physicianRequests: { type: Number, default: 0 },
}));

// One document per dispatch attempt (FR-28).
export const SMSAlert = model('SMSAlert', new Schema({
  userId: { type: ObjectId, ref: 'User', index: true, required: true },
  scanEventId: { type: ObjectId, ref: 'ScanEvent', index: true },
  kind: { type: String, enum: ['emergency', 'test', 'physician_code'], required: true },
  contactName: String,
  recipientNumber: { type: String, required: true },
  attempt: { type: Number, default: 1 },
  status: { type: String, enum: ['queued', 'sent', 'delivered', 'failed', 'unreachable'], default: 'queued' },
  errorCode: String,
  provider: String,
  providerSid: { type: String, index: true },
  at: { type: Date, default: Date.now },
}));

export const StoredFile = model('StoredFile', new Schema({
  userId: { type: ObjectId, ref: 'User', index: true, required: true },
  mime: String,
  size: Number,
  provider: { type: String, enum: ['mongo', 'blob'], default: 'mongo' },
  key: String, // object key, for providers that keep the bytes outside the database
  data: Buffer, // encrypted bytes, only when provider is 'mongo'
}, { timestamps: true }));

export const MedicalReport = model('MedicalReport', new Schema({
  userId: { type: ObjectId, ref: 'User', index: true, required: true },
  fileId: { type: ObjectId, ref: 'StoredFile', required: true },
  fileName: String,
  fileType: { type: String, enum: ['PDF', 'JPEG', 'PNG'] },
  status: { type: String, enum: ['uploaded', 'processing', 'summarized', 'failed'], default: 'uploaded' },
  error: String,
  uploadedAt: { type: Date, default: Date.now },
}));

export const MedicalSummary = model('MedicalSummary', new Schema({
  userId: { type: ObjectId, ref: 'User', index: true, required: true },
  reportId: { type: ObjectId, ref: 'MedicalReport', unique: true, required: true },
  data: { type: Buffer, required: true }, // encrypted { sections }
  edited: { type: Boolean, default: false },
}, { timestamps: true }));

export const Prescription = model('Prescription', new Schema({
  userId: { type: ObjectId, ref: 'User', index: true, required: true },
  fileId: { type: ObjectId, ref: 'StoredFile', required: true },
  data: { type: Buffer, required: true }, // encrypted { extractedText, medications }
  verified: { type: Boolean, default: false },
  refillDate: Date,
  uploadedAt: { type: Date, default: Date.now },
  verifiedAt: Date,
}));

export const PhysicianAccessCode = model('PhysicianAccessCode', new Schema({
  userId: { type: ObjectId, ref: 'User', index: true, required: true },
  scanEventId: { type: ObjectId, ref: 'ScanEvent', index: true, required: true },
  codeHash: { type: String, required: true },
  expiresAt: { type: Date, required: true },
  used: { type: Boolean, default: false },
  attempts: { type: Number, default: 0 },
  physician: { name: String, hospital: String, registrationNo: String },
}, { timestamps: true }));

export const PhysicianSession = model('PhysicianSession', new Schema({
  userId: { type: ObjectId, ref: 'User', index: true, required: true },
  scanEventId: { type: ObjectId, ref: 'ScanEvent' },
  physician: { name: String, hospital: String, registrationNo: String },
  lastActivity: { type: Date, default: Date.now },
  ended: { type: Boolean, default: false },
}, { timestamps: true }));

export const AuditLog = model('AuditLog', new Schema({
  userId: { type: ObjectId, ref: 'User', index: true }, // the record owner
  actorType: { type: String, enum: ['user', 'physician', 'bystander', 'system'], default: 'user' },
  actorLabel: String,
  action: { type: String, required: true },
  detail: String,
  timestamp: { type: Date, default: Date.now },
}));
