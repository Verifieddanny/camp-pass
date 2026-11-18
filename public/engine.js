/*
 * CampPass engine: the meal-ticket state machine and demo seed data.
 * The same file runs on the server (Node) and in the browser, so the app
 * behaves identically online and offline.
 *
 *   READY --(gate check-in)--> QUEUED --(plate handover)--> SERVED
 *                                 \--(rations hit 0)--> ROLLOVER --(next batch)--> REDEEMED
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CampEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MEALS = [
    { id: 'breakfast', name: 'Breakfast', emoji: '🍞', time: '7:00 – 9:00 AM', short: '7 AM', hour: 7 },
    { id: 'lunch', name: 'Lunch', emoji: '🍛', time: '1:00 – 3:00 PM', short: '1 PM', hour: 13 },
    { id: 'dinner', name: 'Dinner', emoji: '🍲', time: '7:00 – 9:00 PM', short: '7 PM', hour: 19 }
  ];
  const MEAL = Object.fromEntries(MEALS.map((m) => [m.id, m]));
  const PLATOONS = 10;
  const DEMO_CODE = 'LA/26C/4012';

  const TODAY_MENU = { breakfast: 'Bread, tea & omelette', lunch: 'Jollof rice & chicken', dinner: 'Eba & egusi soup' };
  const PAST_MENU = {
    breakfast: ['Bread, tea & egg', 'Pap & akara', 'Yam & egg sauce', 'Bread & beans', 'Custard & moi moi'],
    lunch: ['Jollof rice & chicken', 'White rice & stew', 'Beans & plantain', 'Fried rice & fish', 'Amala & ewedu'],
    dinner: ['Eba & egusi', 'Spaghetti & fish', 'Semo & okra', 'Rice & beans', 'Yam porridge']
  };

  const PEOPLE = [
    { first: 'Adaeze', last: 'Okonkwo', stateCode: DEMO_CODE, platoon: 4, hostel: 'Block B', bunk: 'Bunk 14', institution: 'University of Nigeria, Nsukka', course: 'Computer Science', blood: 'O+', callUp: 'NYSC/UNN/2026/88214' },
    { first: 'Tunde', last: 'Bakare', stateCode: 'LA/26C/3307', platoon: 2, hostel: 'Block D', bunk: 'Bunk 03', institution: 'University of Ibadan', course: 'Economics', blood: 'A+', callUp: 'NYSC/UI/2026/41290' },
    { first: 'Fatima', last: 'Musa', stateCode: 'LA/26C/5120', platoon: 7, hostel: 'Block A', bunk: 'Bunk 22', institution: 'Ahmadu Bello University', course: 'Microbiology', blood: 'B+', callUp: 'NYSC/ABU/2026/10457' },
    { first: 'Chinedu', last: 'Eze', stateCode: 'LA/26C/1894', platoon: 4, hostel: 'Block B', bunk: 'Bunk 15', institution: 'Federal University of Technology, Owerri', course: 'Civil Engineering', blood: 'O-', callUp: 'NYSC/FUTO/2026/77301' },
    { first: 'Blessing', last: 'Akpan', stateCode: 'LA/26C/6631', platoon: 9, hostel: 'Block C', bunk: 'Bunk 08', institution: 'University of Uyo', course: 'Mass Communication', blood: 'AB+', callUp: 'NYSC/UNIUYO/2026/30118' }
  ];

  const pad = (n) => String(n).padStart(2, '0');
  const dkey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseDay = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
  const shiftDay = (k, n) => { const d = parseDay(k); d.setDate(d.getDate() + n); return dkey(d); };
  const at = (k, h, m) => { const d = parseDay(k); d.setHours(h, m, 0, 0); return d.getTime(); };
  function rng(seed) { let s = seed >>> 0; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; }

  /* ---------------- Seed ---------------- */
  function seedKitchenDay(seed) {
    const r = rng(seed);
    const base = { breakfast: [150, 118, 19], lunch: [150, 97, 31], dinner: [150, 72, 26] };
    const out = {};
    for (const m of MEALS) {
      const [cooked, served, queue] = base[m.id];
      const platoons = {};
      let left = served;
      for (let p = 1; p <= PLATOONS; p++) {
        const want = p === PLATOONS ? left : Math.max(0, Math.round(served / PLATOONS + (r() - 0.5) * 6));
        const s = Math.min(want, left);
        platoons[p] = { s, r: 0 };
        left -= s;
      }
      out[m.id] = { cooked, served, queue, rollovers: 0, platoons };
    }
    return out;
  }

  function freshDayTickets(menu) {
    const out = {};
    MEALS.forEach((m) => (out[m.id] = { status: 'ready', menu: menu ? menu[m.id] : 'Camp kitchen menu' }));
    return out;
  }

  function seedMember(person, today, idx) {
    const tickets = {};
    for (let i = 5; i >= 1; i--) {
      const k = shiftDay(today, -i);
      const r = rng(i * 97 + idx * 13);
      tickets[k] = {};
      MEALS.forEach((m) => {
        const qIn = at(k, m.hour, 5 + Math.floor(r() * 40));
        let t = { status: 'served', checkedInAt: qIn, servedAt: qIn + (6 + Math.floor(r() * 14)) * 60000, queuePos: 5 + Math.floor(r() * 30), menu: PAST_MENU[m.id][i - 1] };
        if (idx === 0 && i === 3 && m.id === 'lunch') {
          t = { status: 'rollover', checkedInAt: qIn, rolledAt: qIn + 19 * 60000, queuePos: 42, menu: PAST_MENU.lunch[i - 1], redeemedAt: at(k, 19, 4), redeemedWith: 'dinner' };
        }
        if (idx === 0 && i === 3 && m.id === 'dinner') { t.priority = true; t.queuePos = 1; t.checkedInAt = at(k, 19, 4); t.servedAt = at(k, 19, 6); }
        if (idx === 0 && i === 2 && m.id === 'breakfast') t = { status: 'missed', menu: PAST_MENU.breakfast[i - 1] };
        tickets[k][m.id] = t;
      });
    }
    tickets[today] = freshDayTickets(TODAY_MENU);
    const d6 = shiftDay(today, -6), d5 = shiftDay(today, -5), d4 = shiftDay(today, -4);
    return {
      profile: Object.assign({ batch: '2026 Batch C · Stream I', camp: 'Iyana-Ipaja Orientation Camp, Lagos' }, person),
      clearance: [
        { id: 'reg', name: 'Registration & Documentation', note: 'Verified at registration desk', ok: true, at: at(d6, 10, 12) },
        { id: 'clinic', name: 'Camp Clinic Medical Check', note: 'Fit for camp activities', ok: true, at: at(d6, 12, 40) },
        { id: 'kit', name: 'Kit Issue', note: 'Khaki, white kit, jungle boots, crested vest', ok: true, at: at(d5, 9, 15) },
        { id: 'obs', name: "OBS (Man O'War) Drills", note: 'Complete the obstacle course', ok: idx % 2 === 1, at: at(d4, 8, 30) },
        { id: 'saed', name: 'SAED Training', note: 'Skill: ICT / Web Development', ok: false },
        { id: 'pay', name: 'Bank & Allowance Verification', note: 'BVN and account confirmed', ok: true, at: at(d4, 14, 2) }
      ],
      tickets
    };
  }

  function seedWorld(today, now) {
    now = now || Date.now();
    const members = {};
    PEOPLE.forEach((p, i) => (members[p.stateCode] = seedMember(p, today, i)));
    return {
      v: 2,
      rev: 1,
      members,
      kitchen: { [today]: seedKitchenDay(4012) },
      log: [
        { t: now - 12 * 60000, type: 'info', msg: 'Ration count synced from kitchen' },
        { t: now - 26 * 60000, type: 'served', msg: 'Batch of 40 plates served at Kitchen Gate A' }
      ]
    };
  }

  /* ---------------- Helpers ---------------- */
  function ensureDay(w, day) {
    if (!w.kitchen[day]) w.kitchen[day] = seedKitchenDay(parseInt(day.replace(/-/g, ''), 10) % 100000);
    for (const code in w.members) {
      const mb = w.members[code];
      if (!mb.tickets[day]) mb.tickets[day] = freshDayTickets(TODAY_MENU);
    }
  }
  const remaining = (k) => Math.max(0, k.cooked - k.served);
  function queuedMembers(w, day, meal) {
    return Object.keys(w.members).filter((c) => w.members[c].tickets[day] && w.members[c].tickets[day][meal].status === 'queued');
  }
  const inQueue = (w, day, meal) => w.kitchen[day][meal].queue + queuedMembers(w, day, meal).length;
  const plat = (k, p) => k.platoons[p] || (k.platoons[p] = { s: 0, r: 0 });
  const randPlatoon = () => 1 + Math.floor(Math.random() * PLATOONS);
  function addLog(w, t, type, msg) { w.log.unshift({ t, type, msg }); if (w.log.length > 60) w.log.length = 60; }

  function pendingRollover(w, code, day) {
    const tk = w.members[code] && w.members[code].tickets[day];
    if (!tk) return null;
    for (const m of MEALS) { const t = tk[m.id]; if (t.status === 'rollover' && !t.redeemedAt) return { meal: m.id, t }; }
    return null;
  }

  function token(code, day, meal, kind) {
    const s = code + day + meal + kind;
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(16).toUpperCase().padStart(8, '0').slice(0, 6);
  }

  function rolloverMember(w, day, meal, code, now, why) {
    const mb = w.members[code], t = mb.tickets[day][meal], k = w.kitchen[day][meal];
    t.status = 'rollover'; t.rolledAt = now; t.reason = why;
    plat(k, mb.profile.platoon).r++; k.rollovers++;
    addLog(w, now, 'rollover', `${code} UNSERVED · auto-issued Priority Rollover Pass`);
  }

  // When plates hit 0, nobody still in the queue is silently "ticked": they all roll over.
  function exhaust(w, day, meal, now, reason) {
    const k = w.kitchen[day][meal];
    const others = k.queue;
    for (let i = 0; i < others; i++) plat(k, randPlatoon()).r++;
    k.rollovers += others; k.queue = 0;
    const members = queuedMembers(w, day, meal);
    members.forEach((c) => rolloverMember(w, day, meal, c, now, 'Rations ran out while you were in the queue'));
    const total = others + members.length;
    if (total) addLog(w, now, 'alert', `${MEAL[meal].name}: ${reason}. ${total} corps members in queue protected with Priority Rollover`);
    return members;
  }

  /* ---------------- Actions ---------------- */
  // Every action: { type, day, meal, code?, at? }. Returns { ok, msg, tone, fx }.
  function apply(w, a) {
    const day = a.day, meal = a.meal, now = a.at || Date.now();
    ensureDay(w, day);
    const k = meal ? w.kitchen[day][meal] : null;
    const mb = a.code ? w.members[a.code] : null;
    const t = mb && meal ? mb.tickets[day][meal] : null;
    const fail = (msg) => ({ ok: false, msg, tone: 'red' });
    let res;

    switch (a.type) {
      case 'checkin': {
        if (!t) return fail('Unknown corps member.');
        if (t.status !== 'ready') return fail('This ticket has already been checked in.');
        if (remaining(k) <= 0) return fail('Kitchen is out of plates. Ticket NOT marked, so it stays valid.');
        t.status = 'queued'; t.checkedInAt = now; t.queuePos = inQueue(w, day, meal);
        addLog(w, now, 'queued', `${a.code} checked in for ${MEAL[meal].name} · #${t.queuePos} in queue · 1 ration reserved`);
        res = { ok: true, msg: `Checked in · #${t.queuePos} in queue`, tone: 'amber', fx: 'checkin' };
        break;
      }
      case 'serve': {
        if (!t) return fail('Unknown corps member.');
        if (t.status === 'rollover' && !t.redeemedAt) {
          if (remaining(k) <= 0) return fail('Still no plates. Add the next batch first.');
          k.served++; plat(k, mb.profile.platoon).s++;
          t.redeemedAt = now; t.servedAt = now; t.redeemedWith = meal; t.priority = true;
          addLog(w, now, 'served', `PRIORITY pass redeemed for ${a.code} · plate handed over from next batch`);
          res = { ok: true, msg: 'Priority pass redeemed · Served', tone: 'green', fx: 'served' };
          break;
        }
        if (t.status !== 'queued') return fail('Scan the gate check-in first (Step 1).');
        if (remaining(k) <= 0) {
          exhaust(w, day, meal, now, 'no plates left at the serving point');
          res = { ok: true, msg: 'Food finished · Priority Rollover Pass issued', tone: 'violet', fx: 'rollover' };
          break;
        }
        k.served++; plat(k, mb.profile.platoon).s++;
        t.status = 'served'; t.servedAt = now;
        addLog(w, now, 'served', `${a.code} served ${MEAL[meal].name} · plate handover confirmed`);
        if (remaining(k) === 0) exhaust(w, day, meal, now, 'last plate served');
        res = { ok: true, msg: 'Plate handed over · Served', tone: 'green', fx: 'served' };
        break;
      }
      case 'serveOther': {
        if (remaining(k) <= 0) return fail('No plates left to serve.');
        k.served++; plat(k, randPlatoon()).s++;
        if (k.queue > 0) {
          k.queue--;
          queuedMembers(w, day, meal).forEach((c) => { const q = w.members[c].tickets[day][meal]; if (q.queuePos > 1) q.queuePos--; });
        }
        let rolled = [];
        if (remaining(k) === 0) rolled = exhaust(w, day, meal, now, 'last plate served');
        res = rolled.length ? { ok: true, msg: 'Last plate gone · queue moved to Priority Rollover', tone: 'violet', fx: 'rollover' } : { ok: true, quiet: true };
        break;
      }
      case 'addPlates': {
        const n = Math.max(1, Math.min(500, a.n | 0));
        k.cooked += n;
        if (n > 1) addLog(w, now, 'info', `New batch: +${n} plates added for ${MEAL[meal].name}`);
        res = n > 1 ? { ok: true, msg: `+${n} plates from next batch`, tone: 'green' } : { ok: true, quiet: true };
        break;
      }
      case 'finish': {
        if (remaining(k) <= 0) return fail('Rations are already at 0.');
        k.cooked = k.served;
        const rolled = exhaust(w, day, meal, now, 'food finished');
        if (!rolled.length && !k.rollovers) addLog(w, now, 'alert', `${MEAL[meal].name}: food finished (rations set to 0)`);
        res = { ok: true, msg: rolled.length ? 'Food finished · Priority Rollover Pass issued' : 'Rations set to 0', tone: rolled.length ? 'violet' : 'red', fx: 'finish' };
        break;
      }
      case 'profile': {
        if (!mb) return fail('Unknown corps member.');
        ['first', 'last'].forEach((f) => { if (typeof a[f] === 'string' && a[f].trim()) mb.profile[f] = a[f].trim().slice(0, 40); });
        res = { ok: true, msg: 'Profile updated', tone: 'green' };
        break;
      }
      case 'reset': {
        const keep = {};
        for (const c in w.members) keep[c] = { first: w.members[c].profile.first, last: w.members[c].profile.last };
        const fresh = seedWorld(day, now);
        for (const c in keep) if (fresh.members[c]) Object.assign(fresh.members[c].profile, keep[c]);
        const rev = w.rev;
        Object.keys(w).forEach((key) => delete w[key]);
        Object.assign(w, fresh, { rev });
        res = { ok: true, msg: 'Demo reset · fresh tickets & rations', tone: 'green' };
        break;
      }
      default:
        return fail('Unknown action.');
    }
    w.rev = (w.rev || 0) + 1;
    return res;
  }

  return { MEALS, MEAL, PLATOONS, DEMO_CODE, dkey, shiftDay, seedWorld, ensureDay, apply, remaining, inQueue, queuedMembers, pendingRollover, token };
});
