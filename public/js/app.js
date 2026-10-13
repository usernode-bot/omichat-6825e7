// Omichat app logic: tab routing, the Discover deck and swipe gestures, the
// full profile screen and Edit Profile. Swipes live in memory only; the
// persisted features are account verification and the viewer's own profile
// on the Profile tab.
//
// Swipe contract: drag right = Say hi, left = Skip. The card tracks the
// finger 1:1 with a slight rotation, the SAY HI / SKIP stamps fade in with
// the drag, and a committed swipe animates the card off-screen before the
// next profile shows. Tapping the card's details opens the full profile.
//
// Routes: #discover, #discover/<id> (full profile), #hellos, #connections,
// #messages, #profile, #profile/edit, #profile/preview.
(function () {
  'use strict';

  const Data = window.OmichatData;
  const UI = window.OmichatComponents;
  const icon = window.OmichatIcons.icon;
  const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // The iframe carries the platform token in the URL; forward it on API
  // calls as `x-usernode-token` (what server.js expects). These are the
  // app's first authenticated backend calls — everything else is still mock.
  const API_TOKEN = new URLSearchParams(location.search).get('token') || '';

  function api(path, opts) {
    opts = opts || {};
    const headers = { 'content-type': 'application/json' };
    if (API_TOKEN) headers['x-usernode-token'] = API_TOKEN;
    return fetch(path, {
      method: opts.method || 'GET',
      headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
  }

  // Shuffles with the seeded RNG from mock-data when given a seed, so the
  // deck order is stable across loads and proposal screenshots; without a
  // seed it stays random. The fixed seed below puts Maya (online) on top of
  // the initial deck so presence is always visible on the first card.
  const DECK_SEED = 37;

  function shuffle(arr, seed) {
    const a = arr.slice();
    const rnd = seed === undefined ? Math.random : Data.rng(seed);
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function clamp(n, lo, hi) {
    return Math.max(lo, Math.min(hi, n));
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ------------------------------------------------------------ filters

  const AGE_OPTIONS = [{ value: null, label: 'Any' }].concat(
    (function () {
      const opts = [];
      for (let n = 18; n <= 80; n++) opts.push({ value: n, label: String(n) });
      return opts;
    })()
  );

  const DISTANCE_OPTIONS = [
    { value: null, label: 'Any distance' },
    { value: 1, label: 'Up to 1 km' },
    { value: 2, label: 'Up to 2 km' },
    { value: 5, label: 'Up to 5 km' },
    { value: 10, label: 'Up to 10 km' },
    { value: 25, label: 'Up to 25 km' },
    { value: 50, label: 'Up to 50 km' },
    { value: 100, label: 'Up to 100 km' },
  ];

  function filtersActive() {
    const f = state.filters;
    return f.minAge != null || f.maxAge != null || f.maxDistance != null;
  }

  // A profile lacking an age or a distance shows only while the matching
  // filter is unset. The deck never invents a value for missing data, so it
  // never filters on one either: with filters off, everyone is swipable.
  function matchesFilters(p) {
    const f = state.filters;
    if (p.age == null) {
      if (f.minAge != null || f.maxAge != null) return false;
    } else {
      if (f.minAge != null && p.age < f.minAge) return false;
      if (f.maxAge != null && p.age > f.maxAge) return false;
    }
    if (f.maxDistance != null && (p.distance == null || p.distance > f.maxDistance)) {
      return false;
    }
    return true;
  }

  // Short label for the deck's filter pill, e.g. "24–40 · 10 km".
  function filtersSummary() {
    const f = state.filters;
    const parts = [];
    if (f.minAge != null && f.maxAge != null) parts.push(f.minAge + '–' + f.maxAge);
    else if (f.minAge != null) parts.push(f.minAge + '+');
    else if (f.maxAge != null) parts.push('up to ' + f.maxAge);
    if (f.maxDistance != null) parts.push(f.maxDistance + ' km');
    return parts.join(' · ');
  }

  const state = {
    tab: 'discover',
    // Sub-screen within the tab: null, { kind: 'person', id },
    // { kind: 'edit' } or { kind: 'preview' }.
    view: null,
    deck: shuffle(Data.PROFILES.map(function (p) { return p.id; }), DECK_SEED),
    pos: 0,
    photo: 0,
    hellos: new Set(),
    counts: { skips: 0 },
    acted: new Set(),
    // The viewer's own profile: undefined = loading, null = unavailable
    // here, else { username, profile } (profile null until first saved).
    me: undefined,
    // Verification status. undefined = not loaded yet, null = unavailable
    // (no auth here, server unreachable): no card, no badge, never a fake one.
    verification: undefined,
    // Discovery filters. null means the filter is off; a profile missing the
    // field a filter is set on is hidden rather than guessed about.
    filters: { minAge: null, maxAge: null, maxDistance: null },
  };

  // In-card state of the email flow, kept across re-renders of the Profile
  // tab: 'idle' -> 'email' (type an address) -> 'code' (confirm the code).
  const verifUi = {
    emailOpen: false,
    stage: 'email',
    error: '',
    demoCode: '',
    resendAt: 0,
  };
  let verifTimer = null;
  let verifBusy = false;

  let committing = false;   // a card is animating off-screen
  let suppressClick = false; // the pointerup that just ended was a drag
  let filtersOpen = false;  // the filters sheet is up; keys go to it, not the deck

  const screenEl = document.getElementById('screen');
  const tabbarEl = document.getElementById('tabbar');

  function toast(msg) {
    if (window.unNative && typeof window.unNative.toast === 'function') {
      window.unNative.toast(msg);
    }
  }

  function go(tab) {
    return function () { location.hash = '#' + tab; };
  }

  // ---------------------------------------------------------------- render

  // Discover fills the viewport between header and tab bar; the other tabs
  // scroll.
  const SCREEN_CLASSES = {
    discover: 'flex-1 min-h-0 overflow-hidden',
    hellos: 'flex-1 min-h-0 overflow-y-auto overscroll-contain',
    connections: 'flex-1 min-h-0 overflow-y-auto overscroll-contain',
    messages: 'flex-1 min-h-0 overflow-y-auto overscroll-contain',
    profile: 'flex-1 min-h-0 overflow-y-auto overscroll-contain',
  };

  function render() {
    // Sub-screens (full profile, edit, preview) manage their own scrolling.
    screenEl.className = state.view ? 'flex-1 min-h-0 overflow-hidden' : SCREEN_CLASSES[state.tab];
    screenEl.innerHTML = '';
    if (state.view && state.view.kind === 'person') renderPerson();
    else if (state.view && state.view.kind === 'edit') renderEdit();
    else if (state.view && state.view.kind === 'preview') renderPreview();
    else if (state.tab === 'discover') renderDiscover();
    else if (state.tab === 'hellos') renderHellos();
    else if (state.tab === 'connections') renderConnections();
    else if (state.tab === 'messages') renderMessages();
    else renderProfile();
    UI.renderTabbar(tabbarEl, state.tab, state.hellos.size);
  }

  // The viewer's saved interests, or null while their profile is loading
  // or unavailable (cards then leave the "in common" line out).
  function viewerInterests() {
    if (!state.me) return null;
    return state.me.profile ? state.me.profile.interests || [] : [];
  }

  // People skipped or greeted since the deck was last reset.
  function hasActed(id) {
    return state.acted.has(id);
  }

  // -------------------------------------------------------------- discover

  function remaining() {
    return state.deck.slice(state.pos).filter(function (id) {
      const p = Data.byId.get(id);
      return p && matchesFilters(p) && !hasActed(id);
    });
  }

  // The deck's filter pill. Doubles as the live summary: once a filter is
  // set it reads like "24–40 · 10 km" instead of the plain "Filters".
  function filtersButton() {
    const active = filtersActive();
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.testid = 'filters-button';
    b.setAttribute('aria-label', 'Discovery filters');
    b.className =
      'flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-medium ' +
      'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ' +
      (active
        ? 'border-sky-500/50 bg-sky-500/10 text-sky-300'
        : 'border-zinc-800 bg-zinc-900/60 text-zinc-300 hover:border-zinc-600 hover:text-zinc-100');
    b.innerHTML = icon('sliders-horizontal', 'w-3.5 h-3.5') + '<span></span>';
    b.querySelector('span').textContent = active ? filtersSummary() : 'Filters';
    b.addEventListener('click', openFilters);
    return b;
  }

  function renderDiscover() {
    const section = document.createElement('section');
    section.dataset.screen = 'discover';
    section.className = 'h-full flex flex-col gap-3 px-4 pt-3 pb-3';
    const filterRow = document.createElement('div');
    filterRow.className = 'shrink-0 flex justify-center';
    filterRow.append(filtersButton());
    const deckEl = document.createElement('div');
    deckEl.id = 'deck';
    deckEl.className = 'relative flex-1 min-h-0';
    const actions = document.createElement('div');
    actions.id = 'actions';
    actions.className = 'shrink-0 flex items-center justify-center gap-6 pt-1';
    section.append(filterRow, deckEl, actions);
    screenEl.append(section);

    const next = remaining();
    if (!next.length) {
      // Profiles still queued but none passing the filters: point at the
      // filters rather than implying the deck ran out.
      if (state.deck.slice(state.pos).length) {
        deckEl.append(UI.EmptyState({
          fill:
            'absolute inset-0 rounded-3xl border border-zinc-800 bg-zinc-900/60 ' +
            'flex flex-col items-center justify-center text-center gap-3 p-6',
          icon: 'sliders-horizontal',
          title: 'No one matches your filters',
          body: 'Loosen the age range or the distance to see more people.',
          actionLabel: 'Adjust filters',
          onAction: openFilters,
        }));
        return;
      }
      deckEl.append(UI.EmptyState({
        fill:
          'absolute inset-0 rounded-3xl border border-zinc-800 bg-zinc-900/60 ' +
          'flex flex-col items-center justify-center text-center gap-3 p-6',
        icon: 'compass',
        title: "You've seen everyone nearby.",
        body: "That's everyone within your current filters. Widen them to meet more people.",
        actionLabel: 'Expand Discovery',
        onAction: function () {
          state.deck = shuffle(Data.PROFILES.map(function (p) { return p.id; }), DECK_SEED);
          state.pos = 0;
          state.photo = 0;
          state.acted = new Set();
          toast('Showing everyone nearby again');
          render();
        },
      }));
      return;
    }

    const top = Data.byId.get(next[0]);
    const under = next[1] ? Data.byId.get(next[1]) : null;
    if (under) deckEl.append(UI.ProfileCard(under, { behind: true, viewerInterests: viewerInterests() }));
    const card = UI.ProfileCard(top, { viewerInterests: viewerInterests() });
    deckEl.append(card);
    attachDrag(card, top);
    renderActions(actions);
    state.photo = 0;
  }

  function currentCard() {
    const deckEl = document.getElementById('deck');
    return deckEl ? deckEl.querySelector('[data-testid="profile-card"]') : null;
  }

  function currentProfile() {
    const r = remaining();
    return r.length ? Data.byId.get(r[0]) : null;
  }

  function renderActions(actions) {
    actions.innerHTML = '';
    actions.append(
      actionButton('skip', 'x', 'Skip',
        'w-14 h-14 rounded-full border border-zinc-600 text-zinc-300 bg-zinc-900/60 ' +
        'hover:border-zinc-400 hover:text-white hover:scale-105 active:scale-90 ' +
        'transition-all duration-150', 'w-7 h-7'),
      actionButton('hi', 'hand', 'Say hi',
        'w-14 h-14 rounded-full bg-gradient-to-br from-sky-500 to-indigo-600 text-white ' +
        'shadow-lg shadow-sky-600/30 hover:scale-105 active:scale-90 ' +
        'transition-all duration-150', 'w-7 h-7')
    );
  }

  function actionButton(action, iconName, label, cls, iconCls) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.action = action;
    b.setAttribute('aria-label', label);
    b.className =
      'flex items-center justify-center shrink-0 focus-visible:outline-none ' +
      'focus-visible:ring-2 focus-visible:ring-sky-400 ' + cls;
    b.innerHTML = icon(iconName, iconCls);
    b.addEventListener('click', function () { commit(action); });
    return b;
  }

  // Photo state lives on the current card only; dots and tap zones update it.
  function setPhoto(card, profile, idx) {
    const img = card.querySelector('[data-photo]');
    if (img) img.src = profile.photos[idx];
    card.querySelectorAll('[data-dot-index]').forEach(function (d) {
      const i = Number(d.dataset.dotIndex);
      d.className =
        'h-1.5 rounded-full transition-all pointer-events-auto ' +
        (i === idx ? 'w-5 bg-white' : 'w-1.5 bg-white/40');
    });
  }

  function attachDrag(card, profile) {
    let sx = 0, sy = 0, dx = 0, dy = 0, pid = null, active = false, moved = false;
    const badges = {
      hi: card.querySelector('[data-badge="hi"]'),
      skip: card.querySelector('[data-badge="skip"]'),
    };

    function apply() {
      const rot = clamp(dx / 16, -14, 14);
      card.style.transform = 'translate3d(' + dx + 'px, ' + dy + 'px, 0) rotate(' + rot + 'deg)';
      badges.hi.style.opacity = clamp((dx - 24) / 80, 0, 1);
      badges.skip.style.opacity = clamp((-dx - 24) / 80, 0, 1);
    }

    function resetBadges() {
      badges.hi.style.opacity = 0;
      badges.skip.style.opacity = 0;
    }

    card.addEventListener('pointerdown', function (e) {
      if (committing) return;
      active = true;
      pid = e.pointerId;
      sx = e.clientX;
      sy = e.clientY;
      dx = 0;
      dy = 0;
      moved = false;
      card.style.transition = 'none';
    });

    card.addEventListener('pointermove', function (e) {
      if (!active || e.pointerId !== pid) return;
      dx = e.clientX - sx;
      dy = e.clientY - sy;
      if (!moved && (Math.abs(dx) > 6 || Math.abs(dy) > 6)) {
        moved = true;
        try { card.setPointerCapture(pid); } catch (err) { /* pointer already gone */ }
      }
      if (moved) apply();
    });

    function finish(e, cancelled) {
      if (!active || e.pointerId !== pid) return;
      active = false;
      if (!cancelled && moved) {
        if (dx > 110) { suppressClick = true; return commit('hi'); }
        if (dx < -110) { suppressClick = true; return commit('skip'); }
      }
      resetBadges();
      if (moved) {
        suppressClick = true;
        if (REDUCED) {
          card.style.transform = '';
        } else {
          card.style.transition =
            'transform 320ms cubic-bezier(0.18, 0.89, 0.32, 1.21)';
          card.style.transform = '';
        }
      }
      dx = 0;
      dy = 0;
    }

    card.addEventListener('pointerup', function (e) { finish(e, false); });
    card.addEventListener('pointercancel', function (e) { finish(e, true); });

    card.addEventListener('click', function (e) {
      if (suppressClick) { suppressClick = false; return; }
      if (committing) return;
      const count = profile.photos.length;
      if (e.target.closest('[data-photo-prev]')) {
        state.photo = (state.photo + count - 1) % count;
      } else if (e.target.closest('[data-photo-next]')) {
        state.photo = (state.photo + 1) % count;
      } else if (e.target.closest('[data-dot-index]')) {
        state.photo = Number(e.target.closest('[data-dot-index]').dataset.dotIndex);
      } else {
        // Anywhere else on the card (the middle of the photo, the details)
        // opens the full profile.
        location.hash = '#discover/' + profile.id;
        return;
      }
      setPhoto(card, profile, state.photo);
    });
  }

  function commit(action) {
    const deckEl = document.getElementById('deck');
    const card = currentCard();
    const profile = currentProfile();
    if (committing || !card || !profile) return;
    committing = true;

    const w = deckEl.clientWidth;
    const targets = {
      hi: 'translate3d(' + w * 1.5 + 'px, -40px, 0) rotate(30deg)',
      skip: 'translate3d(' + -w * 1.5 + 'px, -40px, 0) rotate(-30deg)',
    };

    const badge = card.querySelector('[data-badge="' + action + '"]');
    if (badge) badge.style.opacity = 1;
    card.style.transition = REDUCED
      ? 'none'
      : 'transform 340ms cubic-bezier(0.2, 0.7, 0.3, 1), opacity 340ms ease-in';
    card.style.transform = REDUCED ? 'none' : targets[action];
    if (!REDUCED) card.style.opacity = '0';

    record(profile, action);

    setTimeout(function () {
      committing = false;
      state.photo = 0;
      render();
    }, REDUCED ? 0 : 350);
  }

  // Records Skip or Say hi. The deck drops acted-on people (see remaining),
  // so this works for the top card and for a profile opened by link alike.
  function record(profile, action) {
    state.acted.add(profile.id);
    if (action === 'hi') {
      state.hellos.add(profile.id);
      toast('You said hi to ' + profile.name);
    } else {
      state.counts.skips++;
    }
  }

  // Keyboard support for desktop: arrows mirror the three actions.
  document.addEventListener('keydown', function (e) {
    if (filtersOpen || state.view) return;
    if (state.tab !== 'discover' || committing || !currentProfile()) return;
    if (e.target && /input|textarea|select/i.test(e.target.tagName)) return;
    if (e.key === 'ArrowLeft') commit('skip');
    else if (e.key === 'ArrowRight') commit('hi');
  });

  // ------------------------------------------------------------ full profile

  function renderPerson() {
    const p = Data.byId.get(state.view.id);
    if (!p) {
      const wrap = document.createElement('div');
      wrap.className = 'h-full flex';
      wrap.append(UI.EmptyState({
        icon: 'user',
        title: 'Profile not found',
        body: 'This person is no longer on Discover.',
        actionLabel: 'Back to Discover',
        onAction: go('discover'),
      }));
      screenEl.append(wrap);
      return;
    }
    screenEl.append(window.OmichatProfileView.build(p, {
      viewerInterests: viewerInterests(),
      onBack: go('discover'),
      onAction: function (action) {
        record(p, action);
        location.hash = '#discover';
      },
    }));
  }

  // ------------------------------------------------------------ filters sheet

  // The discovery filters sheet. Every control live-applies: the deck behind
  // it re-renders as each value changes. Presented with the platform's
  // bottom sheet when the native kit is available, else a plain overlay so
  // the filters still work outside the shell.
  function openFilters() {
    if (filtersOpen) return;
    filtersOpen = true;
    const content = document.createElement('div');
    content.className = 'px-5 pt-2 pb-7 flex flex-col gap-5';

    const head = document.createElement('div');
    head.className = 'flex items-center justify-between';
    const title = document.createElement('h2');
    title.className = 'text-lg font-bold text-zinc-100';
    title.textContent = 'Discovery filters';
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.textContent = 'Reset';
    reset.className =
      'rounded-full px-2 py-1 text-sm font-medium text-sky-300 hover:text-sky-200 ' +
      'active:scale-95 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400';
    head.append(title, reset);
    content.append(head);

    const minSel = selectControl('Minimum age', AGE_OPTIONS, state.filters.minAge);
    const maxSel = selectControl('Maximum age', AGE_OPTIONS, state.filters.maxAge);
    const ageRow = document.createElement('div');
    ageRow.className = 'grid grid-cols-2 gap-3';
    ageRow.append(minSel.wrap, maxSel.wrap);

    const ageWrap = document.createElement('div');
    ageWrap.className = 'flex flex-col gap-2';
    const ageLabel = document.createElement('p');
    ageLabel.className = 'text-sm font-medium text-zinc-300';
    ageLabel.textContent = 'Age range';
    ageWrap.append(ageLabel, ageRow,
      hint('Profiles without an age show only when no age filter is set.'));
    content.append(ageWrap);

    const distSel = selectControl('Maximum distance', DISTANCE_OPTIONS, state.filters.maxDistance);
    const distWrap = document.createElement('div');
    distWrap.className = 'flex flex-col gap-2';
    const distLabel = document.createElement('p');
    distLabel.className = 'text-sm font-medium text-zinc-300';
    distLabel.textContent = 'Distance';
    distWrap.append(distLabel,
      hint('Profiles without a distance show only when no distance filter is set.'));
    distWrap.append(distSel.wrap);
    content.append(distWrap);

    content.append(UI.Button('Done', { onClick: function () { sheet.dismiss(); } }));

    const sheet = presentSheet(content, function () { filtersOpen = false; });

    function applyChanged() {
      state.filters.minAge = minSel.value();
      state.filters.maxAge = maxSel.value();
      state.filters.maxDistance = distSel.value();
      // Keep the range valid: a minimum above the maximum pulls the maximum up.
      if (state.filters.minAge != null && state.filters.maxAge != null &&
          state.filters.minAge > state.filters.maxAge) {
        state.filters.maxAge = state.filters.minAge;
        maxSel.el.value = String(state.filters.maxAge);
      }
      if (state.tab === 'discover') render();
    }

    minSel.el.addEventListener('change', applyChanged);
    maxSel.el.addEventListener('change', applyChanged);
    distSel.el.addEventListener('change', applyChanged);

    reset.addEventListener('click', function () {
      state.filters = { minAge: null, maxAge: null, maxDistance: null };
      minSel.el.value = '';
      maxSel.el.value = '';
      distSel.el.value = '';
      if (state.tab === 'discover') render();
    });
  }

  function selectControl(label, options, value) {
    const wrap = document.createElement('label');
    wrap.className = 'flex flex-col gap-1.5 text-xs text-zinc-400';
    const name = document.createElement('span');
    name.textContent = label;
    const sel = document.createElement('select');
    sel.className =
      'rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm text-zinc-100 ' +
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400';
    options.forEach(function (o) {
      const opt = document.createElement('option');
      opt.value = o.value == null ? '' : String(o.value);
      opt.textContent = o.label;
      sel.append(opt);
    });
    sel.value = value == null ? '' : String(value);
    wrap.append(name, sel);
    return {
      wrap: wrap,
      el: sel,
      value: function () { return sel.value === '' ? null : Number(sel.value); },
    };
  }

  function hint(text) {
    const p = document.createElement('p');
    p.className = 'text-xs text-zinc-500';
    p.textContent = text;
    return p;
  }

  function presentSheet(content, onDismiss) {
    if (window.unNative && typeof window.unNative.presentSheet === 'function') {
      return window.unNative.presentSheet({ contentEl: content, onDismiss: onDismiss });
    }
    const backdrop = document.createElement('div');
    backdrop.className =
      'fixed inset-0 z-50 bg-black/60 flex items-end justify-center p-4';
    const card = document.createElement('div');
    card.className =
      'w-full max-w-md rounded-3xl bg-zinc-900 border border-zinc-800 shadow-2xl';
    card.append(content);
    backdrop.append(card);
    const sheet = {
      el: backdrop,
      dismiss: function () {
        backdrop.remove();
        if (onDismiss) onDismiss();
      },
    };
    backdrop.addEventListener('click', function (e) {
      if (e.target === backdrop) sheet.dismiss();
    });
    document.body.append(backdrop);
    return sheet;
  }

  // -------------------------------------------------------- likes and rest

  function likeRow(p) {
    const row = document.createElement('div');
    row.className =
      'flex items-center gap-3 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-3';
    // Online people get a small green dot on the avatar's bottom-right,
    // outlined like the tab bar's notification dot so it reads on the photo.
    const presence = Data.presence(p);
    row.innerHTML =
      '<span class="relative shrink-0">' +
      '<img src="' + p.photos[0] + '" alt="" class="w-14 h-14 rounded-xl object-cover">' +
      (presence.status === 'online'
        ? '<span aria-hidden="true" class="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-emerald-400 border-2 border-zinc-900"></span>'
        : '') +
      '</span>' +
      '<div class="flex-1 min-w-0">' +
      '<p class="font-semibold text-zinc-100 truncate">' +
      escapeHtml(p.name + (p.age == null ? '' : ', ' + p.age)) +
      (p.verified ? ' ' + UI.VerifiedBadge('w-4 h-4') : '') +
      '</p>' +
      '</div>';
    // Status first, distance second, both as plain text.
    const secondary = document.createElement('p');
    secondary.className = 'text-xs text-zinc-400';
    secondary.textContent =
      (presence.label ? presence.label + ' · ' : '') +
      (p.distance == null ? 'Distance unknown' : p.distance + ' km away');
    row.querySelector('.flex-1').append(secondary);
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('aria-label', 'Undo hi');
    b.className =
      'p-2 rounded-full text-zinc-500 hover:text-sky-300 hover:bg-zinc-800 ' +
      'active:scale-90 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400';
    b.innerHTML = icon('undo', 'w-5 h-5');
    b.addEventListener('click', function () {
      state.hellos.delete(p.id);
      render();
    });
    row.append(b);
    return row;
  }

  function renderHellos() {
    const section = document.createElement('section');
    section.dataset.screen = 'hellos';
    section.className = 'h-full flex flex-col';
    section.innerHTML =
      '<h1 class="px-4 pt-4 pb-2 text-xl font-bold text-zinc-100">Hellos</h1>';
    const list = document.createElement('div');
    list.className = 'px-4 pb-4 flex flex-col gap-2';
    section.append(list);
    screenEl.append(section);
    const greeted = Data.PROFILES.filter(function (p) {
      return state.hellos.has(p.id);
    });
    if (!greeted.length) {
      list.className = 'flex-1 flex';
      list.append(UI.EmptyState({
        icon: 'hand',
        title: 'No hellos yet',
        body: 'People you say hi to are saved here. Head to Discover to find someone who shares your interests.',
        actionLabel: 'Explore Discover',
        onAction: go('discover'),
      }));
      return;
    }
    greeted.forEach(function (p) { list.append(likeRow(p)); });
  }

  function renderConnections() {
    const section = document.createElement('section');
    section.dataset.screen = 'connections';
    section.className = 'h-full flex flex-col';
    section.innerHTML =
      '<h1 class="px-4 pt-4 pb-2 text-xl font-bold text-zinc-100">Connections</h1>';
    const wrap = document.createElement('div');
    wrap.className = 'flex-1 flex';
    wrap.append(UI.EmptyState({
      icon: 'users',
      title: 'No connections yet',
      body: 'When someone you say hi to says hi back, you connect and they show up here.',
      actionLabel: 'Start swiping',
      onAction: go('discover'),
    }));
    section.append(wrap);
    screenEl.append(section);
  }

  function renderMessages() {
    const section = document.createElement('section');
    section.dataset.screen = 'messages';
    section.className = 'h-full flex flex-col';
    section.innerHTML =
      '<h1 class="px-4 pt-4 pb-2 text-xl font-bold text-zinc-100">Messages</h1>';
    const list = document.createElement('div');
    list.className = 'px-4 pb-4 flex flex-col gap-2';
    section.append(list);
    screenEl.append(section);
    if (!Data.THREADS.length) {
      list.className = 'flex-1 flex';
      list.append(UI.EmptyState({
        icon: 'message-circle',
        title: 'No messages yet',
        body: 'Connections open a chat. Your conversations will live here.',
        actionLabel: 'Open Discover',
        onAction: go('discover'),
      }));
      return;
    }
    Data.THREADS.forEach(function (t) {
      const p = Data.byId.get(t.profileId);
      if (p) list.append(threadRow(p, t));
    });
  }

  // A message thread row. Colour coding: the sender's colour (their photo
  // gradient's first stop) rings the avatar, colours the name and the
  // unread dot; the message kind styles the preview line — your messages
  // get the accent "You:" prefix, a hi carries a wave mark, and a
  // connection is a system notice.
  function threadRow(p, thread) {
    const last = thread.last;
    const row = document.createElement('button');
    row.type = 'button';
    row.dataset.testid = 'thread-row';
    row.dataset.thread = p.id;
    row.className =
      'w-full flex items-center gap-3 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-3 ' +
      'text-left hover:border-zinc-700 transition-colors ' +
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400';
    row.innerHTML =
      '<img src="' + p.photos[0] + '" alt="" class="w-14 h-14 rounded-xl object-cover shrink-0">' +
      '<div class="flex-1 min-w-0">' +
      '<div class="flex items-center justify-between gap-2">' +
      '<p class="font-semibold truncate" style="color:' + p.accent + '">' +
      escapeHtml(p.name + (p.age == null ? '' : ', ' + p.age)) + '</p>' +
      '<span class="text-xs text-zinc-500 shrink-0">' + last.at + '</span>' +
      '</div>' + previewHtml(p, last) +
      '</div>' + (thread.unread > 0
        ? '<span class="shrink-0 w-2.5 h-2.5 rounded-full" style="background:' + p.accent + '" aria-label="' + thread.unread + ' unread"></span>'
        : '');
    row.addEventListener('click', function () {
      toast('Chat opens in a later phase');
    });
    return row;
  }

  function previewHtml(p, last) {
    if (last.kind === 'hi') {
      return '<p class="text-sm text-zinc-200 font-medium flex items-center gap-1.5 truncate">' +
        '<span class="text-sky-300 shrink-0">' + icon('hand', 'w-4 h-4') + '</span>' +
        '<span class="truncate">' + escapeHtml(last.text) + '</span></p>';
    }
    if (last.kind === 'connection') {
      return '<p class="text-sm text-zinc-300 flex items-center gap-1.5 truncate">' +
        '<span class="text-sky-300 shrink-0">' + icon('sparkles', 'w-4 h-4') + '</span>' +
        '<span class="truncate">' + escapeHtml(last.text) + '</span></p>';
    }
    if (last.from === 'me') {
      return '<p class="text-sm truncate"><span class="text-sky-300 font-medium">You:</span> ' +
        '<span class="text-zinc-400">' + escapeHtml(last.text) + '</span></p>';
    }
    return '<p class="text-sm text-zinc-400 truncate">' + escapeHtml(last.text) + '</p>';
  }

  // ------------------------------------------------------------ verification

  async function loadVerification() {
    if (!API_TOKEN) { state.verification = null; return; }
    try {
      const r = await api('/api/verification');
      if (!r.ok) throw new Error('status ' + r.status);
      state.verification = await r.json();
    } catch (err) {
      // Unavailable (local run with the auth gate closed, server down):
      // the app never pretends the viewer is verified.
      state.verification = null;
    }
  }

  function refreshVerification() {
    return loadVerification().then(function () {
      if (state.tab === 'profile') render();
    });
  }

  function verifLabel(tier) {
    if (tier === 'photo') return 'Photo verified';
    if (tier === 'email') return 'Verified';
    return 'Not verified';
  }

  // Small text button used for secondary in-row actions.
  function linkButton(label, onClick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.className =
      'text-xs font-semibold text-fuchsia-300 hover:text-fuchsia-200 ' +
      'disabled:text-zinc-600 disabled:hover:text-zinc-600 transition-colors ' +
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400 rounded px-1';
    b.addEventListener('click', onClick);
    return b;
  }

  function verifInput(type, placeholder) {
    const input = document.createElement('input');
    input.type = type;
    input.placeholder = placeholder;
    input.autocomplete = 'off';
    input.className =
      'w-full rounded-xl border border-zinc-700 bg-zinc-800/80 px-3 py-2 text-sm ' +
      'text-zinc-100 placeholder-zinc-500 focus:border-fuchsia-400 focus:outline-none ' +
      'focus-visible:ring-2 focus-visible:ring-fuchsia-400';
    return input;
  }

  function verifError() {
    const p = document.createElement('p');
    p.className = 'text-xs text-rose-300';
    return p;
  }

  // The "Verification" card: header row, email row, photo row. Inline
  // expansion only — no modal, matching the Profile tab's stacked rows.
  function buildVerificationCard() {
    const v = state.verification;
    const card = document.createElement('div');
    card.dataset.testid = 'verification-card';
    card.className =
      'rounded-2xl border border-zinc-800 divide-y divide-zinc-800 bg-zinc-900/60 overflow-hidden';

    const head = document.createElement('div');
    head.className = 'px-4 py-3.5 flex items-center gap-3';
    head.innerHTML =
      '<span class="' + (v.tier !== 'unverified' ? 'text-fuchsia-300' : 'text-zinc-500') + '">' +
      icon('shield-check', 'w-5 h-5') + '</span>' +
      '<p class="flex-1 text-sm font-semibold text-zinc-100">Verification</p>' +
      '<p class="text-xs text-zinc-400">' + verifLabel(v.tier) + '</p>';
    card.append(head);
    card.append(buildEmailRow());
    card.append(buildPhotoRow());
    return card;
  }

  function buildEmailRow() {
    const v = state.verification;
    const row = document.createElement('div');
    row.className = 'px-4 py-3.5 flex flex-col gap-3';

    const head = document.createElement('div');
    head.className = 'flex items-center gap-3';
    head.innerHTML =
      '<span class="text-zinc-500">' + icon('shield-check', 'w-5 h-5') + '</span>' +
      '<div class="flex-1 min-w-0">' +
      '<p class="text-sm font-medium text-zinc-200">Email verification</p>' +
      '<p class="text-xs text-zinc-400 mt-0.5" data-sub></p></div>';
    const sub = head.querySelector('[data-sub]');
    row.append(head);

    if (v.email.verified) {
      sub.textContent = 'Verified' + (v.email.address ? ': ' + v.email.address : '');
      head.append(linkButton('Update email', function () {
        verifUi.emailOpen = true;
        verifUi.stage = 'email';
        verifUi.error = '';
        verifUi.demoCode = '';
        render();
      }));
    } else if (!verifUi.emailOpen) {
      sub.textContent = 'Confirm your email to earn the Verified badge.';
      const b = UI.Button('Get verified', {
        onClick: function () {
          verifUi.emailOpen = true;
          verifUi.stage = 'email';
          verifUi.error = '';
          render();
        },
      });
      b.className = b.className.replace('px-5 py-2.5', 'px-4 py-2 text-xs');
      head.append(b);
    } else {
      sub.textContent = verifUi.stage === 'email'
        ? 'We will send a 6-digit code to your inbox.'
        : 'Enter the code we sent you.';
      row.append(buildEmailFlow());
    }
    return row;
  }

  function buildEmailFlow() {
    const panel = document.createElement('div');
    panel.className = 'flex flex-col gap-2';

    const errEl = verifError();
    if (verifUi.error) errEl.textContent = verifUi.error;
    if (verifUi.demoCode) {
      const demo = document.createElement('p');
      demo.className = 'text-xs text-amber-300';
      demo.textContent =
        'Staging demo: email is not configured here. Your code is ' + verifUi.demoCode + '.';
      panel.append(demo);
    }

    const submit = async function () {
      if (verifBusy) return;
      verifBusy = true;
      const btn = panel.querySelector('[data-verify-submit]');
      if (btn) btn.disabled = true;
      try {
        if (verifUi.stage === 'email') {
          const emailInput = panel.querySelector('[data-verify-email]');
          const r = await api('/api/verification/email/start', {
            method: 'POST', body: { email: emailInput.value },
          });
          const data = await r.json().catch(function () { return {}; });
          if (!r.ok) {
            verifUi.error = data.error || 'Could not send the code';
          } else {
            verifUi.stage = 'code';
            verifUi.error = '';
            verifUi.demoCode = data.demo ? data.code : '';
            verifUi.resendAt = Date.now() + 60 * 1000;
            toast('Verification code sent');
          }
        } else {
          const codeInput = panel.querySelector('[data-verify-code]');
          const r = await api('/api/verification/email/confirm', {
            method: 'POST', body: { code: codeInput.value },
          });
          const data = await r.json().catch(function () { return {}; });
          if (!r.ok) {
            verifUi.error = data.error || 'Could not confirm the code';
          } else {
            verifUi.emailOpen = false;
            verifUi.error = '';
            verifUi.demoCode = '';
            verifBusy = false;
            toast('Email verified');
            await refreshVerification();
            return;
          }
        }
      } catch (e) {
        verifUi.error = 'Something went wrong. Try again.';
      }
      verifBusy = false;
      render();
    };

    if (verifUi.stage === 'email') {
      const emailInput = verifInput('email', 'you@example.com');
      emailInput.dataset.verifyEmail = '';
      const send = UI.Button('Send code', { onClick: submit });
      send.dataset.verifySubmit = '';
      send.className = send.className.replace('px-5 py-2.5', 'px-4 py-2 text-xs');
      panel.append(emailInput, send);
    } else {
      const codeInput = verifInput('text', '6-digit code');
      codeInput.inputMode = 'numeric';
      codeInput.maxLength = 6;
      codeInput.dataset.verifyCode = '';
      const confirm = UI.Button('Confirm', { onClick: submit });
      confirm.dataset.verifySubmit = '';
      confirm.className = confirm.className.replace('px-5 py-2.5', 'px-4 py-2 text-xs');

      const actions = document.createElement('div');
      actions.className = 'flex items-center gap-3';
      actions.append(confirm);
      const resend = linkButton('Resend code', async function () {
        if (Date.now() < verifUi.resendAt) return;
        verifUi.stage = 'email';
        verifUi.error = '';
        verifUi.demoCode = '';
        render();
      });
      actions.append(resend);
      panel.append(codeInput, actions);

      if (verifTimer) clearInterval(verifTimer);
      const tick = function () {
        const left = verifUi.resendAt - Date.now();
        if (left <= 0) {
          resend.disabled = false;
          resend.textContent = 'Resend code';
        } else {
          resend.disabled = true;
          resend.textContent = 'Resend in ' + Math.ceil(left / 1000) + 's';
        }
      };
      tick();
      verifTimer = setInterval(function () {
        if (!document.contains(resend)) { clearInterval(verifTimer); verifTimer = null; return; }
        tick();
      }, 1000);
    }

    panel.append(errEl);
    return panel;
  }

  function buildPhotoRow() {
    const v = state.verification;
    const row = document.createElement('div');
    row.className = 'px-4 py-3.5 flex items-center gap-3';
    row.innerHTML =
      '<span class="text-zinc-500">' + icon('user', 'w-5 h-5') + '</span>' +
      '<div class="flex-1 min-w-0">' +
      '<p class="text-sm font-medium text-zinc-200">Photo verification</p>' +
      '<p class="text-xs text-zinc-400 mt-0.5" data-sub></p>' +
      '<p class="text-xs text-rose-300 mt-0.5" data-note></p></div>';
    const sub = row.querySelector('[data-sub]');
    const note = row.querySelector('[data-note]');

    if (v.photo.status === 'approved') {
      sub.textContent = 'Photo verified';
    } else if (v.photo.status === 'pending') {
      sub.textContent = 'Under review';
    } else {
      if (v.photo.status === 'rejected') {
        sub.textContent = 'Declined by a reviewer.';
        note.textContent = v.photo.note || '';
      } else {
        sub.textContent = 'Optional: a reviewer compares a selfie with your profile photos.';
      }
      const b = UI.Button(v.photo.status === 'rejected' ? 'Submit again' : 'Submit photo', {
        variant: 'outline',
        onClick: function () { row.querySelector('[data-photo-file]').click(); },
      });
      b.className = b.className.replace('px-5 py-2.5', 'px-4 py-2 text-xs');
      row.append(b);
    }

    // Hidden file input drives the upload; the bridge stores the file
    // platform-side and we persist only the returned id and URL.
    const file = document.createElement('input');
    file.type = 'file';
    file.accept = 'image/png,image/jpeg,image/webp';
    file.dataset.photoFile = '';
    file.className = 'hidden';
    file.addEventListener('change', async function () {
      const picked = file.files && file.files[0];
      file.value = '';
      if (!picked) return;
      try {
        await submitPhoto(picked);
        toast('Photo submitted for review');
      } catch (err) {
        note.textContent = err.message || 'Uploads are not available here';
        note.className = 'text-xs text-rose-300 mt-0.5';
      }
    });
    row.append(file);
    return row;
  }

  async function downscaleImage(file, maxSide) {
    const MAX = maxSide || 1024;
    let bitmap;
    try {
      bitmap = await createImageBitmap(file);
    } catch (err) {
      return file; // undecodable here: let platform storage sniffing decide
    }
    const scale = Math.min(1, MAX / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
    const blob = await new Promise(function (resolve) {
      canvas.toBlob(resolve, 'image/jpeg', 0.85);
    });
    if (bitmap.close) bitmap.close();
    return blob || file;
  }

  async function submitPhoto(picked) {
    const bridge = typeof usernode !== 'undefined' ? usernode : null;
    if (!bridge || typeof bridge.uploadFile !== 'function') {
      throw new Error('Uploads are not available here');
    }
    const blob = await downscaleImage(picked);
    const stored = await bridge.uploadFile(blob, { visibility: 'public' });
    const r = await api('/api/verification/photo', {
      method: 'POST',
      body: { fileId: stored.id, url: stored.url },
    });
    if (!r.ok) {
      const data = await r.json().catch(function () { return {}; });
      throw new Error(data.error || 'Could not submit the photo');
    }
    await refreshVerification();
  }

  // Reviewer card: only project members see it (the server answers 403 for
  // anyone else and the card quietly goes away).
  function buildReviewCard() {
    const card = document.createElement('div');
    card.dataset.testid = 'verification-review';
    card.className = 'rounded-2xl border border-zinc-800 bg-zinc-900/60 overflow-hidden';

    const head = document.createElement('div');
    head.className = 'px-4 py-3.5 flex items-center gap-3';
    head.innerHTML =
      '<span class="text-zinc-500">' + icon('shield-check', 'w-5 h-5') + '</span>' +
      '<div class="flex-1 min-w-0">' +
      '<p class="text-sm font-semibold text-zinc-100">Verification review</p>' +
      '<p class="text-xs text-zinc-400 mt-0.5">Decide pending photo submissions.</p></div>';
    card.append(head);

    const list = document.createElement('div');
    list.className = 'divide-y divide-zinc-800 border-t border-zinc-800';
    card.append(list);

    api('/api/verification/pending').then(async function (r) {
      if (!r.ok) { card.remove(); return; }
      const data = await r.json().catch(function () { return {}; });
      const rows = data.pending || [];
      if (!rows.length) {
        const empty = document.createElement('p');
        empty.className = 'px-4 py-3 text-xs text-zinc-400 border-t border-zinc-800';
        empty.textContent = 'Nothing is waiting for review.';
        card.append(empty);
        return;
      }
      rows.forEach(function (p) { list.append(reviewRow(p)); });
    }).catch(function () { card.remove(); });
    return card;
  }

  function reviewRow(p) {
    const row = document.createElement('div');
    row.className = 'px-4 py-3 flex flex-col gap-2';
    const top = document.createElement('div');
    top.className = 'flex items-center gap-3';
    top.innerHTML =
      '<img src="' + p.photo_url + '" alt="" class="w-14 h-14 rounded-xl object-cover shrink-0 bg-zinc-800">' +
      '<div class="flex-1 min-w-0">' +
      '<p class="text-sm font-medium text-zinc-100 truncate">' + escapeHtml(p.username) + '</p>' +
      '<p class="text-xs text-zinc-400">Submitted ' + new Date(p.photo_submitted_at).toLocaleString() + '</p></div>';
    row.append(top);

    const note = verifInput('text', 'Reason when declining (optional)');
    row.append(note);

    const actions = document.createElement('div');
    actions.className = 'flex items-center gap-3';
    const approve = UI.Button('Approve', {
      onClick: function () { decide('approve'); },
    });
    approve.className = approve.className.replace('px-5 py-2.5', 'px-4 py-2 text-xs');
    const decline = UI.Button('Decline', {
      variant: 'outline',
      onClick: function () { decide('reject'); },
    });
    decline.className = decline.className.replace('px-5 py-2.5', 'px-4 py-2 text-xs');
    actions.append(approve, decline);
    row.append(actions);

    async function decide(decision) {
      if (verifBusy) return;
      verifBusy = true;
      approve.disabled = true;
      decline.disabled = true;
      try {
        const r = await api('/api/verification/review', {
          method: 'POST',
          body: { userId: p.user_id, decision: decision, note: note.value },
        });
        if (r.ok) {
          verifBusy = false;
          toast(decision === 'approve' ? 'Photo verified' : 'Submission declined');
          await refreshVerification();
          return; // refreshVerification re-renders the whole tab
        }
      } catch (err) { /* fall through to re-enable */ }
      verifBusy = false;
      approve.disabled = false;
      decline.disabled = false;
    }
    return row;
  }

  // ---------------------------------------------------------------- profile

  // Asks the server even without a URL token: at the app's own address the
  // platform's edge signs the request in with a header instead.
  async function loadProfile() {
    try {
      const r = await api('/api/profile');
      if (!r.ok) throw new Error('status ' + r.status);
      state.me = await r.json();
    } catch (err) {
      // Unavailable here: no profile screen pretends to have saved anything.
      state.me = null;
    }
  }

  function myVerified() {
    return !!(state.verification && state.verification.tier !== 'unverified');
  }

  // The viewer's saved profile as the full-profile screen expects it.
  function myProfileForView(profile) {
    const p = Object.assign(window.OmichatSchema.empty(), profile || {});
    if (!p.name) p.name = (state.me && state.me.username) || 'You';
    return p;
  }

  function renderProfile() {
    const section = document.createElement('section');
    section.dataset.screen = 'profile';
    section.className = 'px-4 py-4 flex flex-col gap-4';

    const me = state.me;
    const profile = me && me.profile;
    const card = document.createElement('div');
    card.dataset.testid = 'my-profile';
    card.className = 'rounded-3xl overflow-hidden border border-zinc-800 bg-zinc-900';
    card.innerHTML =
      '<div class="h-24 bg-gradient-to-r from-sky-600/40 to-indigo-600/40"></div>' +
      '<div class="px-5 pb-5 -mt-8 flex flex-col" data-body></div>';
    const body = card.querySelector('[data-body]');

    const main = profile && profile.photos && profile.photos[0];
    if (main) {
      const img = document.createElement('img');
      img.src = UI.photoSrc(main);
      img.alt = '';
      img.className = 'w-16 h-16 rounded-full object-cover border-4 border-zinc-900 bg-zinc-800';
      body.append(img);
    } else {
      const ph = document.createElement('div');
      ph.className = 'w-16 h-16 rounded-full border-4 border-zinc-900 bg-zinc-800 text-zinc-500 flex items-center justify-center';
      ph.innerHTML = icon('user', 'w-7 h-7');
      body.append(ph);
    }

    const nameRow = document.createElement('div');
    nameRow.className = 'flex items-center gap-2 mt-2';
    const h2 = document.createElement('h2');
    h2.className = 'text-xl font-bold text-zinc-100';
    if (me === undefined) h2.textContent = 'Loading your profile...';
    else if (!me) h2.textContent = 'Your profile';
    else {
      const name = (profile && profile.name) || me.username || 'You';
      h2.textContent = name + (profile && profile.age != null ? ', ' + profile.age : '');
    }
    nameRow.append(h2);
    // Real verification status only: unavailable or unverified shows no badge.
    if (myVerified()) nameRow.insertAdjacentHTML('beforeend', UI.VerifiedBadge('w-5 h-5'));
    body.append(nameRow);

    const bio = document.createElement('p');
    bio.className = 'text-sm mt-1 ' + (profile && profile.bio ? 'text-zinc-400 line-clamp-3' : 'text-zinc-500');
    if (me === null) bio.textContent = 'Profile editing is not available here. Open Omichat inside Homeroom to edit your profile.';
    else if (me === undefined) bio.textContent = '';
    else bio.textContent = (profile && profile.bio) || 'No bio yet. Tell people what you are into.';
    body.append(bio);

    if (me) {
      const meter = document.createElement('div');
      meter.className = 'mt-4';
      meter.append(window.OmichatProfileEdit.CompletenessMeter(
        window.OmichatSchema.completeness(profile)));
      body.append(meter);

      const buttons = document.createElement('div');
      buttons.className = 'flex items-center gap-2 mt-4';
      const edit = UI.Button('Edit profile', { onClick: function () { location.hash = '#profile/edit'; } });
      edit.dataset.testid = 'edit-profile-button';
      const preview = UI.Button('Preview', { variant: 'outline', onClick: function () { location.hash = '#profile/preview'; } });
      buttons.append(edit, preview);
      body.append(buttons);
    }

    const stats = document.createElement('div');
    stats.className = 'grid grid-cols-2 gap-2 mt-4 text-center';
    stats.innerHTML =
      '<div class="rounded-2xl bg-zinc-800/60 py-3"><p class="text-lg font-bold text-zinc-100">' + state.hellos.size + '</p><p class="text-xs text-zinc-400">Hellos sent</p></div>' +
      '<div class="rounded-2xl bg-zinc-800/60 py-3"><p class="text-lg font-bold text-zinc-100">' + state.counts.skips + '</p><p class="text-xs text-zinc-400">Skipped</p></div>';
    body.append(stats);
    section.append(card);

    const rowsEl = document.createElement('div');
    rowsEl.className = 'rounded-2xl border border-zinc-800 divide-y divide-zinc-800 bg-zinc-900/60 overflow-hidden';
    [
      { icon: 'sliders-horizontal', label: 'Discovery Preferences' },
      { icon: 'bell', label: 'Notifications' },
      { icon: 'shield-check', label: 'Privacy and safety' },
    ].forEach(function (r) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className =
        'w-full flex items-center gap-3 px-4 py-3.5 text-left text-sm font-medium text-zinc-200 ' +
        'hover:bg-zinc-800/60 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-400';
      b.innerHTML =
        '<span class="text-zinc-500">' + icon(r.icon, 'w-5 h-5') + '</span>' +
        '<span class="flex-1">' + r.label + '</span>' +
        '<span class="text-zinc-600">' + icon('chevron-right', 'w-4 h-4') + '</span>';
      b.addEventListener('click', function () {
        toast('This arrives in a later phase');
      });
      rowsEl.append(b);
    });
    section.append(rowsEl);
    if (state.verification) {
      section.append(buildVerificationCard());
      if (state.verification.canReview) section.append(buildReviewCard());
    }
    screenEl.append(section);
  }

  // Edit Profile needs the saved profile first; until then it shows a
  // loading or unavailable state rather than an empty form that could
  // overwrite real data.
  function renderEdit() {
    const wrap = document.createElement('div');
    wrap.className = 'h-full flex';
    if (state.me === undefined) {
      wrap.append(UI.EmptyState({ icon: 'user', title: 'Loading your profile', body: 'One moment.' }));
      screenEl.append(wrap);
      return;
    }
    if (!state.me) {
      wrap.append(UI.EmptyState({
        icon: 'user',
        title: 'Profile editing is not available here',
        body: 'Open Omichat inside Homeroom to edit your profile.',
        actionLabel: 'Back to Profile',
        onAction: go('profile'),
      }));
      screenEl.append(wrap);
      return;
    }
    const screen = window.OmichatProfileEdit.build({
      me: state.me,
      save: function (profile) {
        return api('/api/profile', { method: 'PUT', body: { profile: profile } });
      },
      downscale: function (file) { return downscaleImage(file, 1280); },
      toast: toast,
      onDone: function (me) {
        state.me = me;
        location.hash = '#profile';
      },
      onCancel: go('profile'),
      onPreview: function (draft) { openPreviewOverlay(draft); },
    });
    screenEl.append(screen);
    if (window.unNative && typeof window.unNative.attachKeyboardAvoidance === 'function' && screen.scroller) {
      window.unNative.attachKeyboardAvoidance(screen.scroller);
    }
  }

  function renderPreview() {
    if (!state.me) { state.view = null; render(); return; }
    screenEl.append(window.OmichatProfileView.build(myProfileForView(state.me.profile), {
      testid: 'profile-preview',
      verified: myVerified(),
      backLabel: 'Profile',
      onBack: go('profile'),
    }));
  }

  // Preview from inside Edit Profile: an overlay above the form, so the
  // unsaved draft stays exactly as it was when the person comes back.
  function openPreviewOverlay(draft) {
    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 z-40 bg-zinc-950 flex justify-center';
    overlay.style.paddingTop = 'var(--un-safe-inset-top, env(safe-area-inset-top, 0px))';
    overlay.style.paddingBottom = 'var(--un-safe-inset-bottom, env(safe-area-inset-bottom, 0px))';
    const inner = document.createElement('div');
    inner.className = 'w-full max-w-md h-full';
    const close = function () { overlay.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = function (e) { if (e.key === 'Escape') close(); };
    inner.append(window.OmichatProfileView.build(myProfileForView(draft), {
      testid: 'profile-preview',
      verified: myVerified(),
      backLabel: 'Back to editing',
      onBack: close,
    }));
    overlay.append(inner);
    document.body.append(overlay);
    document.addEventListener('keydown', onKey);
    const back = overlay.querySelector('[data-back]');
    if (back) back.focus({ preventScroll: true });
  }

  // ------------------------------------------------------------- bootstrap

  // Old tab names keep working for links shared before the rename.
  const TAB_ALIASES = { likes: 'hellos', matches: 'connections' };

  function route() {
    const parts = location.hash.replace('#', '').split('/');
    const h = TAB_ALIASES[parts[0]] || parts[0];
    state.tab = UI.TABS.some(function (t) { return t.id === h; }) ? h : 'discover';
    state.view = null;
    if (state.tab === 'discover' && /^\d+$/.test(parts[1] || '')) {
      state.view = { kind: 'person', id: Number(parts[1]) };
    } else if (state.tab === 'profile' && (parts[1] === 'edit' || parts[1] === 'preview')) {
      state.view = { kind: parts[1] };
    }
    render();
  }

  window.addEventListener('hashchange', route);

  document.getElementById('btn-bell').addEventListener('click', function () {
    toast('No new notifications yet');
  });
  document.getElementById('btn-prefs').addEventListener('click', function () {
    openFilters();
  });

  route();
  // Verification status arrives asynchronously; re-render the Profile tab
  // (if that is where the user is) once it resolves.
  loadVerification().then(function () {
    if (state.tab === 'profile' && !document.querySelector('[data-testid="edit-profile"]')) render();
  });
  // The viewer's profile drives Edit Profile, the completeness meter and
  // the "in common" line on Discover cards. Never re-render over an open
  // Edit Profile form.
  loadProfile().then(function () {
    if (!document.querySelector('[data-testid="edit-profile"]')) render();
  });
})();
