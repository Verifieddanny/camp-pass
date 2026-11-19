// Run with: npm test
const assert = require('assert');
const E = require('../public/engine.js');
const day = '2026-11-18', code = E.DEMO_CODE;
const fresh = () => E.seedWorld(day, Date.now());
const t = (w, meal = 'lunch', c = code) => w.members[c].tickets[day][meal];
const st = (w, meal = 'lunch') => E.stats(w, day, meal);

// Seed: real people already served and waiting; counts derived from them
let w = fresh();
assert.strictEqual(Object.keys(w.members).length, 40);
assert.strictEqual(st(w).served, 14);
assert.strictEqual(st(w).queue.length, 7);
assert.strictEqual(st(w).remaining, 26);

// Happy path: ready -> queued (joins the back) -> served
assert.ok(E.apply(w, { type: 'checkin', day, meal: 'lunch', code }).ok);
assert.strictEqual(t(w).status, 'queued');
assert.strictEqual(E.queuePos(w, day, 'lunch', code), 8);
// Serving the person at the front moves everyone up
E.apply(w, { type: 'serveNext', day, meal: 'lunch' });
assert.strictEqual(E.queuePos(w, day, 'lunch', code), 7);
assert.ok(E.apply(w, { type: 'serve', day, meal: 'lunch', code }).ok);
assert.strictEqual(t(w).status, 'served');
assert.strictEqual(st(w).served, 16);
assert.ok(!E.apply(w, { type: 'checkin', day, meal: 'lunch', code }).ok, 'no double use');

// Food finishes while queued -> everyone in queue gets priority, then served from next batch first
w = fresh();
E.apply(w, { type: 'checkin', day, meal: 'dinner', code });
E.apply(w, { type: 'finish', day, meal: 'dinner' });
assert.strictEqual(t(w, 'dinner').status, 'rollover');
assert.strictEqual(st(w, 'dinner').remaining, 0);
assert.strictEqual(st(w, 'dinner').rollovers, 8);
assert.ok(!E.apply(w, { type: 'serve', day, meal: 'dinner', code }).ok, 'cannot serve with 0 plates');
E.apply(w, { type: 'addPlates', day, meal: 'dinner', n: 20 });
assert.ok(E.apply(w, { type: 'serve', day, meal: 'dinner', code }).ok);
assert.ok(t(w, 'dinner').redeemedAt);

// Gate check-in refused when out of food (ticket stays valid)
w = fresh();
E.apply(w, { type: 'finish', day, meal: 'breakfast' });
assert.ok(!E.apply(w, { type: 'checkin', day, meal: 'breakfast', code }).ok);
assert.strictEqual(t(w, 'breakfast').status, 'ready');

// Serving the last plate rolls over whoever is still waiting
w = fresh();
E.apply(w, { type: 'checkin', day, meal: 'lunch', code });
w.kitchen[day].lunch.cooked = st(w).served + 1;
E.apply(w, { type: 'serveNext', day, meal: 'lunch' });
assert.strictEqual(t(w).status, 'rollover');
assert.strictEqual(st(w).queue.length, 0);

// Platoon audit is derived from records
w = fresh();
const pl = st(w).platoons; let s = 0; for (const p in pl) s += pl[p].s;
assert.strictEqual(s, st(w).served);

// Meal times
assert.strictEqual(E.currentMeal(new Date(2026, 10, 18, 7, 0)), 'breakfast');
assert.strictEqual(E.currentMeal(new Date(2026, 10, 18, 14, 10)), 'lunch');
assert.strictEqual(E.currentMeal(new Date(2026, 10, 18, 19, 0)), 'dinner');

// Reset keeps names
w = fresh();
E.apply(w, { type: 'profile', day, code, first: 'Ngozi', last: 'Obi' });
E.apply(w, { type: 'checkin', day, meal: 'lunch', code });
E.apply(w, { type: 'reset', day });
assert.strictEqual(w.members[code].profile.first, 'Ngozi');
assert.strictEqual(t(w).status, 'ready');
console.log('All engine tests passed');

// Live QR: signed per member, changes every 30 s, old codes and fakes are rejected
{
  const w = fresh(), sec = w.members[code].secret, now = Date.now();
  const qr = E.makeQR(sec, code, day, 'lunch', 'M', now);
  assert.ok(E.verifyQR(w, qr, now).ok);
  assert.notStrictEqual(qr, E.makeQR(sec, code, day, 'lunch', 'M', now + 30000), 'code changes each window');
  assert.strictEqual(E.verifyQR(w, qr, now + 95000).reason, 'expired', 'screenshot of an old code');
  const forged = qr.replace(/[0-9A-F]{12}$/, 'ABCDEF123456');
  assert.strictEqual(E.verifyQR(w, forged, now).reason, 'invalid');
  assert.ok(E.apply(w, { type: 'checkin', day, meal: 'lunch', code, qr, at: now }).ok);
  const old = E.makeQR(sec, code, day, 'lunch', 'M', now - 120000);
  assert.strictEqual(E.apply(w, { type: 'serve', day, meal: 'lunch', code, qr: old, at: now }).msg, 'Code expired');
}

// Undo a serve: back in line, plate count restored
{
  const w = fresh();
  E.apply(w, { type: 'checkin', day, meal: 'lunch', code });
  const before = st(w).remaining;
  E.apply(w, { type: 'serve', day, meal: 'lunch', code });
  assert.strictEqual(st(w).remaining, before - 1);
  assert.ok(E.apply(w, { type: 'undoServe', day, meal: 'lunch', code }).ok);
  assert.strictEqual(t(w).status, 'queued');
  assert.strictEqual(st(w).remaining, before);
  // undo a priority serve: back to an unredeemed priority pass
  E.apply(w, { type: 'finish', day, meal: 'lunch' });
  E.apply(w, { type: 'addPlates', day, meal: 'lunch', n: 5 });
  E.apply(w, { type: 'serve', day, meal: 'lunch', code });
  E.apply(w, { type: 'undoServe', day, meal: 'lunch', code });
  assert.strictEqual(t(w).status, 'rollover'); assert.ok(!t(w).redeemedAt);
}
console.log('Live QR and undo tests passed');
