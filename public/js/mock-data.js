// Omichat mock data.
//
// Everything here is mock: profiles, distances, verification flags. No
// backend, matching or persistence yet. Profile "photos" are generated SVG
// placeholders (a gradient portrait tile with an abstract silhouette) so the
// deck works offline, in staging previews, and in proposal checks, where no
// real image CDN is reachable. Photos are data URIs, never bytes in a DB.
window.OmichatData = (function () {
  // Gradient pairs, one per photo, chosen by seed so each profile's photos
  // differ and stay stable between loads.
  const PALETTES = [
    ['#e879f9', '#7c3aed'], // fuchsia to violet
    ['#67e8f9', '#2563eb'], // cyan to blue
    ['#fda4af', '#be123c'], // rose
    ['#fcd34d', '#b45309'], // amber
    ['#6ee7b7', '#047857'], // emerald
    ['#a5b4fc', '#4338ca'], // indigo
  ];

  function lcg(seed) {
    let s = (seed * 9301 + 49297) % 233280;
    return function () {
      s = (s * 9301 + 49297) % 233280;
      return s / 233280;
    };
  }

  function photo(seed) {
    const rnd = lcg(seed);
    const pair = PALETTES[seed % PALETTES.length];
    const ops = [0.12, 0.09, 0.14, 0.07];
    let blobs = '';
    for (let i = 0; i < 4; i++) {
      const cx = Math.round(rnd() * 600);
      const cy = Math.round(rnd() * 460);
      const r = Math.round(50 + rnd() * 130);
      blobs +=
        '<circle cx="' + cx + '" cy="' + cy + '" r="' + r +
        '" fill="#ffffff" opacity="' + ops[i] + '"/>';
    }
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800" viewBox="0 0 600 800">' +
      '<defs><linearGradient id="g" x1="0" y1="0" x2="0.6" y2="1">' +
      '<stop offset="0" stop-color="' + pair[0] + '"/>' +
      '<stop offset="1" stop-color="' + pair[1] + '"/>' +
      '</linearGradient></defs>' +
      '<rect width="600" height="800" fill="url(#g)"/>' +
      blobs +
      '<circle cx="300" cy="330" r="100" fill="#0f172a" opacity="0.16"/>' +
      '<path d="M115 800 C115 650 200 585 300 585 C400 585 485 650 485 800 Z" fill="#0f172a" opacity="0.16"/>' +
      '</svg>';
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  // Full mock profiles. Interests come from the predefined list in
  // profile-schema.js so "N interests in common" compares like with like.
  // `photoCount` varies (1 to 6) so the gallery shows every size.
  const RAW = [
    {
      id: 1, seed: 1, name: 'Maya', age: 26, verified: true, distance: 3,
      lastActiveMin: 0, photoCount: 6,
      bio: 'Ceramics studio on weekends and the worst movie taste you will ever meet. ' +
        'I am usually covered in clay dust, hunting for the next street food stall, or ' +
        'dragging someone to a jazz night they swore they would not enjoy. New to the ' +
        'neighbourhood and looking for people to explore it with.',
      job: 'Ceramicist', education: 'Fine Arts, City College',
      lookingFor: 'friends',
      interests: ['Ceramics', 'Jazz', 'Street food', 'Film', 'Coffee'],
      prompts: [
        { prompt: 'A fact about me that surprises people...', answer: 'I have thrown over 400 mugs and kept exactly three.' },
        { prompt: "I'm looking for someone to join me for...", answer: 'Sunday morning flea markets, then dumplings.' },
      ],
      instagram: 'maya.makes.mugs', spotify: null,
      languages: ['English', 'Spanish'],
    },
    {
      id: 2, seed: 2, name: 'Zoe', age: 24, verified: false, distance: 5,
      lastActiveMin: 3, photoCount: 3,
      bio: 'Bike mechanic by day, questionable karaoke by night. Always up for a long ride ' +
        'out of town if there is a bakery at the end of it.',
      job: 'Bike mechanic', education: null,
      lookingFor: 'activity',
      interests: ['Cycling', 'Karaoke', 'Thrift finds', 'Baking'],
      prompts: [
        { prompt: 'A skill I could teach you...', answer: 'Fixing a flat in under five minutes.' },
      ],
      instagram: null, spotify: 'zoe_rides',
      languages: ['English'],
    },
    {
      id: 3, seed: 3, name: 'Priya', age: 29, verified: true, distance: 2,
      lastActiveMin: 12, photoCount: 4,
      bio: 'ER nurse. Ask me about the strangest thing I have ever x-rayed. Training for ' +
        'my first half marathon and looking for a running group that does not start at 5am.',
      job: 'ER nurse', education: 'Nursing, State University',
      lookingFor: 'activity',
      interests: ['Running', 'Cooking', 'Podcasts', 'Hiking'],
      prompts: [
        { prompt: 'A perfect weekend looks like...', answer: 'A long run, a longer brunch, a podcast and a nap.' },
        { prompt: 'My go-to comfort food...', answer: 'My grandmother\'s dal. I am still not allowed the recipe.' },
        { prompt: 'Ask me about...', answer: 'The best trail within an hour of the city.' },
      ],
      instagram: 'priya.runs', spotify: 'priyaplaylists',
      languages: ['English', 'Hindi'],
    },
    {
      id: 4, seed: 4, name: 'Jonas', age: 31, verified: false, distance: 7,
      lastActiveMin: 45, photoCount: 2,
      bio: 'I build synthesizers that mostly work. Coffee first, opinions after. Hosting a ' +
        'monthly board game night and always short of players.',
      job: 'Sound engineer', education: 'Electronics, Technical Institute',
      lookingFor: 'hobby',
      interests: ['Synths', 'Board games', 'Coffee', 'Coding'],
      prompts: [
        { prompt: "I'm currently learning...", answer: 'How to solder without burning my thumb.' },
      ],
      instagram: null, spotify: null,
      languages: ['German', 'English'],
    },
    {
      id: 5, seed: 5, name: 'Amara', age: 27, verified: true, distance: 4,
      lastActiveMin: 25, photoCount: 5,
      bio: 'Botanical garden regular. Yes, my monstera has a name. Looking for a yoga buddy ' +
        'and someone who will come to gallery openings for the free snacks.',
      job: 'Landscape designer', education: 'Horticulture, Botanical Academy',
      lookingFor: 'friends',
      interests: ['Plants', 'Yoga', 'Galleries', 'Gardening', 'Photography'],
      prompts: [
        { prompt: 'The last thing I got excited about...', answer: 'A cutting that finally grew roots.' },
        { prompt: "A hobby I'd love to pick up...", answer: 'Film photography. I already own the camera.' },
      ],
      instagram: 'amara.grows', spotify: null,
      languages: ['English', 'French'],
    },
    {
      id: 6, seed: 6, name: 'Felix', age: 25, verified: false, distance: 6,
      lastActiveMin: 6, photoCount: 3,
      bio: 'Line cook. I will feed you and I will talk about it the whole time. Weekends are ' +
        'for hiking and record shops.',
      job: 'Line cook', education: 'Culinary School',
      lookingFor: 'activity',
      interests: ['Cooking', 'Vinyl', 'Hiking', 'Street food'],
      prompts: [
        { prompt: 'A skill I could teach you...', answer: 'Knife skills. Mind your fingers.' },
      ],
      instagram: null, spotify: 'felixspins',
      languages: ['German', 'French'],
    },
    {
      id: 7, seed: 7, name: 'Noor', age: 30, verified: true, distance: 3,
      lastActiveMin: 180, photoCount: 4,
      bio: 'Architect. I judge buildings quietly and slouch less than I should. Swimming laps ' +
        'three times a week and always looking for someone to see a film with afterwards.',
      job: 'Architect', education: 'Architecture, Polytechnic',
      lookingFor: 'friends',
      interests: ['Design', 'Swimming', 'Film', 'Photography', 'Travel'],
      prompts: [
        { prompt: 'Ask me about...', answer: 'The ugliest building in the city. I have a list.' },
      ],
      instagram: 'noor.draws.lines', spotify: null,
      languages: ['Arabic', 'English'],
    },
    {
      id: 8, seed: 8, name: 'Theo', age: 28, verified: false, distance: 8,
      lastActiveMin: 1, photoCount: 2,
      bio: 'Dog dad to a very loud beagle named Waffle. Bouldering most evenings.',
      job: 'Physio', education: null,
      lookingFor: 'activity',
      interests: ['Dogs', 'Bouldering', 'Podcasts', 'Hiking'],
      prompts: [],
      instagram: null, spotify: null,
      languages: ['English'],
    },
    {
      id: 9, seed: 9, name: 'Ines', age: 26, verified: true, distance: 5,
      lastActiveMin: 18, photoCount: 3,
      bio: 'Translator. Fluent in sarcasm and three actual languages. Running a small ' +
        'language exchange on Thursdays, all levels welcome.',
      job: 'Translator', education: 'Linguistics, University of Porto',
      lookingFor: 'study',
      interests: ['Books', 'Film', 'Languages', 'Writing', 'Travel', 'Coffee'],
      prompts: [
        { prompt: "I'm looking for someone to join me for...", answer: 'A reading group that actually finishes the book.' },
        { prompt: 'A fact about me that surprises people...', answer: 'I learned English from cooking shows.' },
      ],
      instagram: null, spotify: 'ines.reads',
      languages: ['Portuguese', 'English', 'French'],
    },
    // Two sparse profiles. Sasha has no age and Milo no distance (the
    // discovery filters never guess a value for a missing field), and both
    // have no languages and no lastActiveMin, so the missing-field rules for
    // those filters stay exercised too. Both skip most of the optional
    // fields so the full profile's empty states stay real instead of
    // theoretical.
    {
      id: 10, seed: 10, name: 'Sasha', age: null, verified: false, distance: 4,
      photoCount: 1,
      bio: 'Night-shift baker. I trade pastries for good playlist recommendations.',
      job: null, education: null, lookingFor: null,
      interests: ['Baking', 'Vinyl', 'Swimming'],
      prompts: [], instagram: null, spotify: null,
    },
    {
      id: 11, seed: 11, name: 'Milo', age: 33, verified: true, distance: null,
      photoCount: 2,
      bio: '',
      job: 'Cartographer', education: null, lookingFor: 'hobby',
      interests: [],
      prompts: [], instagram: null, spotify: null,
    },
  ];

  const PROFILES = RAW.map(function (p) {
    const base = p.seed * 7;
    const photos = [];
    for (let i = 1; i <= p.photoCount; i++) photos.push(photo(base + i));
    return Object.assign({}, p, {
      photos: photos,
      // First colour of the profile's photo gradient. The message list uses
      // it as the sender's colour so a thread always matches its avatar.
      accent: PALETTES[p.seed % PALETTES.length][0],
    });
  });

  const byId = new Map(PROFILES.map(function (p) { return [p.id, p]; }));

  // Mock message threads. Like everything else in Phase 1 these are static
  // demo data so the Messages tab has something to show before matching and
  // chat arrive. `last` is the preview row; `at` is a relative label, not a
  // timestamp; `id` is stable so a message report can name it. kinds:
  // 'text' (from either side), 'hi' and 'connection' (system messages).
  const THREADS = [
    {
      profileId: 1,
      unread: 2,
      last: { id: 'm-1', kind: 'text', from: 'them', text: 'The glaze accident was on purpose, I swear.', at: '2h' },
    },
    {
      profileId: 2,
      unread: 0,
      last: { id: 'm-2', kind: 'connection', from: 'system', text: 'You connected with Zoe', at: '5h' },
    },
    {
      profileId: 4,
      unread: 0,
      last: { id: 'm-3', kind: 'text', from: 'me', text: 'Fair. Which board game should I bring?', at: '1d' },
    },
    {
      profileId: 5,
      unread: 1,
      last: { id: 'm-4', kind: 'hi', from: 'them', text: 'Amara said hi', at: '2d' },
    },
  ];

  // ------------------------------------------------------------------ presence

  // Presence thresholds over the mock lastActiveMin offsets: online = active
  // within the last 2 minutes, recently active = within the last 30. The
  // labels are built here so every screen word presence the same way.
  // lastActiveMin is a fixed offset relative to page load, not a clock
  // timestamp, so a label reads the same for a whole session and identically
  // whenever a staging preview opens; real drifting last-seen timestamps
  // arrive with the real presence backend.
  const ONLINE_WITHIN_MIN = 2;
  const RECENT_WITHIN_MIN = 30;

  function presence(p) {
    if (!p || typeof p.lastActiveMin !== 'number') {
      return { status: 'none', label: null };
    }
    if (p.lastActiveMin <= ONLINE_WITHIN_MIN) {
      return { status: 'online', label: 'Online' };
    }
    if (p.lastActiveMin <= RECENT_WITHIN_MIN) {
      return { status: 'recent', label: 'Active ' + p.lastActiveMin + 'm ago' };
    }
    return { status: 'none', label: null };
  }

  return { PROFILES, byId, THREADS, presence, rng: lcg };
})();
