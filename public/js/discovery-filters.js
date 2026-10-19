// Omichat discovery filters: the filter shape, matching, the pill summary
// and session storage. Loaded by the page (window.OmichatFilters) and
// required by tests/discovery-filters.test.js, so the deck and the tests
// share one definition of "matches".
//
// A filter that is off is null (or an empty list). A profile missing the
// field a filter is set on is hidden rather than guessed about: with every
// filter off, everyone shows.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.OmichatFilters = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const STORAGE_KEY = 'omichat.discoveryFilters';
  const LISTS = ['interests', 'languages', 'lookingFor'];

  function defaults() {
    return {
      minAge: null, maxAge: null, maxDistance: null,
      online: false, interests: [], languages: [], lookingFor: [],
    };
  }

  function num(v) {
    return typeof v === 'number' && isFinite(v) ? v : null;
  }

  // Coerces anything (a stored value, a partial object) into a valid filter
  // set, dropping unknown keys and list entries that are not strings.
  function normalize(input) {
    const f = defaults();
    if (!input || typeof input !== 'object') return f;
    f.minAge = num(input.minAge);
    f.maxAge = num(input.maxAge);
    f.maxDistance = num(input.maxDistance);
    f.online = input.online === true;
    LISTS.forEach(function (k) {
      const list = Array.isArray(input[k]) ? input[k] : [];
      list.forEach(function (v) {
        if (typeof v === 'string' && f[k].indexOf(v) === -1) f[k].push(v);
      });
    });
    return f;
  }

  function isActive(f) {
    return f.minAge != null || f.maxAge != null || f.maxDistance != null ||
      f.online || f.interests.length > 0 || f.languages.length > 0 ||
      f.lookingFor.length > 0;
  }

  function overlaps(have, want) {
    if (!Array.isArray(have)) return false;
    return want.some(function (w) { return have.indexOf(w) !== -1; });
  }

  // opts.isOnline(profile) answers the online filter; when it is missing
  // (the viewer hides their own status, so sees no one else's) the online
  // filter is ignored. Lists match on any overlap: picking Hiking and Film
  // shows people with either.
  function matches(p, f, opts) {
    opts = opts || {};
    if (p.age == null) {
      if (f.minAge != null || f.maxAge != null) return false;
    } else {
      if (f.minAge != null && p.age < f.minAge) return false;
      if (f.maxAge != null && p.age > f.maxAge) return false;
    }
    if (f.maxDistance != null && (p.distance == null || p.distance > f.maxDistance)) {
      return false;
    }
    if (f.online && opts.isOnline && !opts.isOnline(p)) return false;
    if (f.interests.length && !overlaps(p.interests, f.interests)) return false;
    if (f.languages.length && !overlaps(p.languages, f.languages)) return false;
    if (f.lookingFor.length && f.lookingFor.indexOf(p.lookingFor) === -1) return false;
    return true;
  }

  function plural(n, one, many) {
    return n + ' ' + (n === 1 ? one : many);
  }

  // Short label for the deck's filter pill, e.g. "24–40 · 10 km · +2".
  // opts.lookingForLabel(value) names a single "Looking for" choice.
  function summary(f, opts) {
    opts = opts || {};
    const parts = [];
    if (f.minAge != null && f.maxAge != null) parts.push(f.minAge + '–' + f.maxAge);
    else if (f.minAge != null) parts.push(f.minAge + '+');
    else if (f.maxAge != null) parts.push('up to ' + f.maxAge);
    if (f.maxDistance != null) parts.push(f.maxDistance + ' km');
    if (f.online) parts.push('Online now');
    if (f.lookingFor.length === 1 && opts.lookingForLabel) {
      parts.push(opts.lookingForLabel(f.lookingFor[0]) || plural(1, 'goal', 'goals'));
    } else if (f.lookingFor.length) {
      parts.push(plural(f.lookingFor.length, 'goal', 'goals'));
    }
    if (f.interests.length) parts.push(plural(f.interests.length, 'interest', 'interests'));
    if (f.languages.length) parts.push(plural(f.languages.length, 'language', 'languages'));
    if (parts.length <= 2) return parts.join(' · ');
    return parts.slice(0, 2).join(' · ') + ' · +' + (parts.length - 2);
  }

  // Session memory: the filters survive tab switches and reloads within the
  // browsing session, and start fresh in a new one. Storage can be refused
  // in a third-party frame; then they live in memory only.
  function load(storage) {
    try {
      const raw = storage && storage.getItem(STORAGE_KEY);
      return normalize(raw ? JSON.parse(raw) : null);
    } catch (e) {
      return defaults();
    }
  }

  function save(storage, f) {
    try {
      if (!storage) return;
      if (isActive(f)) storage.setItem(STORAGE_KEY, JSON.stringify(f));
      else storage.removeItem(STORAGE_KEY);
    } catch (e) { /* memory only */ }
  }

  return {
    STORAGE_KEY: STORAGE_KEY,
    defaults: defaults,
    normalize: normalize,
    isActive: isActive,
    matches: matches,
    summary: summary,
    load: load,
    save: save,
  };
});
