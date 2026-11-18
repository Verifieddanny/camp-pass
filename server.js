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

/* ---------- Storage (JSON file, written atomically) ---------- */
let world;
try { world = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch (e) { world = null; }
if (!world || world.v !== 2) world = Engine.seedWorld(campToday());

let saveTimer = null;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
      fs.writeFileSync(DATA_FILE + '.tmp', JSON.stringify(world));
      fs.renameSync(DATA_FILE + '.tmp', DATA_FILE);
    } catch (e) { console.error('save failed', e.message); }
  }, 150);
}

/* ---------- Live updates ---------- */
const clients = new Set();
function broadcast() {
  const msg = `event: world\ndata: ${JSON.stringify(world)}\n\n`;
  for (const res of clients) res.write(msg);
}
setInterval(() => { for (const res of clients) res.write(': ping\n\n'); }, 25000);

/* ---------- App ---------- */
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));
app.use((req, res, next) => { if (req.path.startsWith('/api/')) res.set('Cache-Control', 'no-store'); next(); });

app.get('/api/health', (req, res) => res.json({ ok: true, rev: world.rev, clients: clients.size, today: campToday() }));

app.get('/api/state', (req, res) => {
  const day = validDay(req.query.day) ? req.query.day : campToday();
  const before = world.rev;
  Engine.ensureDay(world, day);
  if (world.rev !== before) persist();
  res.json({ world, serverTime: Date.now() });
});

app.get('/api/members', (req, res) => {
  res.json(Object.values(world.members).map((m) => ({
    stateCode: m.profile.stateCode, name: `${m.profile.first} ${m.profile.last}`, platoon: m.profile.platoon
  })));
});

app.get('/api/members/:code(*)', (req, res) => {
  const m = world.members[req.params.code.toUpperCase()];
  if (!m) return res.status(404).json({ error: 'Not found' });
  res.json(m);
});

// Apply one or more actions in order (offline phones replay their queue here).
app.post('/api/actions', (req, res) => {
  const list = Array.isArray(req.body.actions) ? req.body.actions.slice(0, 200) : [req.body];
  const results = [];
  for (const a of list) {
    if (!a || typeof a.type !== 'string' || !validDay(a.day)) { results.push({ ok: false, msg: 'Bad action' }); continue; }
    if (a.meal && !Engine.MEAL[a.meal]) { results.push({ ok: false, msg: 'Bad meal' }); continue; }
    if (a.at && (typeof a.at !== 'number' || a.at > Date.now() + 5 * 60000)) a.at = Date.now();
    try { results.push(Engine.apply(world, a)); } catch (e) { results.push({ ok: false, msg: 'Server error' }); }
  }
  persist();
  broadcast();
  res.json({ results, world });
});

app.get('/api/stream', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  res.write(`retry: 3000\nevent: world\ndata: ${JSON.stringify(world)}\n\n`);
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

app.listen(PORT, () => console.log(`CampPass running on http://localhost:${PORT}`));
