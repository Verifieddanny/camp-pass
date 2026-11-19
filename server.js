// CampPass server: serves the PWA, exposes the REST API, and pushes live
// updates to every open phone over Server-Sent Events.
const express = require('express');
const fs = require('fs');
const path = require('path');
const Engine = require('./public/engine.js');

const PORT = process.env.PORT || 3000;
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data', 'db.json');
const TZ_OFFSET_MIN = Number(process.env.CAMP_TZ_OFFSET_MIN || 60); // Nigeria (WAT) = UTC+1

const campToday = () => Engine.dkey(new Date(Date.now() + (TZ_OFFSET_MIN + new Date().getTimezoneOffset()) * 60000));
const validDay = (d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d);

/* ---------- Storage ----------
 * With Upstash/Vercel KV env vars set, camp state lives in Redis, so every
 * serverless instance (Vercel) shares it. Otherwise it is kept in memory and
 * saved to a JSON file (Render, local).
 */
const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const REDIS_KEY = 'camppass:world';
const useRedis = !!(REDIS_URL && REDIS_TOKEN);

async function redis(cmd) {
  const r = await fetch(REDIS_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd)
  });
  if (!r.ok) throw new Error('redis ' + r.status);
  return (await r.json()).result;
}

let world;
try { world = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch (e) { world = null; }
if (!world || world.v !== Engine.VERSION) world = Engine.seedWorld(campToday());

// Pull the newest shared state before handling a request.
async function refresh() {
  if (!useRedis) return;
  try {
    const raw = await redis(['GET', REDIS_KEY]);
    if (raw) {
      const w = JSON.parse(raw);
      if (w && w.v === Engine.VERSION) world = w;
      else await redis(['SET', REDIS_KEY, JSON.stringify(world)]);
    } else {
      await redis(['SET', REDIS_KEY, JSON.stringify(world)]);
    }
  } catch (e) { console.error('redis read failed', e.message); }
}

let saveTimer = null;
async function persist() {
  if (useRedis) {
    try { await redis(['SET', REDIS_KEY, JSON.stringify(world)]); } catch (e) { console.error('redis write failed', e.message); }
    return;
  }
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
      fs.writeFileSync(DATA_FILE + '.tmp', JSON.stringify(world));
      fs.renameSync(DATA_FILE + '.tmp', DATA_FILE);
    } catch (e) { /* read-only filesystem (serverless): memory only */ }
  }, 150);
}

// Member secrets never leave the server except to that member's own phone.
const publicJSON = (w) => JSON.stringify(w, (k, v) => (k === 'secret' ? undefined : v));
const sendWorld = (res, extra) => res.type('application/json').send(`{"world":${publicJSON(world)}${extra ? ',' + JSON.stringify(extra).slice(1, -1) : ''}}`);

/* ---------- Live updates ---------- */
const clients = new Set();
function broadcast() {
  const msg = `event: world\ndata: ${publicJSON(world)}\n\n`;
  for (const res of clients) res.write(msg);
}
setInterval(() => { for (const res of clients) res.write(': ping\n\n'); }, 25000);

/* ---------- App ---------- */
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));
app.use((req, res, next) => { if (req.path.startsWith('/api/')) res.set('Cache-Control', 'no-store'); next(); });

app.use('/api', (req, res, next) => { refresh().then(next, next); });

app.get('/api/health', (req, res) => res.json({ ok: true, rev: world.rev, storage: useRedis ? 'redis' : 'memory+file', clients: clients.size, today: campToday() }));

app.get('/api/state', (req, res) => {
  const day = validDay(req.query.day) ? req.query.day : campToday();
  const hadDay = !!world.kitchen[day];
  Engine.ensureDay(world, day);
  if (!hadDay) persist();
  // Cheap polling: the phone sends the rev it has; reply small when nothing changed.
  if (req.query.rev && Number(req.query.rev) === world.rev && hadDay) return res.json({ same: true, rev: world.rev });
  sendWorld(res, { serverTime: Date.now() });
});

app.get('/api/members', (req, res) => {
  res.json(Object.values(world.members).map((m) => ({
    stateCode: m.profile.stateCode, name: `${m.profile.first} ${m.profile.last}`, platoon: m.profile.platoon
  })));
});

app.get('/api/members/:code(*)', (req, res) => {
  const m = world.members[req.params.code.toUpperCase()];
  if (!m) return res.status(404).json({ error: 'Not found' });
  res.type('application/json').send(publicJSON(m));
});

// Demo sign-in: hands a member's phone its QR signing secret.
app.get('/api/secret', (req, res) => {
  const m = world.members[String(req.query.code || '').toUpperCase()];
  if (!m) return res.status(404).json({ error: 'Not found' });
  res.json({ code: m.profile.stateCode, secret: m.secret });
});

// Staff scanners check a live QR before acting on it.
app.post('/api/verify', (req, res) => {
  const v = Engine.verifyQR(world, req.body && req.body.qr);
  res.json({ ok: v.ok, reason: v.reason, code: v.code, meal: v.meal, kind: v.kind, day: v.day });
});

// Apply one or more actions in order (offline phones replay their queue here).
app.post('/api/actions', async (req, res) => {
  const list = Array.isArray(req.body.actions) ? req.body.actions.slice(0, 200) : [req.body];
  const results = [];
  for (const a of list) {
    if (!a || typeof a.type !== 'string' || !validDay(a.day)) { results.push({ ok: false, msg: 'Bad action' }); continue; }
    if (a.meal && !Engine.MEAL[a.meal]) { results.push({ ok: false, msg: 'Bad meal' }); continue; }
    if (a.at && (typeof a.at !== 'number' || a.at > Date.now() + 5 * 60000)) a.at = Date.now();
    try { results.push(Engine.apply(world, a)); } catch (e) { results.push({ ok: false, msg: 'Server error' }); }
  }
  await persist();
  broadcast();
  sendWorld(res, { results });
});

app.get('/api/stream', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  res.write(`retry: 3000\nevent: world\ndata: ${publicJSON(world)}\n\n`);
  clients.add(res);
  req.on('close', () => clients.delete(res));
});

app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders(res, file) {
    if (file.endsWith('sw.js') || file.endsWith('.html')) res.set('Cache-Control', 'no-cache');
    if (file.endsWith('manifest.json')) res.set('Content-Type', 'application/manifest+json');
  }
}));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

if (require.main === module) app.listen(PORT, () => console.log(`CampPass running on http://localhost:${PORT}`));
module.exports = app;
