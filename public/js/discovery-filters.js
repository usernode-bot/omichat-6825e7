// Omichat discovery filters: the filter state, its matching rules and its
// labels. Pure logic, no DOM: loaded by the page (window.OmichatFilters) and
// required by the unit tests. profile-schema.js stays the single source of
// the option lists (Looking for, Interests, Languages).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./profile-schema.js'));
  } else {
    root.OmichatFilters = factory(root.OmichatSchema);
  }
})(typeof self !== 'undefined' ? self : this, function (Schema) {
  'use strict';

  const AGE_MIN = 18;
  const AGE_MAX = 80;
  const DISTANCES_KM = [1, 2, 5, 10, 25, 50, 100];

  // null, false or an empty array means the filter is off.
  function defaults() {
    return {
      minAge: null,
      maxAge: null,
      maxDistance: null,
      online: false,
      lookingFor: [],
      interests: [],
      languages: [],
    };
  }

  function isAge(n) {
    return Number.isInteger(n) && n >= AGE_MIN && n <= AGE_MAX;
  }

  // Normalises a saved or incoming filter object: unknown values are dropped
  // (so a filter that names an option later removed from the schema cannot
  // hide everyone), duplicates are removed and out-of-range numbers fall
  // back to the default. A minimum above the maximum raises the maximum,
  // the same rule the sheet applies live.
  function sanitize(raw) {
    const f = defaults();
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return f;

    if (isAge(raw.minAge)) f.minAge = raw.minAge;
    if (isAge(raw.maxAge)) f.maxAge = raw.maxAge;
    if (DISTANCES_KM.indexOf(raw.maxDistance) !== -1) f.maxDistance = raw.maxDistance;
    if (raw.online === true) f.online = true;

    const lists = [
      ['lookingFor', Schema.LOOKING_FOR.map(function (o) { return o.value; })],
      ['interests', Schema.INTERESTS],
      ['languages', Schema.LANGUAGES],
    ];
    lists.forEach(function (pair) {
      const key = pair[0];
      const valid = pair[1];
      if (!Array.isArray(raw[key])) return;
      const kept = raw[key].filter(function (v) { return valid.indexOf(v) !== -1; });
      f[key] = kept.filter(function (v, i) { return kept.indexOf(v) === i; });
    });

    if (f.minAge != null && f.maxAge != null && f.minAge > f.maxAge) {
      f.maxAge = f.minAge;
    }
    return f;
  }

  // A profile lacking the field a filter is set on is hidden rather than
  // guessed about: the deck never invents a value for missing data. Within a
  // multi-select filter one match is enough; across filters every turned-on
  // rule must pass.
  function matches(p, f, presence) {
    if (f.minAge != null || f.maxAge != null) {
      if (p.age == null) return false;
      if (f.minAge != null && p.age < f.minAge) return false;
      if (f.maxAge != null && p.age > f.maxAge) return false;
    }
    if (f.maxDistance != null && (p.distance == null || p.distance > f.maxDistance)) {
      return false;
    }
    if (f.online === true) {
      const status = presence ? presence(p).status : 'none';
      if (status !== 'online' && status !== 'recent') return false;
    }
    if (f.lookingFor.length && (p.lookingFor == null || f.lookingFor.indexOf(p.lookingFor) === -1)) {
      return false;
    }
    if (f.interests.length) {
      const shared = Array.isArray(p.interests) &&
        p.interests.some(function (i) { return f.interests.indexOf(i) !== -1; });
      if (!shared) return false;
    }
    if (f.languages.length) {
      const shared = Array.isArray(p.languages) &&
        p.languages.some(function (l) { return f.languages.indexOf(l) !== -1; });
      if (!shared) return false;
    }
    return true;
  }

  // Each turned-on filter counts once, however many values it holds.
  function activeCount(f) {
    let n = 0;
    if (f.minAge != null || f.maxAge != null) n++;
    if (f.maxDistance != null) n++;
    if (f.online === true) n++;
    if (f.lookingFor.length) n++;
    if (f.interests.length) n++;
    if (f.languages.length) n++;
    return n;
  }

  // Short label for the deck's filter pill, e.g. "24–40 · 10 km".
  function summary(f) {
    const parts = [];
    if (f.minAge != null && f.maxAge != null) parts.push(f.minAge + '–' + f.maxAge);
    else if (f.minAge != null) parts.push(f.minAge + '+');
    else if (f.maxAge != null) parts.push('up to ' + f.maxAge);
    if (f.maxDistance != null) parts.push(f.maxDistance + ' km');
    return parts.join(' · ');
  }

  return {
    AGE_MIN: AGE_MIN,
    AGE_MAX: AGE_MAX,
    DISTANCES_KM: DISTANCES_KM,
    defaults: defaults,
    sanitize: sanitize,
    matches: matches,
    activeCount: activeCount,
    summary: summary,
  };
});