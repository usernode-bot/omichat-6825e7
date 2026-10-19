const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../public/js/discovery-filters.js');
const Schema = require('../public/js/profile-schema.js');

// Stub presence: the shape Data.presence returns in the app.
function presence(status) {
  return function () { return { status: status, label: null }; };
}

function person(extra) {
  return Object.assign({
    age: 30, distance: 5, lookingFor: 'friends',
    interests: ['Hiking'], languages: ['English'], lastActiveMin: 0,
  }, extra);
}

test('defaults match everyone, including sparse profiles', () => {
  const f = F.defaults();
  assert.deepEqual(f, {
    minAge: null, maxAge: null, maxDistance: null, online: false,
    lookingFor: [], interests: [], languages: [],
  });
  assert.equal(F.matches({ name: 'Sasha', age: null, distance: 4 }, f, presence('none')), true);
  assert.equal(F.matches({ name: 'Milo', age: 33, distance: null, interests: [] }, f, presence('none')), true);
  assert.equal(F.activeCount(f), 0);
});

test('filters combine with AND across filters', () => {
  const f = F.sanitize({ interests: ['Hiking'], languages: ['English'] });
  assert.equal(F.matches(person({ interests: ['Hiking'], languages: ['English'] }), f, presence('online')), true);
  // Shares the interest but not the language: hidden.
  assert.equal(F.matches(person({ languages: ['German'] }), f, presence('online')), false);
  // Shares the language but not the interest: hidden.
  assert.equal(F.matches(person({ interests: ['Books'] }), f, presence('online')), false);
});

test('within a multi-select filter one match is enough (OR)', () => {
  const f = F.sanitize({ interests: ['Hiking', 'Books'] });
  assert.equal(F.matches(person({ interests: ['Books'] }), f, presence('online')), true);
  assert.equal(F.matches(person({ interests: ['Hiking', 'Cats'] }), f, presence('online')), true);
  assert.equal(F.matches(person({ interests: ['Cats'] }), f, presence('online')), false);
});

test('age: bounds are inclusive, a missing age hides only while an age filter is on', () => {
  const f = F.sanitize({ minAge: 24, maxAge: 40 });
  assert.equal(F.matches(person({ age: 24 }), f, presence('none')), true);
  assert.equal(F.matches(person({ age: 40 }), f, presence('none')), true);
  assert.equal(F.matches(person({ age: 41 }), f, presence('none')), false);
  assert.equal(F.matches(person({ age: null }), f, presence('none')), false);
  // With no age filter set the sparse profile shows again.
  assert.equal(F.matches(person({ age: null }), F.defaults(), presence('none')), true);
});

test('distance: a missing distance hides only while a distance filter is on', () => {
  const f = F.sanitize({ maxDistance: 5 });
  assert.equal(F.matches(person({ distance: 5 }), f, presence('none')), true);
  assert.equal(F.matches(person({ distance: 6 }), f, presence('none')), false);
  assert.equal(F.matches(person({ distance: null }), f, presence('none')), false);
  assert.equal(F.matches(person({ distance: null }), F.defaults(), presence('none')), true);
});

test('online: passes online and recent, fails none; missing lastActiveMin hides only while on', () => {
  const f = F.sanitize({ online: true });
  assert.equal(F.matches(person({ lastActiveMin: 0 }), f, presence('online')), true);
  assert.equal(F.matches(person({ lastActiveMin: 20 }), f, presence('recent')), true);
  assert.equal(F.matches(person({ lastActiveMin: 180 }), f, presence('none')), false);
  // No lastActiveMin field at all: the stub answers 'none', so hidden.
  assert.equal(F.matches({ age: 30, distance: 5, lastActiveMin: undefined }, f, presence('none')), false);
  assert.equal(F.matches(person(), F.defaults(), presence('none')), true);
});

