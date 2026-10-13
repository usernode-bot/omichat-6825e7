// Omichat Safety and Trust service layer.
//
// Everything the safety features need from a "backend" lives behind the
// service objects below (reports, blocks, selfie verification, privacy
// settings, age gate). Phase 1 backs them with localStorage and short mock
// latency; swapping in real endpoints means replacing the object passed to
// OmichatSafety.configure({ ... }) with one that has the same async methods.
// The UI never touches storage or fetch directly.
//
// Written as a UMD-style module so the pure logic can be tested in Node
// (see tests/safety.test.js) as well as loaded by the page.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OmichatSafety = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const root = typeof window !== 'undefined' ? window : globalThis;
  const MIN_AGE = 18;

  const REPORT_REASONS = [
    { id: 'fake', label: 'Fake profile' },
    { id: 'photos', label: 'Inappropriate photos' },
    { id: 'harassment', label: 'Harassment' },
    { id: 'underage', label: 'Underage' },
    { id: 'spam', label: 'Spam' },
    { id: 'other', label: 'Other' },
  ];
  const REPORT_NOTE_MAX = 500;

  // ------------------------------------------------------------ storage

  // localStorage when present, else a throwaway in-memory map (Node tests,
  // blocked storage in a sandboxed frame). Values are JSON.
  function makeStore(backing) {
    let mem = {};
    const ls = backing === undefined
      ? (function () { try { return root.localStorage || null; } catch (e) { return null; } })()
      : backing;
    return {
      get: function (key, fallback) {
        try {
          const raw = ls ? ls.getItem(key) : mem[key];
          return raw == null ? fallback : JSON.parse(raw);
        } catch (e) { return fallback; }
      },
      set: function (key, value) {
        const raw = JSON.stringify(value);
        try { if (ls) ls.setItem(key, raw); else mem[key] = raw; }
        catch (e) { mem[key] = raw; }
      },
    };
  }

  const delay = function (ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  };

  // --------------------------------------------------------------- age gate

  // Whole years between a YYYY-MM-DD date of birth and `now`. Returns null
  // for anything that is not a real calendar date in the past.
  function ageFromDob(dob, now) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dob || ''));
    if (!m) return null;
    const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
    const probe = new Date(Date.UTC(y, mo - 1, d));
    if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) {
      return null;
    }
    const today = now || new Date();
    let age = today.getUTCFullYear() - y;
    const beforeBirthday =
      today.getUTCMonth() + 1 < mo ||
      (today.getUTCMonth() + 1 === mo && today.getUTCDate() < d);
    if (beforeBirthday) age--;
    return age < 0 ? null : age;
  }

  // -> { ok, age?, reason?: 'invalid' | 'underage' }
  function checkAge(dob, now) {
    const age = ageFromDob(dob, now);
    if (age == null || age > 120) return { ok: false, reason: 'invalid' };
    if (age < MIN_AGE) return { ok: false, reason: 'underage', age: age };
    return { ok: true, age: age };
  }

  // Selfie decision for the mock reviewer: a frame that is almost black
  // (covered lens) or washed out cannot be reviewed, so it is rejected.
  // `meanBrightness` is 0-255. A real backend replaces this wholesale.
  function mockSelfieDecision(meanBrightness) {
    if (typeof meanBrightness !== 'number' || meanBrightness < 25 || meanBrightness > 245) {
      return { status: 'rejected', reason: 'We could not see your face clearly. Try again in good light.' };
    }
    return { status: 'verified', reason: null };
  }

  // ------------------------------------------------------- service factory

  // opts.store: a makeStore() result; opts.latency: ms of fake network
  // delay; opts.reviewMs: how long a selfie stays "pending"; opts.now: clock.
  function createMockServices(opts) {
    opts = opts || {};
    const store = opts.store || makeStore();
    const latency = opts.latency == null ? 350 : opts.latency;
    const reviewMs = opts.reviewMs == null ? 4000 : opts.reviewMs;
    const now = opts.now || function () { return Date.now(); };
    // Tests (or a flaky-network demo) can make the next call(s) fail.
    const failNext = { report: 0, block: 0, selfie: 0, privacy: 0 };

    function maybeFail(kind) {
      if (failNext[kind] > 0) {
        failNext[kind]--;
        throw new Error('Something went wrong. Please try again.');
      }
    }

    const reports = {
      // -> { id }
      submit: async function (report) {
        await delay(latency);
        maybeFail('report');
        const known = REPORT_REASONS.some(function (r) { return r.id === report.reason; });
        if (!report || !report.profileId || !known) throw new Error('Choose a reason for the report.');
        const list = store.get('omichat.reports', []);
        const entry = {
          id: list.length + 1,
          profileId: report.profileId,
          reason: report.reason,
          note: String(report.note || '').trim().slice(0, REPORT_NOTE_MAX),
          at: now(),
        };
        list.push(entry);
        store.set('omichat.reports', list);
        return { id: entry.id };
      },
      list: async function () { return store.get('omichat.reports', []); },
    };

    const blocks = {
      // Blocks are permanent: there is deliberately no unblock method.
      list: function () { return store.get('omichat.blocked', []); },
      block: async function (profileId) {
        await delay(latency);
        maybeFail('block');
        if (!profileId) throw new Error('Choose someone to block.');
        const list = store.get('omichat.blocked', []);
        if (list.indexOf(profileId) === -1) list.push(profileId);
        store.set('omichat.blocked', list);
        return { blocked: list.slice() };
      },
    };

    const verification = {
      // -> { status: 'none' | 'pending' | 'verified' | 'rejected', reason? }
      getStatus: async function () {
        const rec = store.get('omichat.selfie', null);
        if (!rec) return { status: 'none' };
        if (rec.status === 'pending' && now() - rec.submittedAt >= reviewMs) {
          const decided = mockSelfieDecision(rec.brightness);
          const next = { status: decided.status, reason: decided.reason, submittedAt: rec.submittedAt };
          store.set('omichat.selfie', next);
          return { status: next.status, reason: next.reason };
        }
        return { status: rec.status, reason: rec.reason || null };
      },
      // `selfie` is { brightness } here; a real service would upload the
      // image. The image itself is never persisted by the mock.
      submitSelfie: async function (selfie) {
        await delay(latency);
        maybeFail('selfie');
        if (!selfie || typeof selfie.brightness !== 'number') {
          throw new Error('The photo could not be read. Please retake it.');
        }
        store.set('omichat.selfie', {
          status: 'pending', submittedAt: now(), brightness: selfie.brightness,
        });
        return { status: 'pending' };
      },
      reset: async function () {
        store.set('omichat.selfie', null);
        return { status: 'none' };
      },
    };

    const privacy = {
      get: function () {
        const s = store.get('omichat.privacy', {});
        return { hideDistance: !!s.hideDistance, hideOnlineStatus: !!s.hideOnlineStatus };
      },
      update: async function (patch) {
        await delay(latency / 2);
        maybeFail('privacy');
        const next = Object.assign({}, privacy.get());
        if (patch && 'hideDistance' in patch) next.hideDistance = !!patch.hideDistance;
        if (patch && 'hideOnlineStatus' in patch) next.hideOnlineStatus = !!patch.hideOnlineStatus;
        store.set('omichat.privacy', next);
        return next;
      },
    };

    const age = {
      // -> { status: 'unknown' | 'passed' | 'blocked' }
      get: function () {
        const rec = store.get('omichat.age', null);
        if (!rec) return { status: 'unknown' };
        return { status: rec.status };
      },
      // Only the result is stored, never the date of birth. An under-18
      // result is final on this device, so editing the date cannot retry.
      submit: async function (dob) {
        await delay(latency / 2);
        if (store.get('omichat.age', null) && store.get('omichat.age', null).status === 'blocked') {
          return { ok: false, reason: 'underage' };
        }
        const result = checkAge(dob, new Date(now()));
        if (result.ok) store.set('omichat.age', { status: 'passed' });
        else if (result.reason === 'underage') store.set('omichat.age', { status: 'blocked' });
        return result;
      },
    };

    return {
      reports: reports, blocks: blocks, verification: verification,
      privacy: privacy, age: age,
      failNext: function (kind, n) { failNext[kind] = n == null ? 1 : n; },
    };
  }

  // The page-wide service bundle. configure() swaps it for a real one.
  let services = null;
  function get() {
    if (!services) services = createMockServices();
    return services;
  }
  function configure(next) { services = next; }

  return {
    MIN_AGE: MIN_AGE,
    REPORT_REASONS: REPORT_REASONS,
    REPORT_NOTE_MAX: REPORT_NOTE_MAX,
    ageFromDob: ageFromDob,
    checkAge: checkAge,
    mockSelfieDecision: mockSelfieDecision,
    makeStore: makeStore,
    createMockServices: createMockServices,
    services: get,
    configure: configure,
  };
});
