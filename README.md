# NIJAAT AI

Emergency medical identity for Pakistan. A printed QR code on a helmet, vehicle or phone opens
the owner's blood group and allergies for any bystander, with no app and no login, and alerts the
family by SMS with the scan location. A physician can open the full record with a one-time code.

Built to the approved SRS and to Design Architecture v1.1.

## What is in here

| Folder | What it is | Port |
| --- | --- | --- |
| `server` | REST API: auth, profile, QR, scan and alerts, reports, prescriptions, hospitals, physician access | 4000 |
| `ocr-service` | Prescription OCR with image preprocessing, kept separate so heavy work never blocks a scan | 4100 |
| `client` | React progressive web app: public emergency screens, clinical screens, account area | 5173 |

## Running it

Needs Node 20 or newer and a MongoDB database.

```bash
# 1. API
cd server && npm install
npm run setup                 # writes .env: generates the secrets, asks you for any keys
npm run check                 # tells you which of them actually work
npm start

# 2. OCR service
cd ocr-service && npm install && npm start

# 3. Web app
cd client && npm install && npm run dev
```

Open http://localhost:5173.

New here? **[SETUP.md](SETUP.md)** walks through running it with no API keys at all, and says what each key buys you.

To put it on a server, see **[DEPLOY.md](DEPLOY.md)**. The short version: `deploy/` holds a Docker
setup that runs the database, the API, the OCR service and automatic HTTPS with one command.

Without Twilio and SMTP the API runs in development mode: emails and SMS are written to the
server log instead of being sent, and the verification link and physician code are shown on
screen so every flow can be completed end to end. Never run that way in production.

### Settings

| Variable | Needed for | Without it |
| --- | --- | --- |
| `MONGODB_URI` | Everything | Defaults to `mongodb://127.0.0.1:27017/nijaat_ai` |
| `BLOB_READ_WRITE_TOKEN` | Keeping uploads out of the database | Uploads are stored in MongoDB instead |
| `JWT_SECRET`, `SCAN_SECRET`, `ENCRYPTION_KEY` | Sessions and encryption at rest | Development defaults are used; the API refuses to start in production without them |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` | Family alerts, physician codes, test SMS | Messages are logged, not sent |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | Email verification and password reset | Links are logged and shown on screen |
| `GEMINI_API_KEY` | Report summarisation | Uploads are kept and marked "failed" with a retry button |
| `GOOGLE_MAPS_SERVER_KEY` | Google place data and live traffic | Hospital search uses OpenStreetMap, which needs no key |
| `VITE_GOOGLE_MAPS_KEY` (client) | A Google map | The map is drawn with Leaflet and OpenStreetMap tiles |
| `API_URL` | Twilio delivery receipts | Statuses stay at "sent" instead of "delivered" |

Generate the three secrets with `openssl rand -base64 32` each.

## Checking the services

```bash
cd server && npm run check
```

Reports which of MongoDB, the OCR service, hospital search, summaries, email, SMS and file
storage are working, which are not set up, and which are configured but broken. It sends no SMS
and no email.

## Tests

```bash
cd server && MONGODB_URI=mongodb://127.0.0.1:27017/nijaat_test npm test   # 10 API tests
cd ocr-service && npm test                                               # 3 OCR tests
```

The API tests cover every module end to end against a real database: registration and
verification, profile versioning, QR lifecycle, scan and the 30-second cancel buffer, SMS retry
and per-attempt logging, physician code and session expiry, report summarising and editing,
prescription parsing, and hospital search with its widening radius.

## How the main flows work

**Scan.** The printed code carries a permanent random identifier; only its hash is stored, so the
sticker keeps working until the owner deactivates or replaces it. A scan creates a scan event and
returns a time-limited session token that every later public request must carry. A reload within
ten minutes reuses the same scan event, so one accident never sends two alerts.

**Family alert.** The SMS is held for 30 seconds so a bystander who scanned by mistake can cancel.
After that each contact is tried in priority order, up to three attempts at growing intervals, and
every attempt is stored as its own record. The bystander sees per-contact delivery status.

**Physician access.** The one-time code is never shown on the public profile. The physician enters
their name, hospital and registration number; the code is then sent by SMS to the patient's
emergency contacts, who read it out. The code works once, expires in ten minutes, and the session
closes after five minutes without activity. Every request, refusal, grant and record view is
written to the owner's access history.

**Privacy.** Medical data, uploaded files and prescriptions are encrypted at rest with AES-256-GCM.
A bystander only ever receives name, blood group, allergies and contact numbers; conditions,
medications, surgeries, address and reports stay in the account.

**Self-triggered alert.** The dashboard's Emergency Alert panel sends the same alert a scan sends,
to the same contacts, through the same 30-second cancel window and the same retry and logging
rules. It is the one feature here that the SRS does not describe, so it needs supervisor approval
and a new requirement in Module 5. It does not count as a scan: FR-13's counter ignores it.

## Known gaps

- Three items need supervisor approval. Two are implemented as Design Architecture v1.1
  recommended: the physician code goes to the contacts, and the printed identifier is permanent
  with the time limit moved to the scan session. The third is the self-triggered alert above.
  All three need the SRS updating to match.
- The in-app refill reminder is shown on the dashboard only; no push or SMS reminder is sent.
- No admin area. FR-06 role control exists in the data model and middleware but has no screens.