test('looking for: matches any chosen value, a null lookingFor hides only while on', () => {
  const f = F.sanitize({ lookingFor: ['friends', 'activity'] });
  assert.equal(F.matches(person({ lookingFor: 'friends' }), f, presence('none')), true);
  assert.equal(F.matches(person({ lookingFor: 'activity' }), f, presence('none')), true);
  assert.equal(F.matches(person({ lookingFor: 'study' }), f, presence('none')), false);
  assert.equal(F.matches(person({ lookingFor: null }), f, presence('none')), false);
  assert.equal(F.matches(person({ lookingFor: null }), F.defaults(), presence('none')), true);
});

test('interests: a missing or empty interests array hides only while the filter is on', () => {
  const f = F.sanitize({ interests: ['Hiking'] });
  assert.equal(F.matches(person({ interests: [] }), f, presence('none')), false);
  assert.equal(F.matches(person({ interests: undefined }), f, presence('none')), false);
  assert.equal(F.matches(person({ interests: [] }), F.defaults(), presence('none')), true);
});

test('languages: a missing or empty languages array hides only while the filter is on', () => {
  const f = F.sanitize({ languages: ['English'] });
  assert.equal(F.matches(person({ languages: [] }), f, presence('none')), false);
  assert.equal(F.matches(person({ languages: undefined }), f, presence('none')), false);
  assert.equal(F.matches(person({ languages: [] }), F.defaults(), presence('none')), true);
});

test('activeCount counts each filter row once', () => {
  assert.equal(F.activeCount(F.defaults()), 0);
  assert.equal(F.activeCount(F.sanitize({ minAge: 24, maxAge: 40 })), 1);
  assert.equal(
    F.activeCount(F.sanitize({
      minAge: 24, maxAge: 40, maxDistance: 10, online: true,
      lookingFor: ['friends', 'activity'], interests: ['Hiking'], languages: ['English'],
    })),
    6);
});

test('sanitize drops unknown values, bad numbers, non-arrays and junk', () => {
  const f = F.sanitize({
    minAge: 10, maxAge: 999, maxDistance: 7, online: 'yes',
    lookingFor: ['friends', 'dating', 'friends'], interests: ['Hiking', 'Clubbing', 42],
    languages: ['English', 'Klingon', 'English'],
  });
  assert.equal(f.minAge, null);
  assert.equal(f.maxAge, null);
  assert.equal(f.maxDistance, null);
  assert.equal(f.online, false);
  assert.deepEqual(f.lookingFor, ['friends']);
  assert.deepEqual(f.interests, ['Hiking']);
  assert.deepEqual(f.languages, ['English']);

  // min above max is repaired by raising max.
  assert.deepEqual(
    F.sanitize({ minAge: 40, maxAge: 24 }),
    Object.assign(F.defaults(), { minAge: 40, maxAge: 40 }));

  // Non-object junk gives the defaults.
  assert.deepEqual(F.sanitize(null), F.defaults());
  assert.deepEqual(F.sanitize('junk'), F.defaults());
  assert.deepEqual(F.sanitize([1, 2]), F.defaults());

  // A filter naming an option later removed from the schema is dropped.
  assert.deepEqual(F.sanitize({ interests: ['Hiking', 'Long-lost interest'] }).interests, ['Hiking']);
});

test('summary is unchanged', () => {
  assert.equal(F.summary(F.sanitize({ minAge: 24, maxAge: 40, maxDistance: 10 })), '24–40 · 10 km');
  assert.equal(F.summary(F.sanitize({ minAge: 24 })), '24+');
  assert.equal(F.summary(F.sanitize({ maxAge: 40 })), 'up to 40');
  assert.equal(F.summary(F.sanitize({ maxDistance: 10 })), '10 km');
  assert.equal(F.summary(F.defaults()), '');
});

test('the module reads the shared schema for its option lists', () => {
  assert.ok(Schema.LANGUAGES.indexOf('English') !== -1);
  assert.ok(Schema.LOOKING_FOR.some(function (o) { return o.value === 'friends'; }));
});