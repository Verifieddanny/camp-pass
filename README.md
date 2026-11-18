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

- **Corps Member view:** live meal ticket with QR code, a status bar showing your queue position, and app colours that follow your ticket status (green ready, amber in queue, deep green served, purple priority). Also Camp ID, Hostel Bunk Pass, Camp Clearance and meal history. Meals: Breakfast from 7:30 AM, Lunch from 2:00 PM, Dinner from 6:30 PM.
- **Official / Kitchen view:** Gate check-in (search 40 corps members or scan their QR), a live queue where serving the person at the front moves everyone up on every staff phone, ration inventory, platoon audit and activity log. Every count is derived from real corps member records on the server.
- **Live sync:** a kitchen phone scans and the corps member's phone updates instantly (Server-Sent Events)
- **Offline-first:** the service worker caches the whole app. Actions taken with no signal are saved on the device and synced when the connection returns.
- **Installable:** add-to-Home-Screen prompt (Android) and guided install (iPhone), splash screen, standalone full-screen app
- **Demo-ready:** pre-seeded camp data, "Reset Demo State", and switchable corps member profiles for a two-phone demo

## Tech stack

| Layer | Tech |
|---|---|
| Front end | HTML5, CSS, vanilla JavaScript (no build step) |
| PWA | `manifest.json`, `sw.js` service worker, PNG and SVG icons |
| Back end | Node.js and Express REST API, Server-Sent Events, Redis (Upstash) or JSON file storage |
| Shared logic | `public/engine.js`, the same state machine running on server and phone |
| QR | `qrcode-generator` (MIT), bundled locally |

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Health check |
| GET | `/api/state?day=YYYY-MM-DD` | Full camp state |
| GET | `/api/members` | Corps member list |
| GET | `/api/members/:stateCode` | One member's profile, passes, and tickets |
| POST | `/api/actions` | Apply actions (`checkin`, `serve`, `serveNext`, `addPlates`, `removePlate`, `finish`, `profile`, `reset`); accepts an offline batch |
| GET | `/api/stream` | Live updates (Server-Sent Events) |

## Run locally

```bash
npm install
npm start        # http://localhost:3000
npm test         # state-machine tests
```

## Deploy (free, from a phone)

**Vercel (live demo):** import this repo in Vercel and it detects the Express app. For shared state across serverless instances, open the project's **Storage** tab, create an **Upstash for Redis** database, and connect it. That sets `KV_REST_API_URL` and `KV_REST_API_TOKEN`, and the server uses Redis automatically. Then redeploy.

**Render:** use **New → Blueprint** and pick this repo. `render.yaml` configures everything.

Phones stay in sync through Server-Sent Events plus light polling (every 2.5 seconds). If there's no backend at all, the app runs fully on the device in "On-device mode".

## License

MIT
