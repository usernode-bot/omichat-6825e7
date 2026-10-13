const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../public/js/safety.js');

const NOW = new Date(Date.UTC(2026, 9, 13)); // 2026-10-13

function services(extra) {
  return S.createMockServices(Object.assign(
    { store: S.makeStore(null), latency: 0, reviewMs: 1000, now: () => NOW.getTime() }, extra));
}

test('age gate: 18th birthday today passes, one day short is under 18', () => {
  assert.equal(S.checkAge('2008-10-13', NOW).ok, true);
  const short = S.checkAge('2008-10-14', NOW);
  assert.equal(short.ok, false);
  assert.equal(short.reason, 'underage');
});

test('age gate: rejects missing, malformed, impossible and future dates', () => {
  for (const bad of ['', null, 'abc', '2000-02-31', '2999-01-01', '1800-01-01']) {
    assert.equal(S.checkAge(bad, NOW).reason, 'invalid', String(bad));
  }
});

test('age gate: an under-18 result is final on the device', async () => {
  const s = services();
  assert.equal((await s.age.submit('2015-01-01')).reason, 'underage');
  assert.equal(s.age.get().status, 'blocked');
  // Retrying with an adult date does not unlock it.
  assert.equal((await s.age.submit('1990-01-01')).ok, false);
  assert.equal(s.age.get().status, 'blocked');
});

test('age gate: an adult passes and the date of birth is not stored', async () => {
  const store = S.makeStore(null);
  const s = services({ store });
  assert.equal((await s.age.submit('1990-05-05')).ok, true);
  assert.equal(s.age.get().status, 'passed');
  assert.equal(JSON.stringify(store.get('omichat.age')).includes('1990'), false);
});

test('report: needs a known reason, trims and caps the note', async () => {
  const s = services();
  await assert.rejects(s.reports.submit({ profileId: 1, reason: 'nope' }));
  await s.reports.submit({ profileId: 1, reason: 'spam', note: '  hi ' + 'x'.repeat(900) });
  const [r] = await s.reports.list();
  assert.equal(r.reason, 'spam');
  assert.equal(r.note.length, S.REPORT_NOTE_MAX);
  assert.equal(S.REPORT_REASONS.length, 6);
});

test('report: a failed call surfaces an error and stores nothing', async () => {
  const s = services();
  s.failNext('report');
  await assert.rejects(s.reports.submit({ profileId: 1, reason: 'spam' }));
  assert.equal((await s.reports.list()).length, 0);
});

test('block: is permanent, de-duplicated and has no unblock', async () => {
  const store = S.makeStore(null);
  const s = services({ store });
  await s.blocks.block(4);
  await s.blocks.block(4);
  assert.deepEqual(s.blocks.list(), [4]);
  // A fresh service over the same storage (a reload) still has the block.
  assert.deepEqual(services({ store }).blocks.list(), [4]);
  assert.equal(s.blocks.unblock, undefined);
});

test('block: a failed call leaves the list unchanged', async () => {
  const s = services();
  s.failNext('block');
  await assert.rejects(s.blocks.block(2));
  assert.deepEqual(s.blocks.list(), []);
});

test('selfie: pending, then verified or rejected by the mock review', async () => {
  let t = NOW.getTime();
  const s = services({ now: () => t });
  assert.equal((await s.verification.getStatus()).status, 'none');
  await s.verification.submitSelfie({ brightness: 120 });
  assert.equal((await s.verification.getStatus()).status, 'pending');
  t += 1000;
  assert.equal((await s.verification.getStatus()).status, 'verified');

  await s.verification.reset();
  await s.verification.submitSelfie({ brightness: 3 }); // covered lens
  t += 1000;
  const r = await s.verification.getStatus();
  assert.equal(r.status, 'rejected');
  assert.ok(r.reason);
});

test('selfie: an unreadable photo or a service failure is an error', async () => {
  const s = services();
  await assert.rejects(s.verification.submitSelfie({}));
  s.failNext('selfie');
  await assert.rejects(s.verification.submitSelfie({ brightness: 100 }));
  assert.equal((await s.verification.getStatus()).status, 'none');
});

test('privacy: both toggles default off, persist, and failures do not save', async () => {
  const store = S.makeStore(null);
  const s = services({ store });
  assert.deepEqual(s.privacy.get(), { hideDistance: false, hideOnlineStatus: false });
  await s.privacy.update({ hideDistance: true });
  assert.deepEqual(services({ store }).privacy.get(), { hideDistance: true, hideOnlineStatus: false });
  s.failNext('privacy');
  await assert.rejects(s.privacy.update({ hideOnlineStatus: true }));
  assert.equal(s.privacy.get().hideOnlineStatus, false);
});

test('services can be swapped for another backend', () => {
  const fake = { marker: 1 };
  S.configure(fake);
  assert.equal(S.services(), fake);
  S.configure(null);
});

test('store: writes through to a localStorage-style backing', () => {
  const data = {};
  const backing = {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = v; },
  };
  S.makeStore(backing).set('omichat.blocked', [7]);
  assert.equal(data['omichat.blocked'], '[7]');
  assert.deepEqual(S.makeStore(backing).get('omichat.blocked', []), [7]);
});
