const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../public/js/profile-schema.js');

test('validate keeps known languages and removes duplicates', () => {
  const r = S.validate({ name: 'Maya', languages: ['English', 'Hindi'] });
  assert.deepEqual(r.value.languages, ['English', 'Hindi']);
  assert.equal(r.errors.languages, undefined);
  // A duplicate is dropped like an unknown value: kept once, and flagged
  // the same way interests behaves.
  const dup = S.validate({ name: 'Maya', languages: ['English', 'English'] });
  assert.deepEqual(dup.value.languages, ['English']);
  assert.equal(dup.errors.languages, 'Pick languages from the list.');
});

test('validate errors on unknown languages', () => {
  const r = S.validate({ name: 'Maya', languages: ['English', 'Klingon'] });
  assert.equal(r.errors.languages, 'Pick languages from the list.');
});

test('validate errors on more than the language limit', () => {
  const r = S.validate({ name: 'Maya', languages: S.LANGUAGES.slice() });
  assert.equal(r.errors.languages, 'Pick up to ' + S.LIMITS.languages + ' languages.');
  // Like interests, validation flags the overflow; the picker caps at 6.
  assert.equal(r.value.languages.length, S.LANGUAGES.length);
});

test('a missing languages field validates to an empty array', () => {
  const r = S.validate({ name: 'Maya' });
  assert.deepEqual(r.value.languages, []);
  // Non-array junk too.
  assert.deepEqual(S.validate({ name: 'Maya', languages: 'English' }).value.languages, []);
});

test('empty().languages is an empty array', () => {
  assert.deepEqual(S.empty().languages, []);
});

test('languages do not change the completeness score', () => {
  const base = { name: 'Maya', photos: [{ id: 'a'.repeat(8), url: 'https://example.com/p.jpg' }], bio: 'hi', interests: ['Hiking', 'Books', 'Cats'], prompts: [{ prompt: S.PROMPTS[0], answer: 'x' }], lookingFor: 'friends' };
  const without = S.completeness(base);
  const withLanguages = S.completeness(Object.assign({}, base, { languages: ['English', 'Hindi'] }));
  assert.equal(withLanguages.percent, without.percent);
  assert.deepEqual(withLanguages.hints, without.hints);
});

test('the LANGUAGES list is the fixed 24-language list with no duplicates', () => {
  assert.equal(S.LANGUAGES.length, 24);
  assert.equal(new Set(S.LANGUAGES).size, 24);
});
// ------------------------------------------------------------- photos
// Phones label photos inconsistently; these helpers decide what a picked
// file is and what name storage should see.
test('photoUploadName normalises variant photo types', () => {
  assert.deepEqual(S.photoUploadName('image/jpg', 'a.jpg'), { type: 'image/jpeg', ext: 'jpg' });
  assert.deepEqual(S.photoUploadName('image/pjpeg', 'a.jpg'), { type: 'image/jpeg', ext: 'jpg' });
  assert.deepEqual(S.photoUploadName('image/x-png', 'a.png'), { type: 'image/png', ext: 'png' });
  assert.deepEqual(S.photoUploadName('image/jpeg', 'a'), { type: 'image/jpeg', ext: 'jpg' });
  assert.deepEqual(S.photoUploadName('image/png', 'a'), { type: 'image/png', ext: 'png' });
  assert.deepEqual(S.photoUploadName('image/webp', 'a'), { type: 'image/webp', ext: 'webp' });
  assert.deepEqual(S.photoUploadName('image/gif', 'a'), { type: 'image/gif', ext: 'gif' });
});

test('photoUploadName falls back to the file extension', () => {
  assert.deepEqual(S.photoUploadName('', 'a.JPEG'), { type: 'image/jpeg', ext: 'jpg' });
  assert.deepEqual(S.photoUploadName('', 'b.png'), { type: 'image/png', ext: 'png' });
  assert.deepEqual(S.photoUploadName('application/octet-stream', 'c.webp'), { type: 'image/webp', ext: 'webp' });
  assert.equal(S.photoUploadName('', 'c.heic'), null);
  assert.equal(S.photoUploadName('application/octet-stream', 'd'), null);
});

test('isPickableImage accepts photos a phone may open and refuses the rest', () => {
  assert.equal(S.isPickableImage('image/heic', 'x.heic'), true);
  assert.equal(S.isPickableImage('image/jpg', 'x.jpg'), true);
  assert.equal(S.isPickableImage('image/x-png', 'x'), true);
  assert.equal(S.isPickableImage('', 'x.jpg'), true);
  assert.equal(S.isPickableImage('', 'x.heic'), true);
  assert.equal(S.isPickableImage('application/pdf', 'x.pdf'), false);
  assert.equal(S.isPickableImage('', 'notes.txt'), false);
  assert.equal(S.isPickableImage('', ''), false);
});
