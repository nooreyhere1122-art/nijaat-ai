# Keys and how to run it

## The short version

**You can run the whole product today with no credit card and no API keys at all.** Start it, and
every feature works except the two that physically need an outside service to deliver something:
SMS and email. Those get written to the server log instead, with the links and codes you need to
finish each flow on screen.

So do this first, then add keys one at a time.

## Filling `.env`: let the script do it

```bash
cd server && npm run setup
```

It writes `server/.env` and:

- **Generates `JWT_SECRET`, `SCAN_SECRET` and `ENCRYPTION_KEY` itself** with 32 random bytes each
  from the operating system's CSPRNG. You never have to think about these, and they never have to
  be sent to anyone.
- **Asks you for the rest in your own terminal.** Paste a key at the prompt and it goes straight
  into the file on your machine. Nothing is printed back on screen and nothing is sent anywhere.
- Press Enter to skip anything you do not have. Run it again later and the values already in the
  file are kept, so you are only asked for the empty ones.
- Writes the file with permissions `600`, so only your user account can read it, and `.env` is
  already in `.gitignore`.

Give it a Resend key and it fills the whole SMTP block for you (`smtp.resend.com`, port 465, user
`resend`).

**Two rules about these values, and they matter more than anything else in this file.**

1. **Never paste a key or secret into a chat window, an issue, a WhatsApp message or a
   screenshot.** Anything typed into a conversation stays in that conversation and is out of your
   control from then on. Keys belong in `.env` on the machine that runs the server, nowhere else.
   If a key does end up somewhere it should not, treat it as burned and rotate it: every provider
   here lets you delete a key and issue a new one in a few clicks.
2. **Back up `ENCRYPTION_KEY` separately from the server.** It encrypts every medical profile,
   report and prescription in the database. Lose it and that data cannot be read again, by you or
   by anyone — a database backup without the key is so much noise. Keep a copy somewhere that is
   not the same disk as the database.

Then check what actually works:

```bash
npm run check
```

## Running it, step by step

Needs Node 20 or newer and MongoDB. For MongoDB either install it locally, or take a free
MongoDB Atlas M0 cluster (no card) and use its connection string.

Open three terminals.

```bash
# 1. API
cd server
npm install
cp .env.example .env          # leave it all empty for now, it runs on defaults
npm start                     # http://localhost:4000
```

```bash
# 2. OCR service, for reading prescriptions
cd ocr-service
npm install
npm start                     # http://localhost:4100
```

```bash
# 3. Web app
cd client
npm install
npm run dev                   # http://localhost:5173
```

Open http://localhost:5173 and check the API is happy at http://localhost:4000/api/health.

### Walking through it with no keys

1. **Register.** No email is sent; the screen shows a "Development mode" box with the
   verification link. Click it.
2. **Log in**, fill the medical profile, add an emergency contact, generate the QR code.
3. **Scan it.** On a laptop, just open the QR code's URL in a private window. On a phone you need
   HTTPS for the camera — see the tunnel trick below.
4. **Watch the alert.** The 30-second countdown runs, and the SMS text appears in the API terminal
   instead of being sent. Cancel it or let it go.
5. **Physician View.** The one-time code normally goes to the contacts by SMS. With no SMS
   configured, the screen shows it so you can continue.
6. **Prescriptions** work fully: the OCR service runs locally and needs no key.
7. **Hospitals** work fully: OpenStreetMap needs no key.
8. **Reports** upload and store, but the summary fails until you add a Gemini key.

### Camera on a phone

The QR scanner and the prescription camera only open on HTTPS. For a demo:

```bash
cloudflared tunnel --url http://localhost:5173
```

Set `CLIENT_URL` in `server/.env` to the tunnel URL **before** you generate the QR code, otherwise
the code points at `localhost` and will not scan.

## Checking your keys

Whenever you add a key, ask the app whether it actually works:

```bash
cd server && npm run check
```

It reports every service as OK, OFF (not set up, and the app runs without it) or FAIL
(configured but not working, with the reason). **It never sends an SMS or an email**: credentials
are verified by reading from each service, not by delivering anything. The only call that costs
anything is the Google Maps one, and only if you set a Google key: one call against the free
monthly allowance.

It also tells you things worth knowing, such as whether your Twilio account is still a trial,
which means it can only reach numbers you have verified.

## Every key, what it costs, and the free way out

| Key | For | Card needed? | Free alternative |
| --- | --- | --- | --- |
| `JWT_SECRET`, `SCAN_SECRET`, `ENCRYPTION_KEY` | Sessions, scan links, encryption | No | **`npm run setup` generates all three.** Nothing to obtain |
| `MONGODB_URI` | Everything | No | Local MongoDB, or Atlas M0 free |
| `GOOGLE_MAPS_SERVER_KEY` | Hospital search | **Yes** | **Already built in: OpenStreetMap.** Leave the key empty |
| `VITE_GOOGLE_MAPS_KEY` | The map itself | **Yes** | **Already built in: Leaflet + OSM tiles.** Leave it empty |
| `GEMINI_API_KEY` | Report summaries | No | Free tier in Google AI Studio |
| `SMTP_*` | Verification and reset email | No | Resend free tier (needs a verified domain to reach anyone but you), or a Gmail App Password |
| `TWILIO_*` | SMS alerts | **Yes, for real sending** | Trial credit reaches numbers you verify first |
| `BLOB_READ_WRITE_TOKEN` | Keeping uploads out of the database | No | Leave empty: files go in MongoDB |

