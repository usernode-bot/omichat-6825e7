const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../public/js/discovery-filters.js');
const Schema = require('../public/js/profile-schema.js');

const maya = { age: 26, distance: 3, interests: ['Ceramics', 'Film'], languages: ['English', 'Spanish'], lookingFor: 'friends', online: true };
const sasha = { age: null, distance: 4, interests: ['Baking'], languages: [], lookingFor: null, online: false };
const isOnline = (p) => p.online;

function f(patch) {
  return Object.assign(F.defaults(), patch);
}

test('with every filter off, everyone shows, sparse profiles included', () => {
  assert.equal(F.isActive(F.defaults()), false);
  assert.equal(F.matches(maya, F.defaults(), { isOnline }), true);
  assert.equal(F.matches(sasha, F.defaults(), { isOnline }), true);
});

test('online now keeps only people online, unless the viewer hides their status', () => {
  const on = f({ online: true });
  assert.equal(F.matches(maya, on, { isOnline }), true);
  assert.equal(F.matches(sasha, on, { isOnline }), false);
  // No isOnline (the viewer hides their own status): the filter is ignored.
  assert.equal(F.matches(sasha, on, {}), true);
});

test('interests and languages match on any overlap; a missing list never matches', () => {
  assert.equal(F.matches(maya, f({ interests: ['Hiking', 'Film'] })), true);
  assert.equal(F.matches(maya, f({ interests: ['Hiking'] })), false);
  assert.equal(F.matches(maya, f({ languages: ['Spanish'] })), true);
  assert.equal(F.matches(maya, f({ languages: ['German'] })), false);
  assert.equal(F.matches(sasha, f({ languages: ['English'] })), false);
  assert.equal(F.matches({ age: 30 }, f({ interests: ['Film'] })), false);
});

test('looking for matches any picked option and hides people who left it blank', () => {
  assert.equal(F.matches(maya, f({ lookingFor: ['study', 'friends'] })), true);
  assert.equal(F.matches(maya, f({ lookingFor: ['activity'] })), false);
  assert.equal(F.matches(sasha, f({ lookingFor: ['friends', 'activity', 'study', 'hobby'] })), false);
});

test('age and distance keep their existing behaviour', () => {
  assert.equal(F.matches(maya, f({ minAge: 27 })), false);
  assert.equal(F.matches(maya, f({ minAge: 20, maxAge: 26 })), true);
  assert.equal(F.matches(sasha, f({ maxAge: 99 })), false);
  assert.equal(F.matches(maya, f({ maxDistance: 2 })), false);
});

test('summary names a single goal and folds the rest into a count', () => {
  const label = Schema.lookingForLabel;
  assert.equal(F.summary(f({ minAge: 24, maxAge: 40, maxDistance: 10 })), '24–40 · 10 km');
  assert.equal(F.summary(f({ lookingFor: ['study'] }), { lookingForLabel: label }), 'Study buddies');
  assert.equal(F.summary(f({ online: true, interests: ['Film', 'Jazz'] })), 'Online now · 2 interests');
  assert.equal(
    F.summary(f({ minAge: 20, online: true, languages: ['English'], lookingFor: ['friends', 'hobby'] })),
    '20+ · Online now · +2');
});

test('filters are remembered in session storage and cleared on reset', () => {
  const store = new Map();
  const storage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, v),
    removeItem: (k) => store.delete(k),
  };
  const chosen = f({ maxDistance: 5, online: true, languages: ['French'], lookingFor: ['hobby'] });
  F.save(storage, chosen);
  assert.deepEqual(F.load(storage), chosen);
  F.save(storage, F.defaults());
  assert.equal(store.has(F.STORAGE_KEY), false);
  assert.deepEqual(F.load(storage), F.defaults());
});

test('load survives refused storage and junk values', () => {
  const throwing = { getItem() { throw new Error('denied'); } };
  assert.deepEqual(F.load(throwing), F.defaults());
  assert.deepEqual(F.load(null), F.defaults());
  const junk = { getItem: () => '{"minAge":"x","online":"yes","interests":[1,"Film","Film"],"extra":true}' };
  assert.deepEqual(F.load(junk), f({ interests: ['Film'] }));
});

test('profile schema validates languages from the list, up to the limit', () => {
  const ok = Schema.validate({ name: 'A', languages: ['English', 'Tamil'] });
  assert.deepEqual(ok.value.languages, ['English', 'Tamil']);
  assert.equal(ok.errors.languages, undefined);
  assert.equal(Schema.validate({ name: 'A', languages: ['Klingon'] }).errors.languages, 'Pick languages from the list.');
  const many = Schema.LANGUAGES.slice(0, Schema.LIMITS.languages + 1);
  assert.match(Schema.validate({ name: 'A', languages: many }).errors.languages, /up to/);
  assert.deepEqual(Schema.empty().languages, []);
});
