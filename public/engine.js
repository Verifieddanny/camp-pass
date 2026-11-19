/*
 * CampPass engine: the meal-ticket state machine and camp records.
 * The same file runs on the server (Node) and in the browser, so the app
 * behaves identically online and offline.
 *
 *   READY --(gate check-in)--> QUEUED --(plate handover)--> SERVED
 *                                 \--(rations hit 0)--> ROLLOVER --(next batch)--> SERVED (priority)
 *
 * Every count (served, queue, rollovers, platoon audit) is derived from the
 * corps members' own ticket records. The kitchen only stores how many plates
 * were cooked.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CampEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MEALS = [
    { id: 'breakfast', name: 'Breakfast', emoji: '🍞', time: 'From 7:30 AM', short: '7:30 AM', h: 7, m: 30 },
    { id: 'lunch', name: 'Lunch', emoji: '🍛', time: 'From 2:00 PM', short: '2:00 PM', h: 14, m: 0 },
    { id: 'dinner', name: 'Dinner', emoji: '🍲', time: 'From 6:30 PM', short: '6:30 PM', h: 18, m: 30 }
  ];
  const MEAL = Object.fromEntries(MEALS.map((m) => [m.id, m]));
  const PLATOONS = 10;
  const DEMO_CODE = 'LA/26C/4012';
  const COOKED = 40;

  // Which meal is "now": breakfast until 11:30, lunch until 5:30 PM, then dinner.
  function currentMeal(d) {
    d = d || new Date();
    const mins = d.getHours() * 60 + d.getMinutes();
    return mins < 11 * 60 + 30 ? 'breakfast' : mins < 17 * 60 + 30 ? 'lunch' : 'dinner';
  }

  const TODAY_MENU = { breakfast: 'Bread, tea & omelette', lunch: 'Jollof rice & chicken', dinner: 'Eba & egusi soup' };
  const PAST_MENU = {
    breakfast: ['Bread, tea & egg', 'Pap & akara', 'Yam & egg sauce', 'Bread & beans', 'Custard & moi moi'],
    lunch: ['Jollof rice & chicken', 'White rice & stew', 'Beans & plantain', 'Fried rice & fish', 'Amala & ewedu'],
    dinner: ['Eba & egusi', 'Spaghetti & fish', 'Semo & okra', 'Rice & beans', 'Yam porridge']
  };

  const PEOPLE = [
    { first: 'Adaeze', last: 'Okonkwo', stateCode: DEMO_CODE, platoon: 4, hostel: 'Block B', bunk: 'Bunk 14' },
    { first: 'Tunde', last: 'Bakare', stateCode: 'LA/26C/3307', platoon: 2, hostel: 'Block D', bunk: 'Bunk 03' },
    { first: 'Fatima', last: 'Musa', stateCode: 'LA/26C/5120', platoon: 7, hostel: 'Block A', bunk: 'Bunk 22' },
    { first: 'Chinedu', last: 'Eze', stateCode: 'LA/26C/1894', platoon: 4, hostel: 'Block B', bunk: 'Bunk 15' },
    { first: 'Blessing', last: 'Akpan', stateCode: 'LA/26C/6631', platoon: 9, hostel: 'Block C', bunk: 'Bunk 08' }
  ];
  const FIRSTS = ['Emeka', 'Aisha', 'Segun', 'Ngozi', 'Ibrahim', 'Chiamaka', 'Yusuf', 'Funmilayo', 'Obinna', 'Zainab', 'Kelechi', 'Halima', 'Damilola', 'Uche', 'Hauwa', 'Tobi', 'Amarachi', 'Sani', 'Bukola', 'Ifeanyi', 'Kemi', 'Musa', 'Ebere', 'Femi', 'Nkechi', 'Abdullahi', 'Temitope', 'Chidi', 'Rukayat', 'Gbenga', 'Ada', 'Bashir', 'Folake', 'Nnamdi', 'Hadiza'];
  const LASTS = ['Okafor', 'Bello', 'Adeyemi', 'Nwosu', 'Abubakar', 'Okeke', 'Lawal', 'Oladipo', 'Eze', 'Usman', 'Obi', 'Danjuma', 'Afolabi', 'Igwe', 'Garba', 'Ogunleye', 'Chukwu', 'Aliyu', 'Balogun', 'Onyeka', 'Adebayo', 'Ibrahim', 'Okoro', 'Fashola', 'Nnadi', 'Shehu', 'Oyelaran', 'Anozie', 'Yakubu', 'Ojo', 'Mbah', 'Sule', 'Adewale', 'Ezeh', 'Mohammed'];
  const BATCH = '2026 Batch C · Stream I';
  const CAMP = 'Iyana-Ipaja Orientation Camp, Lagos';
  const CLEARANCE = [
    { id: 'reg', name: 'Registration & Documentation', note: 'Verified at registration desk' },
    { id: 'clinic', name: 'Camp Clinic Medical Check', note: 'Fit for camp activities' },
    { id: 'kit', name: 'Kit Issue', note: 'Khaki, white kit, jungle boots, crested vest' },
    { id: 'obs', name: "OBS (Man O'War) Drills", note: 'Complete the obstacle course' },
    { id: 'saed', name: 'SAED Training', note: 'Skill acquisition programme' },
    { id: 'pay', name: 'Bank & Allowance Verification', note: 'Account confirmed' }
  ];

  const pad = (n) => String(n).padStart(2, '0');
  const dkey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseDay = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
  const shiftDay = (k, n) => { const d = parseDay(k); d.setDate(d.getDate() + n); return dkey(d); };
  const at = (k, h, m) => { const d = parseDay(k); d.setHours(h, m, 0, 0); return d.getTime(); };
  function rng(seed) { let s = seed >>> 0; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; }

  /* ---------------- Seed ---------------- */
  function allPeople() {
    const r = rng(2026);
    const out = PEOPLE.slice();
    for (let i = 0; i < 35; i++) {
      const code = `LA/26C/${String(1000 + Math.floor(r() * 8999)).padStart(4, '0')}`;
      if (out.some((p) => p.stateCode === code)) { i--; continue; }
      const blocks = ['A', 'B', 'C', 'D', 'E'];
      out.push({
        first: FIRSTS[i], last: LASTS[(i * 7) % LASTS.length], stateCode: code,
        platoon: 1 + (i % PLATOONS), hostel: `Block ${blocks[i % 5]}`, bunk: `Bunk ${pad(1 + Math.floor(r() * 30))}`
      });
    }
    return out;
  }

  function freshDayTickets() {
    const out = {};
    MEALS.forEach((m) => (out[m.id] = { status: 'ready' }));
    return out;
  }

  function seedMember(person, today, idx) {
    const tickets = {};
    if (idx < 5) {
      for (let i = 5; i >= 1; i--) {
        const k = shiftDay(today, -i);
        const r = rng(i * 97 + idx * 13);
        tickets[k] = {};
        MEALS.forEach((m) => {
          const qIn = at(k, m.h, m.m + Math.floor(r() * 40));
          let t = { status: 'served', checkedInAt: qIn, servedAt: qIn + (6 + Math.floor(r() * 14)) * 60000, menu: PAST_MENU[m.id][i - 1] };
          if (idx === 0 && i === 3 && m.id === 'lunch') {
            t = { status: 'rollover', checkedInAt: qIn, rolledAt: qIn + 19 * 60000, menu: PAST_MENU.lunch[i - 1], redeemedAt: qIn + 52 * 60000, servedAt: qIn + 52 * 60000, priority: true };
          }
          if (idx === 0 && i === 2 && m.id === 'breakfast') t = { status: 'missed', menu: PAST_MENU.breakfast[i - 1] };
          tickets[k][m.id] = t;
        });
      }
    }
    tickets[today] = freshDayTickets();
    const d6 = shiftDay(today, -6), d5 = shiftDay(today, -5), d4 = shiftDay(today, -4);
    const cleared = { reg: at(d6, 10, 12), clinic: at(d6, 12, 40), kit: at(d5, 9, 15), pay: at(d4, 14, 2) };
    if (idx % 2 === 1) cleared.obs = at(d4, 8, 30);
    return {
      profile: person,
      cleared,
      tickets
    };
  }

  // Today's live picture: some corps members already served, some waiting in the queue.
  function seedToday(w, day, now) {
    const codes = Object.keys(w.members).slice(5); // the 5 featured members start fresh
    MEALS.forEach((m, mi) => {
      const start = at(day, m.h, m.m);
      const shuffled = codes.slice().sort((a, b) => ((a.charCodeAt(9) * 31 + mi * 17) % 13) - ((b.charCodeAt(9) * 31 + mi * 17) % 13));
      shuffled.slice(0, 14).forEach((c, i) => {
        const t = w.members[c].tickets[day][m.id];
        t.status = 'served'; t.checkedInAt = start + i * 90000; t.servedAt = t.checkedInAt + 6 * 60000;
      });
      shuffled.slice(14, 21).forEach((c, i) => {
        const t = w.members[c].tickets[day][m.id];
        t.status = 'queued'; t.checkedInAt = now - (7 - i) * 70000;
      });
    });
  }

  function seedWorld(today, now) {
    now = now || Date.now();
    const members = {};
    allPeople().forEach((p, i) => (members[p.stateCode] = seedMember(p, today, i)));
    const w = { v: 6, rev: 1, resetAt: 0, members, kitchen: {}, log: [] };
    w.kitchen[today] = freshKitchen();
    seedToday(w, today, now);
    addLog(w, now - 60000, 'info', 'Kitchen opened: 40 plates cooked per meal');
    return w;
  }
  function freshKitchen() { const k = {}; MEALS.forEach((m) => (k[m.id] = { cooked: COOKED })); return k; }

  /* ---------------- Derived counts ---------------- */
  function ensureDay(w, day) {
    if (!w.kitchen[day]) w.kitchen[day] = freshKitchen();
    for (const code in w.members) {
      const mb = w.members[code];
      if (!mb.tickets[day]) mb.tickets[day] = freshDayTickets();
    }
  }
  const ticketsFor = (w, day, meal) => Object.keys(w.members).map((c) => ({ code: c, p: w.members[c].profile, t: w.members[c].tickets[day] && w.members[c].tickets[day][meal] })).filter((x) => x.t);
  const isServed = (t) => t.status === 'served' || (t.status === 'rollover' && !!t.redeemedAt);

  function stats(w, day, meal) {
    const all = ticketsFor(w, day, meal);
    const k = w.kitchen[day][meal];
    const served = all.filter((x) => isServed(x.t)).length;
    const queue = all.filter((x) => x.t.status === 'queued').sort((a, b) => a.t.checkedInAt - b.t.checkedInAt);
    const priority = all.filter((x) => x.t.status === 'rollover' && !x.t.redeemedAt).sort((a, b) => a.t.rolledAt - b.t.rolledAt);
    const rollovers = all.filter((x) => x.t.status === 'rollover').length;
    const platoons = {};
    for (let p = 1; p <= PLATOONS; p++) platoons[p] = { s: 0, r: 0, q: 0 };
    all.forEach((x) => {
      const pl = platoons[x.p.platoon] || (platoons[x.p.platoon] = { s: 0, r: 0, q: 0 });
      if (isServed(x.t)) pl.s++;
      if (x.t.status === 'rollover') pl.r++;
      if (x.t.status === 'queued') pl.q++;
    });
    return { cooked: k.cooked, served, remaining: Math.max(0, k.cooked - served), queue, priority, rollovers, platoons, total: all.length };
  }
  function queuePos(w, day, meal, code) {
    const q = stats(w, day, meal).queue;
    const i = q.findIndex((x) => x.code === code);
    return i < 0 ? null : i + 1;
  }
  function addLog(w, t, type, msg) { w.log.unshift({ t, type, msg }); if (w.log.length > 80) w.log.length = 80; }
  const nm = (w, c) => { const p = w.members[c].profile; return `${p.first} ${p.last}`; };

  function pendingRollover(w, code, day) {
    const tk = w.members[code] && w.members[code].tickets[day];
    if (!tk) return null;
    for (const m of MEALS) { const t = tk[m.id]; if (t.status === 'rollover' && !t.redeemedAt) return { meal: m.id, t }; }
    return null;
  }

  /* ---------------- Live QR (TOTP-style, works offline) ----------------
   * Each corps member has a private secret. Their phone signs
   *   code | day | meal | kind | window   (window = 30-second time slot)
   * with HMAC-SHA256, so the QR changes every 30 seconds and can be made
   * with no network. The server (and any scanner holding the secret)
   * recomputes the signature: a screenshot or an old code fails.
   */
  const WINDOW_MS = 60000;
  const K256 = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
  function sha256(bytes) {
    const l = bytes.length, withPad = ((l + 9 + 63) >> 6) << 6, m = new Uint8Array(withPad);
    m.set(bytes); m[l] = 0x80;
    const bits = l * 8; m[withPad - 4] = bits >>> 24; m[withPad - 3] = bits >>> 16; m[withPad - 2] = bits >>> 8; m[withPad - 1] = bits;
    let h = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
    const w = new Uint32Array(64), r = (x, n) => (x >>> n) | (x << (32 - n));
    for (let o = 0; o < withPad; o += 64) {
      for (let i = 0; i < 16; i++) w[i] = (m[o + i * 4] << 24) | (m[o + i * 4 + 1] << 16) | (m[o + i * 4 + 2] << 8) | m[o + i * 4 + 3];
      for (let i = 16; i < 64; i++) {
        const s0 = r(w[i - 15], 7) ^ r(w[i - 15], 18) ^ (w[i - 15] >>> 3), s1 = r(w[i - 2], 17) ^ r(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
      }
      let [a, b, c, d, e, f, g, hh] = h;
      for (let i = 0; i < 64; i++) {
        const t1 = (hh + (r(e, 6) ^ r(e, 11) ^ r(e, 25)) + ((e & f) ^ (~e & g)) + K256[i] + w[i]) | 0;
        const t2 = ((r(a, 2) ^ r(a, 13) ^ r(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
        hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      h = [h[0] + a, h[1] + b, h[2] + c, h[3] + d, h[4] + e, h[5] + f, h[6] + g, h[7] + hh].map((x) => x | 0);
    }
    const out = new Uint8Array(32);
    h.forEach((x, i) => { out[i * 4] = x >>> 24; out[i * 4 + 1] = x >>> 16; out[i * 4 + 2] = x >>> 8; out[i * 4 + 3] = x; });
    return out;
  }
  const utf8 = (str) => new TextEncoder().encode(str);
  const hexToBytes = (hex) => new Uint8Array(hex.match(/../g).map((x) => parseInt(x, 16)));
  const toHex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  function hmacHex(secretHex, msg) {
    let key = hexToBytes(secretHex);
    if (key.length > 64) key = sha256(key);
    const k = new Uint8Array(64); k.set(key);
    const ipad = k.map((x) => x ^ 0x36), opad = k.map((x) => x ^ 0x5c), mb = utf8(msg);
    const inner = new Uint8Array(64 + mb.length); inner.set(ipad); inner.set(mb, 64);
    const ih = sha256(inner), outer = new Uint8Array(96); outer.set(opad); outer.set(ih, 64);
    return toHex(sha256(outer));
  }
  // A member's QR secret is derived from the camp's server key, so every server
  // instance (and every reset) gives the same member the same secret.
  const memberSecret = (serverKey, code) => hmacHex(toHex(utf8(serverKey)), 'member|' + code).slice(0, 32);
  function newSecret() {
    const b = new Uint8Array(16);
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(b);
    else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
    return toHex(b);
  }
  const qrWindow = (now) => Math.floor((now || Date.now()) / WINDOW_MS);
  const sigFor = (secret, code, day, meal, kind, win) => hmacHex(secret, `${code}|${day}|${meal}|${kind}|${win}`).slice(0, 12).toUpperCase();

  // kind: M = meal ticket, P = priority pass, I = camp ID (meal is '-')
  function makeQR(secret, code, day, meal, kind, now) {
    const win = qrWindow(now);
    return `CP|${code}|${day}|${meal}|${kind}|${win}|${sigFor(secret, code, day, meal, kind, win)}`;
  }
  function parseQR(text) {
    const p = String(text || '').split('|');
    if (p[0] !== 'CP' || p.length !== 7) return null;
    return { code: p[1], day: p[2], meal: p[3], kind: p[4], win: Number(p[5]), sig: p[6] };
  }
  // Returns { ok, reason?, ...parsed }. With no secret available (a staff phone offline),
  // only the time window is checked; the server re-checks the signature when it syncs.
  // Accepts the current code and the one just before or after it (phone clocks drift).
  // secret: the member's secret when known (server). Without it (staff phone offline)
  // only the time is checked, and the server re-checks the signature when it syncs.
  function verifyQR(w, text, now, secret) {
    const q = parseQR(text);
    if (!q || !w.members[q.code]) return { ok: false, reason: 'invalid' };
    const nowWin = qrWindow(now);
    if (q.win < nowWin - 1 || q.win > nowWin + 1) return Object.assign({ ok: false, reason: 'expired' }, q);
    if (typeof secret === 'function') secret = secret(q.code);
    if (secret && sigFor(secret, q.code, q.day, q.meal, q.kind, q.win) !== q.sig) return Object.assign({ ok: false, reason: 'invalid' }, q);
    return Object.assign({ ok: true, verified: !!secret }, q);
  }


  // Plates ran out: nobody still in the queue is silently "ticked". They all roll over.
  function exhaust(w, day, meal, now, reason) {
    const q = stats(w, day, meal).queue;
    q.forEach((x) => { x.t.status = 'rollover'; x.t.rolledAt = now; });
    if (q.length) addLog(w, now, 'alert', `${MEAL[meal].name}: ${reason}. ${q.length} corps member${q.length > 1 ? 's' : ''} in queue issued Priority Rollover Passes`);
    return q.map((x) => x.code);
  }

  /* ---------------- Sync: last change wins, per ticket ----------------
   * Every ticket and kitchen count carries u = when it last changed, and the world
   * carries resetAt. Two copies of the camp (two phones, or a server instance that
   * restarted) merge by keeping the newer version of each ticket, so a stale copy
   * can never push someone back from In queue to Ready.
   */
  function snapDay(w, day) {
    const out = {};
    for (const c in w.members) { const tk = w.members[c].tickets[day]; if (tk) for (const m in tk) out[c + '|' + m] = JSON.stringify(tk[m]); }
    const k = w.kitchen[day] || {};
    for (const m in k) out['K|' + m] = JSON.stringify(k[m]);
    return out;
  }
  function stampDay(w, day, before, now) {
    // Always later than the version it replaces, even if this phone's clock is behind.
    const stamp = (key, x) => { const b = before[key]; if (b === JSON.stringify(x)) return; const old = b ? JSON.parse(b).u || 0 : 0; x.u = Math.max(now, old + 1); };
    for (const c in w.members) { const tk = w.members[c].tickets[day]; if (tk) for (const m in tk) stamp(c + '|' + m, tk[m]); }
    const k = w.kitchen[day] || {};
    for (const m in k) stamp('K|' + m, k[m]);
  }
  // A small copy of one day, for phones to share what they know with the server.
  function slim(w, day) {
    const out = { v: w.v, resetAt: w.resetAt || 0, members: {}, kitchen: {} };
    if (w.kitchen[day]) out.kitchen[day] = w.kitchen[day];
    for (const c in w.members) {
      const mb = w.members[c], o = {};
      if (mb.tickets[day]) o.tickets = { [day]: mb.tickets[day] };
      if (mb.profile.u) o.profile = { first: mb.profile.first, last: mb.profile.last, u: mb.profile.u };
      out.members[c] = o;
    }
    return out;
  }
  // Folds what `o` knows into `w`. Returns true when `w` changed.
  function merge(w, o) {
    if (!o || o.v !== w.v || !o.members) return false;
    const R = Math.max(w.resetAt || 0, o.resetAt || 0);
    const wCur = (w.resetAt || 0) === R, oCur = (o.resetAt || 0) === R;
    let changed = false;
    const newer = (mine, theirs) => {
      if (!theirs || typeof theirs !== 'object') return false;
      const tu = theirs.u || 0, mu = mine ? mine.u || 0 : -1;
      if (!(oCur || tu > R)) return false;
      if (!mine || !(wCur || mu > R)) return true;
      return tu > mu;
    };
    const copy = (x) => JSON.parse(JSON.stringify(x));
    for (const c in o.members) {
      const mb = w.members[c], om = o.members[c];
      if (!mb || !om) continue;
      if (om.profile && newer(mb.profile.u ? mb.profile : null, om.profile)) {
        Object.assign(mb.profile, { first: String(om.profile.first).slice(0, 40), last: String(om.profile.last).slice(0, 40), u: om.profile.u }); changed = true;
      }
      for (const day in om.tickets || {}) {
        if (!mb.tickets[day]) { mb.tickets[day] = freshDayTickets(); changed = true; }
        for (const m in om.tickets[day]) {
          if (!MEAL[m]) continue;
          if (newer(mb.tickets[day][m], om.tickets[day][m])) { mb.tickets[day][m] = copy(om.tickets[day][m]); changed = true; }
        }
      }
    }
    for (const day in o.kitchen || {}) {
      if (!w.kitchen[day]) { w.kitchen[day] = freshKitchen(); changed = true; }
      for (const m in o.kitchen[day]) {
        if (!MEAL[m]) continue;
        if (newer(w.kitchen[day][m], o.kitchen[day][m])) { w.kitchen[day][m] = copy(o.kitchen[day][m]); changed = true; }
      }
    }
    if (Array.isArray(o.log)) {
      const seen = new Set(wCur ? w.log.map((l) => l.t + l.msg) : []);
      const add = o.log.filter((l) => l && !seen.has(l.t + l.msg) && (oCur || l.t > R));
      if (add.length || !wCur) { w.log = (wCur ? w.log : []).concat(add).sort((a, b) => b.t - a.t).slice(0, 80); changed = changed || add.length > 0; }
    }
    if (R !== (w.resetAt || 0)) { w.resetAt = R; changed = true; }
    return changed;
  }

  /* ---------------- Actions ---------------- */
  // Every action: { type, day, meal, code?, at? }. Returns { ok, msg, tone, fx }.
  function apply(w, a) {
    const day = a.day, meal = a.meal, now = a.at || Date.now();
    ensureDay(w, day);
    const fail = (msg) => ({ ok: false, msg, tone: 'red' });
    const st = meal ? stats(w, day, meal) : null;
    let code = a.code;
    if (a.type === 'serveNext') {
      if (st.priority.length && st.remaining > 0) code = st.priority[0].code;
      else if (st.queue.length) code = st.queue[0].code;
      else return fail('Nobody is waiting in the queue.');
    }
    const mb = code ? w.members[code] : null;
    const t = mb && meal ? mb.tickets[day][meal] : null;
    if (a.qr && (a.type === 'checkin' || a.type === 'serve')) {
      const v = verifyQR(w, a.qr, now, a.secretFor);
      if (!v.ok) return fail(v.reason === 'expired' ? 'Code expired' : 'Invalid code');
      if (v.code !== code) return fail('Invalid code');
    }
    let res;
    const before = snapDay(w, day);

    switch (a.type) {
      case 'checkin': {
        if (!t) return fail('Unknown corps member.');
        if (t.status !== 'ready') return fail(`${nm(w, code)} is already checked in for ${MEAL[meal].name}.`);
        if (st.remaining <= 0) return fail('Kitchen is out of plates. Ticket NOT marked, so it stays valid.');
        t.status = 'queued'; t.checkedInAt = now;
        const pos = queuePos(w, day, meal, code);
        addLog(w, now, 'queued', `${nm(w, code)} (${code}) checked in · #${pos} in queue`);
        res = { ok: true, msg: `${mb.profile.first} checked in · #${pos} in queue`, tone: 'amber', fx: 'checkin' };
        break;
      }
      case 'serve':
      case 'serveNext': {
        if (!t) return fail('Unknown corps member.');
        if (t.status === 'rollover' && !t.redeemedAt) {
          if (st.remaining <= 0) return fail('Still no plates. Add the next batch first.');
          t.redeemedAt = now; t.servedAt = now; t.priority = true;
          addLog(w, now, 'served', `${nm(w, code)} served with Priority Pass (next batch)`);
          res = { ok: true, msg: `${mb.profile.first} served · priority pass`, tone: 'green', fx: 'served' };
          break;
        }
        if (t.status !== 'queued') return fail('Scan the gate check-in first (Step 1).');
        if (st.remaining <= 0) {
          exhaust(w, day, meal, now, 'no plates left at the serving point');
          res = { ok: true, msg: 'Food finished · Priority Rollover issued', tone: 'violet', fx: 'rollover' };
          break;
        }
        t.status = 'served'; t.servedAt = now;
        addLog(w, now, 'served', `${nm(w, code)} served · plate handed over`);
        if (st.remaining - 1 === 0) exhaust(w, day, meal, now, 'last plate served');
        res = { ok: true, msg: `${mb.profile.first} served · plate handed over`, tone: 'green', fx: 'served', code };
        break;
      }
      case 'undoServe': {
        if (!t) return fail('Unknown corps member.');
        if (!t.servedAt || now - t.servedAt > 5 * 60000) return fail('Too late to undo.');
        if (t.status === 'rollover' && t.redeemedAt) { delete t.redeemedAt; delete t.servedAt; delete t.priority; }
        else if (t.status === 'served') { t.status = 'queued'; delete t.servedAt; }
        else return fail('Nothing to undo.');
        addLog(w, now, 'info', `${nm(w, code)}: serve undone`);
        res = { ok: true, msg: `Undone · ${mb.profile.first} back in line`, tone: 'amber' };
        break;
      }
      case 'addPlates': {
        const n = Math.max(1, Math.min(500, a.n | 0));
        w.kitchen[day][meal].cooked += n;
        addLog(w, now, 'info', `${MEAL[meal].name}: +${n} plate${n > 1 ? 's' : ''} added${n > 1 ? ' (next batch)' : ''}`);
        res = { ok: true, msg: `+${n} plate${n > 1 ? 's' : ''} added`, tone: 'green', quiet: n === 1 };
        break;
      }
      case 'removePlate': {
        if (st.remaining <= 0) return fail('No plates left.');
        w.kitchen[day][meal].cooked -= 1;
        let rolled = [];
        if (st.remaining - 1 === 0) rolled = exhaust(w, day, meal, now, 'last plate gone');
        res = rolled.length ? { ok: true, msg: 'Out of plates · queue moved to Priority Rollover', tone: 'violet', fx: 'rollover' } : { ok: true, quiet: true };
        break;
      }
      case 'finish': {
        if (st.remaining <= 0) return fail('Rations are already at 0.');
        w.kitchen[day][meal].cooked = st.served;
        const rolled = exhaust(w, day, meal, now, 'food finished');
        if (!rolled.length) addLog(w, now, 'alert', `${MEAL[meal].name}: food finished (rations set to 0)`);
        res = { ok: true, msg: rolled.length ? `Food finished · ${rolled.length} priority passes issued` : 'Rations set to 0', tone: rolled.length ? 'violet' : 'red', fx: 'finish' };
        break;
      }
      case 'profile': {
        if (!mb) return fail('Unknown corps member.');
        ['first', 'last'].forEach((f) => { if (typeof a[f] === 'string' && a[f].trim()) mb.profile[f] = a[f].trim().slice(0, 40); });
        mb.profile.u = now;
        res = { ok: true, msg: 'Profile updated', tone: 'green' };
        break;
      }
      case 'reset': {
        const keep = {};
        for (const c in w.members) keep[c] = w.members[c].profile;
        const fresh = seedWorld(day, now);
        for (const c in keep) if (fresh.members[c]) {
          const k = keep[c]; Object.assign(fresh.members[c].profile, { first: k.first, last: k.last }, k.u ? { u: k.u } : {});
        }
        const rev = w.rev;
        Object.keys(w).forEach((key) => delete w[key]);
        Object.assign(w, fresh, { rev, resetAt: now }); // everything older than this is dropped on every phone
        res = { ok: true, msg: 'Demo reset · fresh tickets & rations', tone: 'green' };
        break;
      }
      default:
        return fail('Unknown action.');
    }
    if (a.type !== 'reset') stampDay(w, day, before, now);
    w.rev = (w.rev || 0) + 1;
    return res;
  }

  return { MEALS, MEAL, PLATOONS, DEMO_CODE, VERSION: 6, WINDOW_MS, hmacHex, memberSecret, merge, slim, makeQR, parseQR, verifyQR, qrWindow, BATCH, CAMP, CLEARANCE, TODAY_MENU, dkey, shiftDay, currentMeal, seedWorld, ensureDay, apply, stats, queuePos, pendingRollover };
});