### Maps: nothing to do

Google changed its pricing on 1 March 2025. The old $200 monthly credit is gone, replaced by a
free allowance on each SKU — about 10,000 calls a month on Essentials, 5,000 on Pro — and
**billing has to be enabled on the project before any call works at all**, even inside the free
allowance. The place-search this app does bills under a Pro SKU, so it is one of the more
expensive ones once you pass the allowance.

For a student project that means handing a card to Google for something you may only demo a few
hundred times. So the app ships with OpenStreetMap instead, and uses it whenever
`GOOGLE_MAPS_SERVER_KEY` is empty:

- **Facility search** comes from Overpass, the OpenStreetMap query service. No key, no account.
- **The map** is Leaflet with OpenStreetMap tiles. No key, no account.
- **Travel time** is estimated from distance, and the screen says so, because live traffic is the
  one thing only a paid routing service gives you.

What you give up: OSM coverage of small clinics in Pakistan is thinner than Google's, and there
are no live traffic times. Check your own city before the demo — run the app, open Hospitals, and
see what comes back. If the coverage is poor where you are demoing, that is the moment to decide
whether Google is worth the card. Switching later is one environment variable; set
`MAPS_PROVIDER=osm` or `google` to force either.

Both services ask for credit when you use their data. The app prints
"Facility data © OpenStreetMap contributors" under the results, and the map tiles carry their own
attribution. Leave both in place.

### Gemini: free, with one caveat you should know about

Create a key at [Google AI Studio](https://aistudio.google.com/apikey). The free tier needs no
billing account, and limits are measured per minute and per day, per Google Cloud project; Google
stopped publishing the per-model numbers and now shows your live quota in AI Studio itself.

**The caveat matters for a medical product.** Google's pricing page says free-tier requests may be
used to improve Google's products. This app sends the uploaded medical report to that API. For
your FYP demo with your own or invented reports, that is fine. Before any real patient's report
goes through it, move to a paid tier, where that does not apply, and say so in your privacy
policy. If you would rather not send reports anywhere, leave the key empty: uploads still work and
are stored encrypted, only the automatic summary is unavailable.

### Email: free either way, but read the Resend catch first

The app only sends two kinds of mail: an address-verification link at registration, and a
password-reset link. Both go to **whatever address the user typed**, which is the detail that
decides which provider works for you.

**Resend.** Free tier, no card: 100 emails a day and 3,000 a month, with 3 verified domains
included, and full production sending from the moment you sign up — no sandbox, no approval wait.
`npm run setup` fills the SMTP block when you give it the key.

> **The catch.** The `resend.dev` sender address that you get before verifying a domain **only
> delivers to the email address on your own Resend account**. Send to anyone else and the API
> returns 403 telling you to verify a domain first. So on a bare Resend account, registration
> works for you and silently fails for every other person who signs up — and this is exactly the
> kind of thing that goes unnoticed until a supervisor registers during your demo.
>
> Two ways out. Either **verify a domain you own** at resend.com/domains (you add DNS records,
> it takes a few minutes, and it is free on the free tier) and set `MAIL_FROM` to an address on
> it. Or, if you do not have a domain, use the Gmail route below for now.

**Gmail App Password.** No domain needed, delivers to anybody, free. Turn on 2-step verification
on a Gmail account, create an App Password, then:

```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=you@gmail.com
SMTP_PASS=the-16-character-app-password
MAIL_FROM=NIJAAT AI <you@gmail.com>
```

Gmail's limit is roughly 500 recipients a day, which is far more than this app needs, and mail
from a personal Gmail address is more likely to land in spam than mail from a verified domain.
For an FYP that is a fair trade; for a real deployment, verify a domain.

Either way, `npm run check` reports whether the SMTP server actually accepts your credentials
without sending anything.

### SMS: there is no free route that actually delivers

This is the one place where no free alternative does the job, and it is worth understanding
before your demo.

A Twilio trial gives you credit, but trial accounts can only send to numbers you have verified in
the console. For a demo that is enough: verify your own number and one family number, and the
whole alert chain works end to end, including the retry logic and the delivery log.

For real users you need a paid account, and in Pakistan you also need to check that messages
actually arrive. Twilio's own country guidelines say two-way SMS is not supported in Pakistan and
that alphanumeric sender IDs are not supported by every operator, so the sender ID may be
replaced to get the message through. Test delivery to a number on each of Jazz, Zong, Telenor and
Ufone before you rely on it. The app has a button for exactly this: Emergency Contacts → Send
test SMS.

**With no Twilio keys the app does not pretend.** Messages are written to the server log, the
screen says "Development mode", and the delivery log records them honestly.

## When you are ready to put it on a server

See [DEPLOY.md](DEPLOY.md). The short version is one small VPS and `docker compose up -d --build`,
which also handles HTTPS for you.
