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

test('privacy: defaults, persists, reads the old two-switch shape, and failures do not save', async () => {
  const store = S.makeStore(null);
  const s = services({ store });
  assert.deepEqual(s.privacy.get(), {
    whoCanMessage: 'connections', whoCanSeeProfile: 'everyone',
    showOnlineStatus: true, hideDistance: false, hideOnlineStatus: false,
  });
  assert.equal(s.privacy.saved(), false);
  await s.privacy.update({ hideDistance: true, whoCanSeeProfile: 'said_hi' });
  const again = services({ store }).privacy.get();
  assert.equal(again.hideDistance, true);
  assert.equal(again.whoCanSeeProfile, 'said_hi');
  s.failNext('privacy');
  await assert.rejects(s.privacy.update({ showOnlineStatus: false }));
  assert.equal(s.privacy.get().showOnlineStatus, true);
  await assert.rejects(s.privacy.update({ whoCanMessage: 'nobody' }));

  // A device that saved the old { hideDistance, hideOnlineStatus } shape.
  const old = S.makeStore(null);
  old.set('omichat.privacy', { hideDistance: false, hideOnlineStatus: true });
  const p = services({ store: old }).privacy.get();
  assert.equal(p.showOnlineStatus, false);
  assert.equal(p.hideOnlineStatus, true);
});

test('validatePrivacy: drops unknown keys, rejects bad audiences, empty patch is the defaults', () => {
  assert.deepEqual(S.validatePrivacy({}).value, S.PRIVACY_DEFAULTS);
  assert.deepEqual(S.validatePrivacy(null).errors, {});
  const r = S.validatePrivacy({ whoCanMessage: 'everyone', isAdmin: true, showOnlineStatus: 0 });
  assert.equal(r.value.whoCanMessage, 'everyone');
  assert.equal(r.value.showOnlineStatus, false);
  assert.equal('isAdmin' in r.value, false);
  const bad = S.validatePrivacy({ whoCanSeeProfile: 'nobody' });
  assert.ok(bad.errors.whoCanSeeProfile);
  assert.equal(bad.value.whoCanSeeProfile, 'everyone');
});

test('import mapping: hideOnlineStatus true becomes showOnlineStatus false', () => {
  assert.equal(S.normalizePrivacy({ hideOnlineStatus: true }).showOnlineStatus, false);
  assert.equal(S.normalizePrivacy({ hideOnlineStatus: false }).showOnlineStatus, true);
  assert.equal(S.normalizePrivacy({ whoCanMessage: 'junk' }).whoCanMessage, 'connections');
});

const STRANGER = { blocked: false, saidHi: false, connected: false };
const SAID_HI = { blocked: false, saidHi: true, connected: false };
const CONNECTED = { blocked: false, saidHi: true, connected: true };
const BLOCKED = { blocked: true, saidHi: true, connected: true };

test('canMessage: Connections only by default, and a block always denies', () => {
  assert.equal(S.canMessage(STRANGER, null), false);
  assert.equal(S.canMessage(SAID_HI, null), false);
  assert.equal(S.canMessage(CONNECTED, null), true);
  assert.equal(S.canMessage(SAID_HI, { whoCanMessage: 'said_hi' }), true);
  assert.equal(S.canMessage(STRANGER, { whoCanMessage: 'said_hi' }), false);
  assert.equal(S.canMessage(STRANGER, { whoCanMessage: 'everyone' }), true);
  assert.equal(S.canMessage(BLOCKED, { whoCanMessage: 'everyone' }), false);
});

test('canSeeProfile: Everyone by default, narrower choices keep connections, a block denies', () => {
  assert.equal(S.canSeeProfile(STRANGER, null), true);
  assert.equal(S.canSeeProfile(STRANGER, { whoCanSeeProfile: 'said_hi' }), false);
  assert.equal(S.canSeeProfile(SAID_HI, { whoCanSeeProfile: 'said_hi' }), true);
  assert.equal(S.canSeeProfile(SAID_HI, { whoCanSeeProfile: 'connections' }), false);
  assert.equal(S.canSeeProfile(CONNECTED, { whoCanSeeProfile: 'connections' }), true);
  assert.equal(S.canSeeProfile(BLOCKED, null), false);
});

