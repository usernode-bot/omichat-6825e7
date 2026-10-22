// Omichat profile schema: the predefined interest and prompt lists, the
// "Looking for" options, field limits, validation and the completeness
// score. One file, loaded by the page (window.OmichatSchema) AND required by
// server.js, so the client and the server always validate the same way.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.OmichatSchema = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const INTERESTS = [
    'Astronomy', 'Baking', 'Board games', 'Books', 'Bouldering', 'Cats',
    'Ceramics', 'Chess', 'Coding', 'Coffee', 'Cooking', 'Cycling', 'Dancing',
    'Design', 'Dogs', 'Drawing', 'Film', 'Galleries', 'Gardening', 'Hiking',
    'Jazz', 'Karaoke', 'Languages', 'Live music', 'Maps', 'Photography',
    'Plants', 'Podcasts', 'Running', 'Street food', 'Swimming', 'Synths',
    'Theatre', 'Thrift finds', 'Travel', 'Video games', 'Vinyl',
    'Volunteering', 'Writing', 'Yoga',
  ];

  const PROMPTS = [
    'A fact about me that surprises people...',
    'A perfect weekend looks like...',
    "I'm currently learning...",
    'Ask me about...',
    "I'm looking for someone to join me for...",
    "A hobby I'd love to pick up...",
    'The last thing I got excited about...',
    'My go-to comfort food...',
    'A skill I could teach you...',
    'The best thing I did this year...',
  ];

  const LOOKING_FOR = [
    { value: 'friends', label: 'Friends' },
    { value: 'activity', label: 'Activity partners' },
    { value: 'study', label: 'Study buddies' },
    { value: 'hobby', label: 'Hobby groups' },
  ];

  const LANGUAGES = [
    'Arabic', 'Bengali', 'Cantonese', 'Dutch', 'English', 'French', 'German',
    'Greek', 'Hindi', 'Indonesian', 'Italian', 'Japanese', 'Korean',
    'Mandarin', 'Polish', 'Portuguese', 'Russian', 'Spanish', 'Swahili',
    'Swedish', 'Tagalog', 'Turkish', 'Ukrainian', 'Vietnamese',
  ];

  const LIMITS = {
    name: 40,
    bio: 500,
    job: 60,
    education: 80,
    answer: 150,
    photos: 6,
    interests: 8,
    languages: 6,
    prompts: 3,
    minAge: 18,
    maxAge: 99,
  };

  const HANDLE_RE = /^[A-Za-z0-9._]{1,30}$/;
  const SPOTIFY_RE = /^[A-Za-z0-9._-]{1,30}$/;
  const FILE_ID_RE = /^[0-9a-f]{8,64}$/;

  function lookingForLabel(value) {
    const o = LOOKING_FOR.find(function (x) { return x.value === value; });
    return o ? o.label : null;
  }

  function text(v) {
    return typeof v === 'string' ? v.trim().replace(/\s+\n/g, '\n') : '';
  }

  // Strips a leading @ and whitespace; the stored handle never carries it.
  function handle(v) {
    return text(v).replace(/^@+/, '');
  }

  // Validates a submitted profile. Returns { value, errors }: `value` is the
  // normalized profile to store, `errors` maps a field name to a message.
  // Unknown keys are dropped; empty fields become null or [] and never block
  // a save: a blank name falls back to opts.fallbackName (the Homeroom
  // username) and a prompt with no answer is left out. Only real mistakes
  // still produce errors.
  function validate(input, opts) {
    input = input && typeof input === 'object' ? input : {};
    opts = opts || {};
    const errors = {};
    const v = {};

    v.name = text(input.name) || text(opts.fallbackName).slice(0, LIMITS.name) || null;
    if (v.name && v.name.length > LIMITS.name) errors.name = 'Keep your name to ' + LIMITS.name + ' characters.';

    const ageRaw = input.age;
    if (ageRaw === '' || ageRaw == null) {
      v.age = null;
    } else {
      const n = Number(ageRaw);
      if (!Number.isInteger(n) || n < LIMITS.minAge || n > LIMITS.maxAge) {
        errors.age = 'Enter an age from ' + LIMITS.minAge + ' to ' + LIMITS.maxAge + '.';
      }
      v.age = Number.isInteger(n) ? n : null;
    }

    [['bio', 'Your bio'], ['job', 'Your job'], ['education', 'Your education']].forEach(function (f) {
      const s = text(input[f[0]]);
      if (s.length > LIMITS[f[0]]) errors[f[0]] = f[1] + ' can be up to ' + LIMITS[f[0]] + ' characters.';
      v[f[0]] = s || null;
    });

    const lf = input.lookingFor;
    if (lf == null || lf === '') v.lookingFor = null;
    else if (lookingForLabel(lf)) v.lookingFor = lf;
    else { errors.lookingFor = 'Choose one of the options.'; v.lookingFor = null; }

    const interests = Array.isArray(input.interests) ? input.interests : [];
    v.interests = [];
    interests.forEach(function (i) {
      if (INTERESTS.indexOf(i) !== -1 && v.interests.indexOf(i) === -1) v.interests.push(i);
    });
    if (v.interests.length !== interests.length) errors.interests = 'Pick interests from the list.';
    if (v.interests.length > LIMITS.interests) errors.interests = 'Pick up to ' + LIMITS.interests + ' interests.';

    const languages = Array.isArray(input.languages) ? input.languages : [];
    v.languages = [];
    languages.forEach(function (l) {
      if (LANGUAGES.indexOf(l) !== -1 && v.languages.indexOf(l) === -1) v.languages.push(l);
    });
    if (v.languages.length !== languages.length) errors.languages = 'Pick languages from the list.';
    if (v.languages.length > LIMITS.languages) errors.languages = 'Pick up to ' + LIMITS.languages + ' languages.';

    const prompts = Array.isArray(input.prompts) ? input.prompts : [];
    v.prompts = [];
    if (prompts.length > LIMITS.prompts) errors.prompts = 'Choose up to ' + LIMITS.prompts + ' prompts.';
    prompts.slice(0, LIMITS.prompts).forEach(function (p, idx) {
      const q = p && p.prompt;
      const a = text(p && p.answer);
      // A prompt left unanswered is not saved, and does not block the save.
      if (!a) return;
      if (PROMPTS.indexOf(q) === -1) {
        errors['prompt' + idx] = 'Choose a prompt from the list.';
      } else if (v.prompts.some(function (x) { return x.prompt === q; })) {
        errors['prompt' + idx] = 'Each prompt can be used once.';
      } else if (a.length > LIMITS.answer) {
        errors['prompt' + idx] = 'Keep answers to ' + LIMITS.answer + ' characters.';
      }
      v.prompts.push({ prompt: q, answer: a });
    });

    const ig = handle(input.instagram);
    if (ig && !HANDLE_RE.test(ig)) errors.instagram = 'Use letters, numbers, dots and underscores (up to 30).';
    v.instagram = ig || null;
    const sp = handle(input.spotify);
    if (sp && !SPOTIFY_RE.test(sp)) errors.spotify = 'Use letters, numbers, dots, dashes and underscores (up to 30).';
    v.spotify = sp || null;

    const photos = Array.isArray(input.photos) ? input.photos : [];
    v.photos = [];
    if (photos.length > LIMITS.photos) errors.photos = 'Add up to ' + LIMITS.photos + ' photos.';
    photos.slice(0, LIMITS.photos).forEach(function (p) {
      const ok = p && typeof p.id === 'string' && FILE_ID_RE.test(p.id) &&
        typeof p.url === 'string' && p.url.length <= 500 && /^https?:\/\//.test(p.url);
      if (!ok) errors.photos = 'One of the photos did not upload. Remove it and try again.';
      else v.photos.push({ id: p.id, url: p.url });
    });

    return { value: v, errors: errors };
  }

  // Completeness: weighted checklist, ordered by what helps most first. The
  // hints are the missing items in that order.
  const CHECKS = [
    { weight: 15, hint: 'Add a photo', done: function (p) { return p.photos.length >= 1; } },
    { weight: 15, hint: 'Write a short bio', done: function (p) { return !!p.bio; } },
    { weight: 15, hint: 'Pick at least 3 interests', done: function (p) { return p.interests.length >= 3; } },
    { weight: 15, hint: 'Answer a prompt', done: function (p) { return p.prompts.length >= 1; } },
    { weight: 10, hint: 'Say what you are looking for', done: function (p) { return !!p.lookingFor; } },
    { weight: 10, hint: 'Add at least 3 photos', done: function (p) { return p.photos.length >= 3; },
      // Redundant next to "Add a photo"; it becomes the hint once one is added.
      quiet: function (p) { return p.photos.length === 0; } },
    { weight: 5, hint: 'Add your name', done: function (p) { return !!p.name; } },
    { weight: 5, hint: 'Add your age', done: function (p) { return p.age != null; } },
    { weight: 5, hint: 'Add your job', done: function (p) { return !!p.job; } },
    { weight: 5, hint: 'Add your education', done: function (p) { return !!p.education; } },
  ];

  function empty() {
    return {
      name: null, age: null, bio: null, job: null, education: null,
      lookingFor: null, interests: [], languages: [], prompts: [],
      instagram: null, spotify: null, photos: [],
    };
  }

  function completeness(profile) {
    const p = Object.assign(empty(), profile || {});
    let percent = 0;
    const hints = [];
    CHECKS.forEach(function (c) {
      if (c.done(p)) percent += c.weight;
      else if (!(c.quiet && c.quiet(p))) hints.push(c.hint);
    });
    return { percent: percent, hints: hints };
  }

  function sharedInterests(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b)) return [];
    return a.filter(function (i) { return b.indexOf(i) !== -1; });
  }

  return {
    INTERESTS: INTERESTS,
    PROMPTS: PROMPTS,
    LOOKING_FOR: LOOKING_FOR,
    LANGUAGES: LANGUAGES,
    LIMITS: LIMITS,
    lookingForLabel: lookingForLabel,
    validate: validate,
    completeness: completeness,
    sharedInterests: sharedInterests,
    empty: empty,
  };
});
