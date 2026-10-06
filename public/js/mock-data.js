// Omichat Phase 1 mock data.
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

  const RAW = [
    {
      id: 1, seed: 1, name: 'Maya', age: 26, verified: true, distance: 3,
      bio: 'Ceramics studio on weekends and the worst movie taste you will ever meet.',
      interests: ['Ceramics', 'Jazz', 'Street food'],
    },
    {
      id: 2, seed: 2, name: 'Zoe', age: 24, verified: false, distance: 5,
      bio: 'Bike mechanic by day, questionable karaoke by night.',
      interests: ['Cycling', 'Karaoke', 'Thrift finds'],
    },
    {
      id: 3, seed: 3, name: 'Priya', age: 29, verified: true, distance: 2,
      bio: 'ER nurse. Ask me about the strangest thing I have ever x-rayed.',
      interests: ['Running', 'Cooking', 'Podcasts'],
    },
    {
      id: 4, seed: 4, name: 'Jonas', age: 31, verified: false, distance: 7,
      bio: 'I build synthesizers that mostly work. Coffee first, opinions after.',
      interests: ['Synths', 'Board games', 'Coffee'],
    },
    {
      id: 5, seed: 5, name: 'Amara', age: 27, verified: true, distance: 4,
      bio: 'Botanical garden regular. Yes, my monstera has a name.',
      interests: ['Plants', 'Yoga', 'Galleries'],
    },
    {
      id: 6, seed: 6, name: 'Felix', age: 25, verified: false, distance: 6,
      bio: 'Line cook. I will feed you and I will talk about it the whole time.',
      interests: ['Cooking', 'Vinyl', 'Hiking'],
    },
    {
      id: 7, seed: 7, name: 'Noor', age: 30, verified: true, distance: 3,
      bio: 'Architect. I judge buildings quietly and slouch less than I should.',
      interests: ['Design', 'Swimming', 'Film'],
    },
    {
      id: 8, seed: 8, name: 'Theo', age: 28, verified: false, distance: 8,
      bio: 'Dog dad to a very loud beagle named Waffle.',
      interests: ['Dogs', 'Bouldering', 'Podcasts'],
    },
    {
      id: 9, seed: 9, name: 'Ines', age: 26, verified: true, distance: 5,
      bio: 'Translator. Fluent in sarcasm and three actual languages.',
      interests: ['Books', 'Cinema', 'Languages'],
    },
  ];

  const PROFILES = RAW.map(function (p) {
    const base = p.seed * 7;
    return Object.assign({}, p, {
      photos: [photo(base + 1), photo(base + 2), photo(base + 3)],
      // First colour of the profile's photo gradient. The message list uses
      // it as the sender's colour so a thread always matches its avatar.
      accent: PALETTES[p.seed % PALETTES.length][0],
    });
  });

  const byId = new Map(PROFILES.map(function (p) { return [p.id, p]; }));

  // Mock message threads. Like everything else in Phase 1 these are static
  // demo data so the Messages tab has something to show before matching and
  // chat arrive. `last` is the preview row; `at` is a relative label, not a
  // timestamp. kinds: 'text' (from either side), 'superlike' and 'match'
  // (system messages).
  const THREADS = [
    {
      profileId: 1,
      unread: 2,
      last: { kind: 'text', from: 'them', text: 'The glaze accident was on purpose, I swear.', at: '2h' },
    },
    {
      profileId: 2,
      unread: 0,
      last: { kind: 'match', from: 'system', text: 'You matched with Zoe', at: '5h' },
    },
    {
      profileId: 4,
      unread: 0,
      last: { kind: 'text', from: 'me', text: 'Fair. Which board game should I bring?', at: '1d' },
    },
    {
      profileId: 5,
      unread: 1,
      last: { kind: 'superlike', from: 'them', text: 'Amara Super Liked you', at: '2d' },
    },
  ];

  // The signed-in viewer is mock too in Phase 1.
  const VIEWER = {
    name: 'Alex',
    age: 28,
    bio: 'Building the app I would want to use. Ask me about my sourdough.',
    photo: photo(999),
  };

  return { PROFILES, byId, THREADS, VIEWER };
})();