test('presenceVisible: only while both people show their online status', () => {
  assert.equal(S.presenceVisible(null, null), true);
  assert.equal(S.presenceVisible({ showOnlineStatus: false }, null), false);
  assert.equal(S.presenceVisible(null, { showOnlineStatus: false }), false);
});

test('message report: needs a message and a message reason; profile reasons stay separate', async () => {
  const s = services();
  await assert.rejects(s.reports.submit({ targetType: 'message', profileId: 1, messageId: 'm-1', reason: 'photos' }));
  await assert.rejects(s.reports.submit({ targetType: 'profile', profileId: 1, reason: 'scam' }));
  await assert.rejects(s.reports.submit({ targetType: 'message', profileId: 1, reason: 'spam' }));
  const { id } = await s.reports.submit({
    targetType: 'message', profileId: 1, targetName: 'Maya', messageId: 'm-1',
    messageText: 'hello', reason: 'scam',
  });
  const [r] = await s.reports.list();
  assert.equal(r.id, id);
  assert.equal(r.targetKey, 'mock:1');
  assert.equal(r.messageText, 'hello');
  assert.equal(S.MESSAGE_REPORT_REASONS.length, 5);
});

test('report: a second open report on the same person or message returns the same id', async () => {
  const s = services();
  const a = await s.reports.submit({ profileId: 2, reason: 'spam' });
  const b = await s.reports.submit({ profileId: 2, reason: 'fake' });
  assert.equal(a.id, b.id);
  const m = await s.reports.submit({ targetType: 'message', profileId: 2, messageId: 'm-9', reason: 'spam' });
  assert.notEqual(m.id, a.id);
  assert.equal((await s.reports.list()).length, 2);
});

test('canReportMessage: only texts someone else sent', () => {
  assert.equal(S.canReportMessage({ id: 'm-1', kind: 'text', from: 'them' }), true);
  assert.equal(S.canReportMessage({ id: 'm-3', kind: 'text', from: 'me' }), false);
  assert.equal(S.canReportMessage({ id: 'm-4', kind: 'hi', from: 'them' }), false);
  assert.equal(S.canReportMessage({ id: 'm-2', kind: 'connection', from: 'system' }), false);
});

test('block: entries carry the name and date for the Blocked people list', async () => {
  const s = services();
  await s.blocks.block(4, 'Jonas');
  assert.deepEqual(s.blocks.entries(), [{ key: 'mock:4', name: 'Jonas', at: NOW.getTime() }]);
});

test('server services: read the GET /api/safety answer and map keys back to ids', async () => {
  const calls = [];
  const api = async (path, o) => {
    calls.push([path, o && o.method, o && o.body]);
    if (path === '/api/blocks') {
      return { ok: true, json: async () => ({ blocked: [{ key: 'mock:3', name: 'Priya' }, { key: 'mock:5', name: 'Amara' }] }) };
    }
    if (path === '/api/privacy') {
      return { ok: true, json: async () => ({ privacy: { showOnlineStatus: false } }) };
    }
    return { ok: false, status: 429, json: async () => ({ error: 'You have sent a lot of reports today. Try again tomorrow.' }) };
  };
  const s = S.createServerServices({
    api, fallback: services(),
    initial: { privacy: { whoCanMessage: 'everyone' }, blocked: [{ key: 'mock:3', name: 'Priya' }, { key: 'user:42' }], canReview: true },
  });
  assert.deepEqual(s.blocks.list(), [3]);
  assert.equal(s.privacy.get().whoCanMessage, 'everyone');
  assert.equal(s.canReview(), true);
  await s.blocks.block(5, 'Amara');
  assert.deepEqual(calls[0], ['/api/blocks', 'POST', { key: 'mock:5', name: 'Amara' }]);
  assert.deepEqual(s.blocks.list(), [3, 5]);
  assert.equal((await s.privacy.update({ showOnlineStatus: false })).hideOnlineStatus, true);
  await assert.rejects(s.reports.submit({ profileId: 1, reason: 'spam' }), /a lot of reports/);
  assert.equal(calls[2][2].targetKey, 'mock:1');
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
