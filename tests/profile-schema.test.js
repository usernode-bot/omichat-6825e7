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
// A profile can be saved at any point: empty fields never block the save.
test('an empty profile validates with no errors', () => {
  const r = S.validate({});
  assert.deepEqual(r.errors, {});
  assert.deepEqual(r.value, S.empty());
  // Nothing at all is the same as an empty object.
  assert.deepEqual(S.validate(null).errors, {});
});

test('a blank name uses the fallback name', () => {
  const r = S.validate({ name: '   ' }, { fallbackName: 'maya' });
  assert.equal(r.value.name, 'maya');
  assert.equal(r.errors.name, undefined);
  // Whitespace-only input is treated as empty, so the fallback applies.
  assert.equal(S.validate({ name: '' }, { fallbackName: 'maya' }).value.name, 'maya');
  // Without a fallback the name stays null and still does not block the save.
  const none = S.validate({ name: ' ' });
  assert.equal(none.value.name, null);
  assert.equal(none.errors.name, undefined);
  // A name the person typed always wins over the fallback.
  assert.equal(S.validate({ name: 'Ana' }, { fallbackName: 'maya' }).value.name, 'Ana');
});

test('a name over the limit is still an error', () => {
  const r = S.validate({ name: 'a'.repeat(S.LIMITS.name + 1) }, { fallbackName: 'maya' });
  assert.equal(r.errors.name, 'Keep your name to ' + S.LIMITS.name + ' characters.');
  // A fallback longer than the limit is cut, so it can never cause an error.
  const longUser = S.validate({}, { fallbackName: 'u'.repeat(S.LIMITS.name + 10) });
  assert.equal(longUser.value.name.length, S.LIMITS.name);
  assert.equal(longUser.errors.name, undefined);
});

test('a prompt with no answer is skipped, not an error', () => {
  const r = S.validate({
    name: 'Maya',
    prompts: [
      { prompt: S.PROMPTS[0], answer: 'I can fix bikes' },
      { prompt: S.PROMPTS[2], answer: '   ' },
    ],
  });
  assert.deepEqual(r.value.prompts, [{ prompt: S.PROMPTS[0], answer: 'I can fix bikes' }]);
  assert.equal(r.errors.prompt1, undefined);
  assert.deepEqual(r.errors, {});
  // The unanswered block is skipped before its question is checked.
  const unknown = S.validate({ prompts: [{ prompt: 'Not a prompt', answer: '' }] });
  assert.deepEqual(unknown.value.prompts, []);
  assert.deepEqual(unknown.errors, {});
  // Two blocks on the same prompt where one is unanswered: no duplicate error.
  const same = S.validate({ prompts: [
    { prompt: S.PROMPTS[0], answer: 'First' },
    { prompt: S.PROMPTS[0], answer: '' },
  ] });
  assert.deepEqual(same.errors, {});
  assert.equal(same.value.prompts.length, 1);
});

test('real mistakes still block the save', () => {
  assert.ok(S.validate({ name: 'Maya', age: 12 }).errors.age);
  assert.ok(S.validate({ name: 'Maya', age: 120 }).errors.age);
  assert.ok(S.validate({ name: 'Maya', instagram: 'not allowed!' }).errors.instagram);
  assert.ok(S.validate({ name: 'Maya', spotify: 'bad/handle' }).errors.spotify);
  const tooLong = S.validate({ name: 'Maya', prompts: [
    { prompt: S.PROMPTS[0], answer: 'a'.repeat(S.LIMITS.answer + 1) },
  ] });
  assert.ok(tooLong.errors.prompt0);
  const dup = S.validate({ name: 'Maya', prompts: [
    { prompt: S.PROMPTS[0], answer: 'One' },
    { prompt: S.PROMPTS[0], answer: 'Two' },
  ] });
  assert.ok(dup.errors.prompt1);
});
