// Omichat reusable UI components: Button, EmptyState, ProfileCard and the
// BottomNavigation. All render plain DOM so they can be composed in app.js
// and re-used by later phases (chat bubbles, match rows, etc.).
(function () {
  const icon = window.OmichatIcons.icon;

  // Primary is the app's one accent: fuchsia to violet. Outline is the
  // secondary surface action.
  const BUTTON_VARIANTS = {
    primary:
      'bg-gradient-to-r from-fuchsia-500 to-violet-600 text-white shadow-lg shadow-fuchsia-600/25 hover:from-fuchsia-400 hover:to-violet-500',
    outline:
      'border border-zinc-600 text-zinc-200 bg-zinc-900/60 hover:border-zinc-400 hover:text-white',
  };

  function Button(label, opts) {
    opts = opts || {};
    const b = document.createElement('button');
    b.type = 'button';
    b.className =
      'rounded-full px-5 py-2.5 text-sm font-semibold transition-all duration-150 active:scale-95 ' +
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400 ' +
      (BUTTON_VARIANTS[opts.variant || 'primary']);
    b.textContent = label;
    if (opts.onClick) b.addEventListener('click', opts.onClick);
    return b;
  }

  function EmptyState(opts) {
    const wrap = document.createElement('div');
    wrap.className = opts.fill
      ? opts.fill
      : 'flex-1 flex flex-col items-center justify-center text-center gap-3 px-6 py-10';
    wrap.innerHTML =
      '<div class="w-16 h-16 rounded-full bg-gradient-to-br from-fuchsia-500/25 to-violet-500/25 text-fuchsia-300 flex items-center justify-center">' +
      icon(opts.icon, 'w-8 h-8') +
      '</div>' +
      '<h2 class="text-lg font-bold text-zinc-100"></h2>' +
      '<p class="text-sm text-zinc-400 max-w-xs"></p>';
    wrap.querySelector('h2').textContent = opts.title;
    wrap.querySelector('p').textContent = opts.body;
    if (opts.actionLabel) {
      wrap.append(Button(opts.actionLabel, { onClick: opts.onAction }));
    }
    return wrap;
  }

  // Presence line: a green dot plus "Online", or "Active Xm ago" in the
  // muted grey the app's metadata uses. Renders null for profiles with no
  // status so callers add nothing to the layout. The dot is decorative
  // (aria-hidden); the visible label is the accessible state. Kept here so
  // ProfileCard, the Likes rows and later chat/match screens all word and
  // colour presence the same way.
  function presenceEl(profile) {
    const info = window.OmichatData.presence(profile);
    if (info.status === 'none') return null;
    const p = document.createElement('p');
    p.dataset.testid = 'presence';
    p.className = 'flex items-center gap-1.5 text-sm ' +
      (info.status === 'online' ? 'text-emerald-300' : 'text-zinc-400');
    if (info.status === 'online') {
      const dot = document.createElement('span');
      dot.setAttribute('aria-hidden', 'true');
      dot.className = 'w-2 h-2 rounded-full bg-emerald-400 shrink-0';
      p.append(dot);
    }
    const label = document.createElement('span');
    label.textContent = info.label;
    p.append(label);
    return p;
  }

  // A profile card. `opts.behind` renders the non-interactive under-stack
  // card that gives the deck its depth.
  function ProfileCard(profile, opts) {
    opts = opts || {};
    const el = document.createElement('article');
    el.dataset.testid = opts.behind ? 'profile-card-next' : 'profile-card';
    el.className =
      'absolute inset-0 rounded-3xl overflow-hidden bg-zinc-800 border border-zinc-700/50 shadow-2xl shadow-black/50 origin-bottom ' +
      (opts.behind
        ? 'scale-95 opacity-70'
        : 'will-change-transform touch-none');

    let inner =
      '<img src="' + profile.photos[0] + '" alt="" draggable="false" data-photo ' +
      'class="absolute inset-0 w-full h-full object-cover">' +
      '<div class="absolute inset-0 bg-gradient-to-t from-zinc-950/95 via-zinc-950/35 to-transparent"></div>';

    if (!opts.behind) {
      inner +=
        '<button type="button" data-photo-prev aria-label="Previous photo" ' +
        'class="absolute inset-y-0 left-0 w-1/3 z-10 focus-visible:outline-none"></button>' +
        '<button type="button" data-photo-next aria-label="Next photo" ' +
        'class="absolute inset-y-0 right-0 w-1/3 z-10 focus-visible:outline-none"></button>' +
        '<div class="absolute top-3 inset-x-0 z-20 flex justify-center gap-1.5 pointer-events-none" data-dots></div>' +
        '<div data-badge="pass" class="absolute top-6 left-5 z-30 -rotate-12 pointer-events-none rounded-xl border-4 border-zinc-300 px-3 py-0.5 text-2xl font-extrabold tracking-wider text-zinc-100 bg-zinc-900/30 opacity-0">PASS</div>' +
        '<div data-badge="like" class="absolute top-6 right-5 z-30 rotate-12 pointer-events-none rounded-xl border-4 border-fuchsia-400 px-3 py-0.5 text-2xl font-extrabold tracking-wider text-fuchsia-200 bg-zinc-900/30 opacity-0">LIKE</div>' +
        '<div data-badge="super" class="absolute top-14 left-1/2 z-30 -translate-x-1/2 pointer-events-none rounded-xl border-4 border-cyan-300 px-3 py-0.5 text-2xl font-extrabold tracking-wider text-cyan-100 bg-zinc-900/30 opacity-0">SUPER LIKE</div>';
    }

    inner +=
      '<div data-profile-info class="absolute inset-x-0 bottom-0 z-20 p-5 flex flex-col gap-2 ' +
      (opts.behind ? '' : 'pointer-events-none') + '">' +
      '<div class="flex items-center gap-2">' +
      '<h2 class="text-2xl font-bold text-white drop-shadow">' + profile.name + ', ' + profile.age + '</h2>' +
      (profile.verified
        ? '<span title="Verified profile" class="text-fuchsia-300">' + icon('shield-check', 'w-5 h-5') + '</span>'
        : '') +
      '</div>' +
      '<p class="flex items-center gap-1.5 text-sm text-zinc-300">' +
      icon('map-pin', 'w-4 h-4 text-zinc-400') +
      '<span>' + profile.distance + ' km away</span></p>' +
      '<p class="text-sm leading-relaxed text-zinc-300 line-clamp-2">' + profile.bio + '</p>' +
      '<div class="flex flex-wrap gap-2 pt-0.5">' +
      profile.interests.map(function (i) {
        return '<span class="rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-medium text-white">' + i + '</span>';
      }).join('') +
      '</div></div>';

    el.innerHTML = inner;

    // Presence joins the metadata block, above the distance line. Both the
    // interactive card and the behind card carry it, like the rest of the
    // metadata. Rendered as a DOM node so the label never passes through
    // the innerHTML string.
    const infoBlock = el.querySelector('[data-profile-info]');
    const presence = presenceEl(profile);
    if (infoBlock && presence) {
      infoBlock.insertBefore(presence, infoBlock.children[1]);
    }

    if (!opts.behind) {
      const dots = el.querySelector('[data-dots]');
      profile.photos.forEach(function (_, i) {
        const d = document.createElement('button');
        d.type = 'button';
        d.dataset.dotIndex = i;
        d.setAttribute('aria-label', 'Go to photo ' + (i + 1));
        d.className =
          'h-1.5 rounded-full transition-all pointer-events-auto ' +
          (i === 0 ? 'w-5 bg-white' : 'w-1.5 bg-white/40');
        dots.append(d);
      });
    }
    return el;
  }

  const TABS = [
    { id: 'discover', label: 'Discover', tabIcon: 'compass' },
    { id: 'likes', label: 'Likes', tabIcon: 'heart' },
    { id: 'matches', label: 'Matches', tabIcon: 'sparkles' },
    { id: 'messages', label: 'Messages', tabIcon: 'message-circle' },
    { id: 'profile', label: 'Profile', tabIcon: 'user' },
  ];

  function renderTabbar(container, active, likesCount) {
    container.className = 'shrink-0 border-t border-zinc-800 bg-zinc-950';
    container.style.paddingBottom =
      'var(--un-safe-inset-bottom, env(safe-area-inset-bottom, 0px))';
    container.innerHTML = '';
    const row = document.createElement('div');
    row.className = 'flex items-stretch justify-around';
    TABS.forEach(function (t) {
      const on = t.id === active;
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.tab = t.id;
      if (on) b.setAttribute('aria-current', 'page');
      b.className =
        'relative flex flex-col items-center gap-1 px-2 py-2.5 transition-colors ' +
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-fuchsia-400 ' +
        (on ? 'text-fuchsia-400' : 'text-zinc-500 hover:text-zinc-300');
      b.innerHTML =
        icon(t.tabIcon, 'w-6 h-6') +
        '<span class="text-xs font-medium">' + t.label + '</span>';
      if (t.id === 'likes' && likesCount > 0) {
        const dot = document.createElement('span');
        dot.className = 'absolute top-2 right-2.5 w-2 h-2 rounded-full bg-fuchsia-500';
        b.append(dot);
      }
      b.addEventListener('click', function () {
        location.hash = '#' + t.id;
      });
      row.append(b);
    });
    container.append(row);
  }

  window.OmichatComponents = {
    TABS: TABS,
    Button: Button,
    EmptyState: EmptyState,
    ProfileCard: ProfileCard,
    presenceEl: presenceEl,
    renderTabbar: renderTabbar,
  };
})();
