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
    { first: 'Adaeze', last: 'Okonkwo', stateCode: DEMO_CODE, platoon: 4, hostel: 'Block B', bunk: 'Bunk 14', institution: 'University of Nigeria, Nsukka', course: 'Computer Science', blood: 'O+', callUp: 'NYSC/UNN/2026/88214' },
    { first: 'Tunde', last: 'Bakare', stateCode: 'LA/26C/3307', platoon: 2, hostel: 'Block D', bunk: 'Bunk 03', institution: 'University of Ibadan', course: 'Economics', blood: 'A+', callUp: 'NYSC/UI/2026/41290' },
    { first: 'Fatima', last: 'Musa', stateCode: 'LA/26C/5120', platoon: 7, hostel: 'Block A', bunk: 'Bunk 22', institution: 'Ahmadu Bello University', course: 'Microbiology', blood: 'B+', callUp: 'NYSC/ABU/2026/10457' },
    { first: 'Chinedu', last: 'Eze', stateCode: 'LA/26C/1894', platoon: 4, hostel: 'Block B', bunk: 'Bunk 15', institution: 'Federal University of Technology, Owerri', course: 'Civil Engineering', blood: 'O-', callUp: 'NYSC/FUTO/2026/77301' },
    { first: 'Blessing', last: 'Akpan', stateCode: 'LA/26C/6631', platoon: 9, hostel: 'Block C', bunk: 'Bunk 08', institution: 'University of Uyo', course: 'Mass Communication', blood: 'AB+', callUp: 'NYSC/UNIUYO/2026/30118' }
  ];
  const FIRSTS = ['Emeka', 'Aisha', 'Segun', 'Ngozi', 'Ibrahim', 'Chiamaka', 'Yusuf', 'Funmilayo', 'Obinna', 'Zainab', 'Kelechi', 'Halima', 'Damilola', 'Uche', 'Hauwa', 'Tobi', 'Amarachi', 'Sani', 'Bukola', 'Ifeanyi', 'Kemi', 'Musa', 'Ebere', 'Femi', 'Nkechi', 'Abdullahi', 'Temitope', 'Chidi', 'Rukayat', 'Gbenga', 'Ada', 'Bashir', 'Folake', 'Nnamdi', 'Hadiza'];
  const LASTS = ['Okafor', 'Bello', 'Adeyemi', 'Nwosu', 'Abubakar', 'Okeke', 'Lawal', 'Oladipo', 'Eze', 'Usman', 'Obi', 'Danjuma', 'Afolabi', 'Igwe', 'Garba', 'Ogunleye', 'Chukwu', 'Aliyu', 'Balogun', 'Onyeka', 'Adebayo', 'Ibrahim', 'Okoro', 'Fashola', 'Nnadi', 'Shehu', 'Oyelaran', 'Anozie', 'Yakubu', 'Ojo', 'Mbah', 'Sule', 'Adewale', 'Ezeh', 'Mohammed'];
  const SCHOOLS = ['University of Lagos', 'Obafemi Awolowo University', 'University of Benin', 'Bayero University Kano', 'Lagos State University', 'Covenant University', 'University of Ilorin', 'Nnamdi Azikiwe University'];
  const COURSES = ['Accounting', 'Law', 'Biochemistry', 'Electrical Engineering', 'English', 'Nursing', 'Political Science', 'Architecture', 'Statistics', 'Agriculture'];
  const BLOOD = ['O+', 'A+', 'B+', 'O-', 'AB+'];

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
        platoon: 1 + (i % PLATOONS), hostel: `Block ${blocks[i % 5]}`, bunk: `Bunk ${pad(1 + Math.floor(r() * 30))}`,
        institution: SCHOOLS[i % SCHOOLS.length], course: COURSES[i % COURSES.length], blood: BLOOD[i % BLOOD.length],
        callUp: `NYSC/2026/${10000 + Math.floor(r() * 89999)}`
      });
    }
    return out;
  }

  function freshDayTickets() {
    const out = {};
    MEALS.forEach((m) => (out[m.id] = { status: 'ready', menu: TODAY_MENU[m.id] }));
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
    const w = { v: 3, rev: 1, members, kitchen: {}, log: [] };
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

  function token(code, day, meal, kind) {
    const s = code + day + meal + kind;
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(16).toUpperCase().padStart(8, '0').slice(0, 6);
  }

  // Plates ran out: nobody still in the queue is silently "ticked". They all roll over.
  function exhaust(w, day, meal, now, reason) {
    const q = stats(w, day, meal).queue;
    q.forEach((x) => { x.t.status = 'rollover'; x.t.rolledAt = now; });
    if (q.length) addLog(w, now, 'alert', `${MEAL[meal].name}: ${reason}. ${q.length} corps member${q.length > 1 ? 's' : ''} in queue issued Priority Rollover Passes`);
    return q.map((x) => x.code);
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
    let res;

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

  return { MEALS, MEAL, PLATOONS, DEMO_CODE, VERSION: 3, dkey, shiftDay, currentMeal, seedWorld, ensureDay, apply, stats, queuePos, pendingRollover, token };
});
