# CampPass

**Digital meal ticket and camp pass for NYSC orientation camps.** An offline-first Progressive Web App with a Node.js backend.

## The problem

Paper meal tickets get lost or ruined by sweat and rain. Worse, tickets are ticked at the kitchen **entrance**. If food finishes before a corps member reaches the serving point, their ticket is already marked as used, and there's no proof they went unserved.

## The solution: two-step meal verification

```
READY ──(gate check-in)──▶ IN QUEUE ──(plate handover)──▶ SERVED
                              │
                              └─(rations hit 0)──▶ PRIORITY ROLLOVER ──(next batch / meal)──▶ SERVED
```

1. **Gate check-in** reserves a ration and records a timestamp. The ticket is *not* used yet.
2. **Plate handover** is the only step that marks the ticket as used.
3. If rations reach **0** while you're in the queue, your ticket automatically becomes a **Priority Rollover Pass**. Your check-in timestamp proves you came, and you're served first from the next batch.

## Features

- **Corps Member view:** live meal ticket with QR code, Camp ID card, Hostel Bunk Pass, Camp Clearance checklist, and full meal history
- **Official / Kitchen view:** two-step scanner (buttons, plus a real camera QR scan on supported phones), live ration inventory, a "Simulate Food Finished" button, platoon ration audit, and an activity log
- **Live sync:** a kitchen phone scans and the corps member's phone updates instantly (Server-Sent Events)
- **Offline-first:** the service worker caches the whole app. Actions taken with no signal are saved on the device and synced when the connection returns.
- **Installable:** add-to-Home-Screen prompt (Android) and guided install (iPhone), splash screen, standalone full-screen app
- **Demo-ready:** pre-seeded camp data, "Reset Demo State", and switchable corps member profiles for a two-phone demo

## Tech stack

| Layer | Tech |
|---|---|
| Front end | HTML5, CSS, vanilla JavaScript (no build step) |
| PWA | `manifest.json`, `sw.js` service worker, PNG and SVG icons |
| Back end | Node.js and Express REST API, Server-Sent Events, JSON file storage |
| Shared logic | `public/engine.js`, the same state machine running on server and phone |
| QR | `qrcode-generator` (MIT), bundled locally |

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Health check |
| GET | `/api/state?day=YYYY-MM-DD` | Full camp state |
| GET | `/api/members` | Corps member list |
| GET | `/api/members/:stateCode` | One member's profile, passes, and tickets |
| POST | `/api/actions` | Apply actions (`checkin`, `serve`, `serveOther`, `addPlates`, `finish`, `profile`, `reset`); accepts an offline batch |
| GET | `/api/stream` | Live updates (Server-Sent Events) |

## Run locally

```bash
npm install
npm start        # http://localhost:3000
npm test         # state-machine tests
```

## Deploy (free, from a phone)

1. Sign in at [render.com](https://render.com) with GitHub.
2. **New → Blueprint** → pick this repo. `render.yaml` configures everything.
3. Open the `onrender.com` URL on your phone and tap **Install**.

If there's no backend (for example on GitHub Pages), the app runs fully on the device in "On-device mode".

## License

MIT
