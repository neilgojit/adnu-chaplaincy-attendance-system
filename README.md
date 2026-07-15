# Chaplaincy Student Volunteers — Attendance System
Ateneo de Naga University

A phone-friendly attendance web app. Volunteers enter their **Student Number**
and **Ministry** — that's it. The system records their full name, course, and
a timestamp automatically, and generates a monthly Excel summary on demand.

## What's inside

- `server.js` — the whole backend (Express + Node's built-in `node:sqlite`)
- `db.js` — database schema & setup (auto-creates tables on first run)
- `public/index.html`, `style.css`, `app.js` — the volunteer check-in page (blue & gold theme)
- `public/admin.html`, `admin.js` — password-protected dashboard: view log, monthly summary, manage ministries, download Excel

This project uses Node's **built-in SQLite module** (`node:sqlite`) instead of
a native npm package, specifically so nothing needs to be compiled on your
machine — no Visual Studio, no build tools, no `node-gyp` errors on Windows.
It just needs a reasonably recent Node.js (**v22.5 or newer** — anything from
the last year or so is fine; check with `node -v`).

## How the data flow works

1. Volunteer opens the site on their phone, types their **student number**, picks their **ministry**.
2. **First time ever** for that student number → the form asks for Last Name, First Name, Course once. That info is saved permanently.
3. **Every time after that** → just student number + ministry. The system already knows who they are.
4. Only **one check-in per student per day** is allowed (prevents duplicate/accidental taps). If they already checked in today, they'll see a friendly "already recorded" message instead of a duplicate row.
5. Admin can log in at `/admin` to see the live log, a monthly per-student summary, a monthly per-ministry summary, and download everything as a formatted `.xlsx` file (4 sheets: Attendance Log, Students, Monthly Summary, Per-Ministry Totals) at any time.
6. The **QR Code** tab in `/admin` shows a scannable code linking straight to the check-in page — print it and post it near the chapel entrance so volunteers can scan in instead of typing the URL.

## Running it locally

```bash
npm install
npm start
```

Then open `http://localhost:3000` on your computer, or on your phone if it's
on the same Wi-Fi (use your computer's local IP instead of `localhost`, e.g.
`http://192.168.1.5:3000`).

Admin dashboard: `http://localhost:3000/admin`
**Default admin password: `chaplaincy2026`** — change this before real use (see below).

## Important: change the admin password

Set the `ADMIN_PASSWORD` environment variable before deploying. Don't leave
the default in place once this is live and reachable by anyone.

## Editing the ministry list

The system comes pre-loaded with the three Chaplaincy ministries: **Altar
Ministry**, **Proclamation Ministry**, and **Music Ministry**. Add/remove
ministries anytime from the **Ministries** tab in `/admin`, no code changes
needed.

## Making it a live website

This app needs a small persistent disk for the SQLite database file — it
cannot run on purely serverless/static hosting. Two good, free-tier-friendly
options:

### Option A: Render.com (recommended, easiest)

1. Push this project to a GitHub repository.
2. On Render.com → **New Web Service** → connect your repo.
3. Build command: `npm install` · Start command: `npm start`.
4. Add a **Persistent Disk** (Render's free/starter tiers support this):
   mount path `/data`, size 1 GB is plenty.
5. Add environment variables:
   - `DB_PATH` = `/data/attendance.db`
   - `ADMIN_PASSWORD` = (your own password)
6. Deploy. Render gives you a permanent `https://your-app.onrender.com` URL —
   share that link (or a QR code pointing to it) with volunteers.

### Option B: Railway.app

1. Push to GitHub, then **New Project → Deploy from GitHub repo** on Railway.
2. Add a **Volume**, mount it at `/data`.
3. Set environment variables `DB_PATH=/data/attendance.db` and `ADMIN_PASSWORD`.
4. Railway auto-detects Node and runs `npm start`.

> ⚠️ Whichever host you choose, the database **must** live on a persistent
> disk/volume, not the app's regular filesystem — most platforms wipe that on
> every redeploy, which would erase all attendance history.

## Backing up your data

Even with a stable database, it's good practice to download the Excel export
from `/admin` regularly (e.g. weekly) and keep a copy in Google Drive or
similar as an extra backup.

## QR code for the check-in page

Open `/admin` → **QR Code** tab. It shows a scannable code that links to your
site's check-in page and a **Download QR (PNG)** button for a high-resolution
version suitable for printing. If the app is deployed behind a proxy or
custom domain that doesn't report the correct hostname, set a `PUBLIC_URL`
environment variable (e.g. `PUBLIC_URL=https://your-app.onrender.com`) to
pin the URL the QR code encodes.

## Per-ministry monthly totals

Open `/admin` → **Per-Ministry Totals** tab to see total check-ins per
ministry, broken down by month. This is also included as a fourth sheet
("Per-Ministry Totals") in the Excel export, alongside the existing
per-student Monthly Summary.
