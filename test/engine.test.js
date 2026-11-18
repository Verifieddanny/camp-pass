// Run with: npm test
const assert = require('assert');
const E = require('../public/engine.js');
const day = '2026-11-18', code = E.DEMO_CODE;
const fresh = () => E.seedWorld(day, Date.now());
const t = (w, meal = 'lunch', c = code) => w.members[c].tickets[day][meal];

// Happy path: ready -> queued -> served
let w = fresh();
assert.strictEqual(t(w).status, 'ready');
assert.ok(E.apply(w, { type: 'checkin', day, meal: 'lunch', code }).ok);
assert.strictEqual(t(w).status, 'queued');
assert.strictEqual(t(w).queuePos, 32);
const before = w.kitchen[day].lunch.served;
assert.ok(E.apply(w, { type: 'serve', day, meal: 'lunch', code }).ok);
assert.strictEqual(t(w).status, 'served');
assert.strictEqual(w.kitchen[day].lunch.served, before + 1);
assert.ok(!E.apply(w, { type: 'checkin', day, meal: 'lunch', code }).ok, 'no double use');

// Food finishes while queued -> priority rollover, then redeemed from next batch
w = fresh();
E.apply(w, { type: 'checkin', day, meal: 'dinner', code });
E.apply(w, { type: 'finish', day, meal: 'dinner' });
assert.strictEqual(t(w, 'dinner').status, 'rollover');
assert.strictEqual(E.remaining(w.kitchen[day].dinner), 0);
assert.ok(w.kitchen[day].dinner.rollovers >= 27);
assert.ok(!E.apply(w, { type: 'serve', day, meal: 'dinner', code }).ok, 'cannot serve with 0 plates');
E.apply(w, { type: 'addPlates', day, meal: 'dinner', n: 50 });
assert.ok(E.apply(w, { type: 'serve', day, meal: 'dinner', code }).ok);
assert.ok(t(w, 'dinner').redeemedAt);

// Gate check-in refused when out of food (ticket stays valid)
w = fresh();
E.apply(w, { type: 'finish', day, meal: 'breakfast' });
assert.ok(!E.apply(w, { type: 'checkin', day, meal: 'breakfast', code }).ok);
assert.strictEqual(t(w, 'breakfast').status, 'ready');

// Serving the last plate to others rolls over remaining queue
w = fresh();
E.apply(w, { type: 'checkin', day, meal: 'lunch', code });
const k = w.kitchen[day].lunch; k.cooked = k.served + 1;
E.apply(w, { type: 'serveOther', day, meal: 'lunch' });
assert.strictEqual(t(w).status, 'rollover');

// Reset keeps names
w = fresh();
E.apply(w, { type: 'profile', day, code, first: 'Ngozi', last: 'Obi' });
E.apply(w, { type: 'checkin', day, meal: 'lunch', code });
E.apply(w, { type: 'reset', day });
assert.strictEqual(w.members[code].profile.first, 'Ngozi');
assert.strictEqual(t(w).status, 'ready');
console.log('All engine tests passed');
