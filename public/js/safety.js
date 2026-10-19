// Omichat Safety and Trust service layer.
//
// Everything the safety features need from a "backend" lives behind the
// service objects below (reports, blocks, selfie verification, privacy
// settings, age gate). createMockServices backs them with localStorage and
// short mock latency (local runs, no database); createServerServices saves
// reports, blocks and privacy to the signed-in account through server.js.
// app.js swaps between them with OmichatSafety.configure({ ... }). The UI
// never touches storage or fetch directly.
//
// Written as a UMD-style module so the pure logic can be tested in Node
// (see tests/safety.test.js) and shared with server.js, as well as loaded by
// the page: the privacy, report and block rules below are the same on both
// sides.
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
  // Reasons for reporting one message, as opposed to a whole profile.
  const MESSAGE_REPORT_REASONS = [
    { id: 'harassment', label: 'Harassment' },
    { id: 'spam', label: 'Spam' },
    { id: 'scam', label: 'Scam or asking for money' },
    { id: 'inappropriate', label: 'Inappropriate content' },
    { id: 'other', label: 'Other' },
  ];
  const REPORT_NOTE_MAX = 500;
  const REPORT_MESSAGE_MAX = 1000;
  const KEY_MAX = 100;

  // ------------------------------------------------------------ privacy rules

  // Who a "Who can…" setting lets through, widest first.
  const AUDIENCES = [
    { id: 'everyone', label: 'Everyone' },
    { id: 'said_hi', label: 'People you said hi to' },
    { id: 'connections', label: 'Connections only' },
  ];
  const AUDIENCE_KEYS = ['whoCanMessage', 'whoCanSeeProfile'];
  const BOOLEAN_KEYS = ['showOnlineStatus', 'hideDistance'];
  // A person with no saved settings gets these. Connections only for
  // messages is how Omichat already works ("Connections open a chat").
  const PRIVACY_DEFAULTS = {
    whoCanMessage: 'connections',
    whoCanSeeProfile: 'everyone',
    showOnlineStatus: true,
    hideDistance: false,
  };

  function isAudience(v) {
    return AUDIENCES.some(function (a) { return a.id === v; });
  }

  // Whitelists the known keys of `patch` and applies them over `base`
  // (default: PRIVACY_DEFAULTS). Booleans are coerced; an unknown audience
  // is an error. The legacy `hideOnlineStatus` key maps onto
  // showOnlineStatus. -> { value: full settings, errors: { key: message } }
  function validatePrivacy(patch, base) {
    const value = Object.assign({}, PRIVACY_DEFAULTS, base || {});
    const errors = {};
    const src = patch && typeof patch === 'object' ? patch : {};
    AUDIENCE_KEYS.forEach(function (k) {
      if (!(k in src)) return;
      if (isAudience(src[k])) value[k] = src[k];
      else errors[k] = 'Choose who this applies to.';
    });
    BOOLEAN_KEYS.forEach(function (k) {
      if (k in src) value[k] = !!src[k];
    });
    if ('hideOnlineStatus' in src && !('showOnlineStatus' in src)) {
      value.showOnlineStatus = !src.hideOnlineStatus;
    }
    return { value: value, errors: errors };
  }

  // Stored settings (any age, possibly the old two-switch shape) as the
  // full current shape. Bad values fall back to the defaults.
  function normalizePrivacy(raw) {
    const src = Object.assign({}, raw || {});
    AUDIENCE_KEYS.forEach(function (k) { if (!isAudience(src[k])) delete src[k]; });
    return validatePrivacy(src).value;
  }

  // What the page reads: the settings plus the derived hideOnlineStatus
  // that the cards and rows check before showing presence labels.
  function privacyView(settings) {
    const v = normalizePrivacy(settings);
    v.hideOnlineStatus = !v.showOnlineStatus;
    return v;
  }

  // `relation` is seen from the seat of the person whose setting applies:
  // { blocked: a block either way, saidHi: they said hi to the other
  // person, connected: both said hi }. A block always denies.
  function audienceAllows(audience, relation) {
    const r = relation || {};
    if (r.blocked) return false;
    if (audience === 'everyone') return true;
    if (audience === 'said_hi') return !!(r.saidHi || r.connected);
    return !!r.connected;
  }

  function canMessage(relation, recipientPrivacy) {
    return audienceAllows(normalizePrivacy(recipientPrivacy).whoCanMessage, relation);
  }

  function canSeeProfile(relation, ownerPrivacy) {
    return audienceAllows(normalizePrivacy(ownerPrivacy).whoCanSeeProfile, relation);
  }

  // Reciprocal: you see someone's online or last-seen label only while
  // both of you show your own.
  function presenceVisible(viewerPrivacy, ownerPrivacy) {
    return normalizePrivacy(viewerPrivacy).showOnlineStatus &&
      normalizePrivacy(ownerPrivacy).showOnlineStatus;
  }

  // ------------------------------------------------------- report and block rules

  // Who a block or report points at: `mock:<id>` for the sample profiles,
  // `user:<platform id>` for real accounts.
  function mockKey(profileId) { return 'mock:' + profileId; }
  function mockIdFromKey(key) {
    const m = /^mock:(\d+)$/.exec(String(key || ''));
    return m ? Number(m[1]) : null;
  }
  function isTargetKey(key) {
    return typeof key === 'string' && key.length <= KEY_MAX && /^(mock:\d+|user:.+)$/.test(key);
  }

  function reasonsFor(targetType) {
    return targetType === 'message' ? MESSAGE_REPORT_REASONS : REPORT_REASONS;
  }
  function reasonLabel(targetType, id) {
    const r = reasonsFor(targetType).find(function (x) { return x.id === id; });
    return r ? r.label : id;
  }

  // Only a text someone else sent can be reported as a message: not your
  // own messages, not hi or connection notices.
  function canReportMessage(last) {
    return !!(last && last.id && last.kind === 'text' && last.from === 'them');
  }

  // -> { value, error } with the report trimmed and capped.
  function validateReport(input) {
    const r = input || {};
    const targetType = r.targetType === 'message' ? 'message' : r.targetType == null || r.targetType === 'profile' ? 'profile' : null;
    if (!targetType) return { error: 'Choose what to report.' };
    if (!isTargetKey(r.targetKey)) return { error: 'Choose someone to report.' };
    const known = reasonsFor(targetType).some(function (x) { return x.id === r.reason; });
    if (!known) return { error: 'Choose a reason for the report.' };
    const value = {
      targetType: targetType,
      targetKey: r.targetKey,
      targetName: String(r.targetName || '').trim().slice(0, KEY_MAX),
      messageId: null,
      messageText: null,
      reason: r.reason,
      note: String(r.note || '').trim().slice(0, REPORT_NOTE_MAX),
    };
    if (targetType === 'message') {
      const id = String(r.messageId || '').trim();
      if (!id || id.length > KEY_MAX) return { error: 'Choose a message to report.' };
      value.messageId = id;
      value.messageText = String(r.messageText || '').trim().slice(0, REPORT_MESSAGE_MAX);
    }
    return { value: value };
  }

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
      // report: { targetType?: 'profile' | 'message', profileId, targetName,
      // messageId?, messageText?, reason, note }. A second report on the
      // same person or message while the first is open returns its id.
      // -> { id }
      submit: async function (report) {
        await delay(latency);
        maybeFail('report');
        const input = Object.assign({}, report);
        if (input.profileId) input.targetKey = mockKey(input.profileId);
        const checked = validateReport(input);
        if (checked.error) throw new Error(checked.error);
        const v = checked.value;
        const list = store.get('omichat.reports', []);
        const open = list.find(function (e) {
          return (e.status || 'open') === 'open' && e.targetKey === v.targetKey &&
            (e.messageId || null) === v.messageId;
        });
        if (open) return { id: open.id };
        const entry = Object.assign({ id: list.length + 1, profileId: input.profileId, status: 'open', at: now() }, v);
        list.push(entry);
        store.set('omichat.reports', list);
        return { id: entry.id };
      },
      list: async function () { return store.get('omichat.reports', []); },
      // Nobody reviews reports on a device: the review queue needs the server.
      pending: async function () { return []; },
      review: async function () { throw new Error('Reports can only be reviewed on the app server.'); },
    };

    const blocks = {
      // Blocks are permanent: there is deliberately no unblock method.
      // list() is the blocked sample-profile ids; entries() adds names and
      // dates for the Privacy sheet's Blocked people list.
      list: function () { return store.get('omichat.blocked', []); },
      entries: function () {
        const meta = store.get('omichat.blockedMeta', {});
        return blocks.list().map(function (id) {
          const m = meta[id] || {};
          return { key: mockKey(id), name: m.name || null, at: m.at || null };
        });
      },
      block: async function (profileId, name) {
        await delay(latency);
        maybeFail('block');
        if (!profileId) throw new Error('Choose someone to block.');
        const list = store.get('omichat.blocked', []);
        if (list.indexOf(profileId) === -1) {
          list.push(profileId);
          const meta = store.get('omichat.blockedMeta', {});
          meta[profileId] = { name: name || null, at: now() };
          store.set('omichat.blockedMeta', meta);
        }
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
      // Older devices stored { hideDistance, hideOnlineStatus }; both shapes
      // read as the current one.
      get: function () { return privacyView(store.get('omichat.privacy', {})); },
      // Whether anything was ever saved on this device (the one-time import
      // to the account only copies settings someone actually chose).
      saved: function () { return store.get('omichat.privacy', null) != null; },
      update: async function (patch) {
        await delay(latency / 2);
        maybeFail('privacy');
        const checked = validatePrivacy(patch, normalizePrivacy(store.get('omichat.privacy', {})));
        if (Object.keys(checked.errors).length) throw new Error('Could not save that setting. Try again.');
        store.set('omichat.privacy', checked.value);
        return privacyView(checked.value);
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

  // Reports, blocks and privacy saved to the signed-in account through
  // server.js. opts.api(path, { method, body }) -> fetch Response (app.js's
  // token-forwarding helper); opts.initial is a GET /api/safety answer, so
  // the synchronous list() and get() read a cache from the first call;
  // opts.fallback supplies the parts that still live on the device
  // (selfie verification, the age gate).
  function createServerServices(opts) {
    const api = opts.api;
    const fallback = opts.fallback || createMockServices();
    let cache = { privacy: normalizePrivacy(null), blocked: [], canReview: false };

    function take(data) {
      cache = {
        privacy: normalizePrivacy(data && data.privacy),
        blocked: (data && data.blocked) || [],
        canReview: !!(data && data.canReview),
      };
    }
    if (opts.initial) take(opts.initial);

    async function call(path, o, fallbackMsg) {
      let r;
      try { r = await api(path, o || {}); }
      catch (e) { throw new Error(fallbackMsg); }
      const data = await r.json().catch(function () { return {}; });
      if (!r.ok) throw new Error(data.error || fallbackMsg);
      return data;
    }

    const reports = {
      submit: async function (report) {
        const body = Object.assign({}, report);
        if (body.profileId) body.targetKey = mockKey(body.profileId);
        delete body.profileId;
        const data = await call('/api/reports', { method: 'POST', body: body },
          'Could not send the report. Try again.');
        return { id: data.id };
      },
      pending: async function () {
        const data = await call('/api/reports/pending', {}, 'Could not load the reports.');
        return data.reports || [];
      },
      review: async function (id, decision) {
        await call('/api/reports/' + encodeURIComponent(id) + '/review',
          { method: 'POST', body: { decision: decision } }, 'Could not save the decision. Try again.');
        return { ok: true };
      },
    };

    const blocks = {
      list: function () {
        return cache.blocked.map(function (b) { return mockIdFromKey(b.key); })
          .filter(function (id) { return id != null; });
      },
      entries: function () { return cache.blocked.slice(); },
      block: async function (profileId, name) {
        if (!profileId) throw new Error('Choose someone to block.');
        const data = await call('/api/blocks', { method: 'POST', body: { key: mockKey(profileId), name: name || '' } },
          'Could not block this person. Try again.');
        cache.blocked = data.blocked || cache.blocked;
        return { blocked: blocks.list() };
      },
    };

    const privacy = {
      get: function () { return privacyView(cache.privacy); },
      saved: function () { return true; },
      update: async function (patch) {
        const data = await call('/api/privacy', { method: 'PUT', body: { privacy: patch } },
          'Could not save that setting. Try again.');
        cache.privacy = normalizePrivacy(data.privacy);
        return privacyView(cache.privacy);
      },
    };

    return {
      reports: reports, blocks: blocks, privacy: privacy,
      verification: fallback.verification, age: fallback.age,
      canReview: function () { return cache.canReview; },
      // Copies what an older version kept on this device (blocks and the
      // privacy switches) to the account. The server keeps blocks it
      // already has and only takes the settings when the account has none.
      importFrom: async function (local) {
        const body = {
          blocked: local.blocks.entries ? local.blocks.entries() : [],
          privacy: local.privacy.saved && local.privacy.saved() ? normalizePrivacy(local.privacy.get()) : null,
        };
        const data = await call('/api/safety/import', { method: 'POST', body: body },
          'Could not copy your settings.');
        take(data);
        return data;
      },
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
    MESSAGE_REPORT_REASONS: MESSAGE_REPORT_REASONS,
    REPORT_NOTE_MAX: REPORT_NOTE_MAX,
    REPORT_MESSAGE_MAX: REPORT_MESSAGE_MAX,
    AUDIENCES: AUDIENCES,
    PRIVACY_DEFAULTS: PRIVACY_DEFAULTS,
    validatePrivacy: validatePrivacy,
    normalizePrivacy: normalizePrivacy,
    privacyView: privacyView,
    audienceAllows: audienceAllows,
    canMessage: canMessage,
    canSeeProfile: canSeeProfile,
    presenceVisible: presenceVisible,
    mockKey: mockKey,
    mockIdFromKey: mockIdFromKey,
    isTargetKey: isTargetKey,
    reasonsFor: reasonsFor,
    reasonLabel: reasonLabel,
    canReportMessage: canReportMessage,
    validateReport: validateReport,
    createServerServices: createServerServices,
    ageFromDob: ageFromDob,
    checkAge: checkAge,
    mockSelfieDecision: mockSelfieDecision,
    makeStore: makeStore,
    createMockServices: createMockServices,
    services: get,
    configure: configure,
  };
});
