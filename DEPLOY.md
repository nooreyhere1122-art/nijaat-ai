# Deploying NIJAAT AI

## Three decisions before you deploy anything

**1. The domain is permanent.** A printed QR sticker encodes `https://your-domain/e/<code>`.
Once someone has that sticker on their helmet, the domain can never change: every printed code
in the world would stop working. Pick the final domain before you print even one sticker.

**2. HTTPS is not optional.** Browsers only open the camera on a secure origin. Without HTTPS the
QR scanner and the prescription camera simply do not work on a phone. The Docker setup below gets
and renews the certificate on its own.

**3. Nothing may sleep.** Free tiers on Render, Railway and similar hosts put the service to sleep
after idle time, and the first request then waits 30 to 60 seconds. For an ordinary web app that
is annoying. Here, the first request is a bystander standing over an injured person. Use a host
that stays awake, or pay for the tier that does.

## Option A: one small server (recommended)

Everything on one box: database, API, OCR service, HTTPS. No cold starts, no per-service billing,
and the OCR service gets the memory it needs.

A 2 vCPU / 4 GB server is enough — on Hetzner that is about €5–6 a month, though they raised
prices twice during 2026, so check the current figure. Any provider works; the steps are the same.

```bash
# On the server (Ubuntu 24.04), as root or with sudo
curl -fsSL https://get.docker.com | sh
curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt install -y nodejs

ufw allow 22 && ufw allow 80 && ufw allow 443 && ufw enable

# Get the code onto the server (git clone, or scp the zip and unzip it)
cd nijaat-ai

# Build the web app. The map key is read at build time, so set it first.
cd client && cp .env.example .env && nano .env     # fill VITE_GOOGLE_MAPS_KEY
npm ci && npm run build && cd ..

# Secrets and settings
cd deploy && cp .env.example .env
openssl rand -base64 32    # run three times, one value each for
                           # JWT_SECRET, SCAN_SECRET, ENCRYPTION_KEY
nano .env                  # fill SITE_DOMAIN and the API keys
```

Point an **A record** for your domain at the server's IP address and wait for it to resolve.
Caddy asks Let's Encrypt for the certificate on first start and that only works once DNS is live.

```bash
docker compose up -d --build
docker compose logs -f api        # watch it come up
curl https://your-domain/api/health
```

That is the whole deployment. MongoDB and the OCR service have no published ports: only the other
containers can reach them. The OCR service in particular accepts uploads without authentication,
so it must never be exposed to the internet.

### Updating

```bash
git pull
cd client && npm ci && npm run build && cd ../deploy
docker compose up -d --build
```

### Backups

Medical data, so take them from day one:

```bash
docker compose exec -T mongo mongodump --archive --gzip --db nijaat_ai > nijaat-$(date +%F).gz
```

Put it in cron and copy the file off the server. **Back up `ENCRYPTION_KEY` separately.** Every
medical profile, report and prescription is encrypted with it. A database backup without that key
is unreadable, by you and by everyone else.

## Option B: Vercel + Render + MongoDB Atlas + Blob

| Piece | Where | Notes |
| --- | --- | --- |
| Web app | Vercel | Good fit. Root `client`, build `npm run build`, output `dist`. Set `VITE_API_URL=https://your-api-host/api` and `VITE_GOOGLE_MAPS_KEY` as build-time variables. Put your domain here, because this is what the QR codes point at |
| API | Render web service | Root `server`, build `npm ci`, start `npm start`. **Not the free tier**: it sleeps. Set `CLIENT_URL` to the Vercel domain or CORS blocks every request |
| OCR service | Render web service | Root `ocr-service`. Needs real memory: `sharp` plus the Tesseract worker will struggle under 512 MB. Keep it private and point `OCR_SERVICE_URL` at its internal address |
| Database | MongoDB Atlas | The free M0 tier is 512 MB, which is plenty for records but not for files — see below |
| Uploaded files | Vercel Blob, private store | Set `BLOB_READ_WRITE_TOKEN` on the API. Reports and prescription photos then live in the object store and only their key is in the database |

### Why uploads should not sit in a small managed database

A report can be 10 MB. Fifty of them fill an Atlas M0 on their own, and then nothing else can be
written either. Set `BLOB_READ_WRITE_TOKEN` and the files move out; the database then holds only
records, which stay tiny.

Create the store as **private**, not public. The files are encrypted before they are uploaded, so
even a leaked URL would only expose ciphertext, but a private store means there is no public URL
to leak in the first place. Vercel Blob's Hobby allowance is about 1 GB of storage. Cloudflare R2
gives 10 GB free with no egress charge and speaks the S3 API, so it is the better choice if you
expect real volume; the storage layer is one file (`server/src/services/storage.js`) with a `put`,
`get` and `delete`, so adding an S3 provider there is a small job.

### Why not Turso

Turso is SQLite. This codebase is MongoDB through and through: 13 Mongoose models, documents with
nested arrays (a profile holds its allergies, medications and contacts inside one encrypted
document), and ObjectIds as keys everywhere. Moving to Turso means rewriting every model and every
query as SQL, re-testing all of it, and updating the data dictionary in your approved SDD.

The thing to weigh is what that buys you. Atlas M0 is free and already matches the SDD, and once
the files move to object storage, 512 MB holds a very large number of patient records. Turso's
advantages — edge replicas, zero cold starts — do not apply to a single API server. If the reason
for Turso is that the database is filling up, the fix is moving the files out, not changing the
database.

The split hosting costs more than one small server once you leave the free tiers, and the OCR
service is the piece most likely to give you trouble. If you want the simplest thing that works,
use Option A.

## For the FYP demo

You need HTTPS for the phone camera to work in front of the examiners, even on your laptop:

```bash
# terminal 1
cd server && npm start
# terminal 2
cd ocr-service && npm start
# terminal 3
cd client && npm run dev
# terminal 4 — instant public HTTPS URL
cloudflared tunnel --url http://localhost:5173
```

Set `CLIENT_URL` on the API to the tunnel URL before you generate the QR code, otherwise the
printed code points at `localhost` and nothing will scan. The tunnel URL changes every run, so
regenerate the QR code each time. For the real deployment this is exactly why the domain matters.

## Keys, and what breaks without each

| Key | Without it |
| --- | --- |
| `TWILIO_*` | No SMS reaches anyone. Alerts are only written to the server log |
| `SMTP_*` | No verification or password-reset email is sent |
| `GEMINI_API_KEY` | Reports upload and are stored, but every summary fails |
| `GOOGLE_MAPS_SERVER_KEY` | Hospital search returns "not configured". Enable **Places API (New)** and **Routes API**, and restrict the key to the server's IP |
| `VITE_GOOGLE_MAPS_KEY` | The facility list still works, but there is no map. Restrict it to your domain |
| `API_URL` | Twilio delivery receipts are rejected, so statuses stay at "sent" instead of "delivered" |

## SMS in Pakistan: test this before you build a demo around it

This is the part that can break the whole product, and it is worth proving early.

Twilio's own country guidelines say two-way SMS is not supported in Pakistan, and that
alphanumeric sender IDs are not supported by every operator: the sender ID may be replaced with a
short code or a generic ID to get the message delivered. Several providers report that sender ID
behaviour differs across Jazz, Zong, Telenor and Ufone. The PTA regulates A2P messaging, and
registering a sender ID with the carriers is a separate process with its own paperwork.

For NIJAAT AI none of that changes the message content, which is what matters. What matters is
**delivery**: send a real test message to a number on each of the four networks before you rely on
it. If delivery is unreliable, a local gateway with a registered short code is the alternative to
investigate. `POST /api/profile/test-sms` exists for exactly this test, and the Emergency Contacts
page has a button for it.

## Security checklist before real users

- [ ] `NODE_ENV=production` set, and the three secrets filled in (the API refuses to start otherwise)
- [ ] `ENCRYPTION_KEY` backed up somewhere other than the server
- [ ] MongoDB and the OCR service have no published ports
- [ ] Automated database backups running and restored once, to prove they work
- [ ] `AUTH_RATE_LIMIT` raised if your users share IP addresses through carrier NAT
- [ ] Google Maps keys restricted, by IP for the server key and by domain for the browser key
