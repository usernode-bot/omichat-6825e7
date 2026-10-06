// Omichat Phase 1 app logic: tab routing, the Discover deck and swipe
// gestures. Everything runs on mock data; swipes live in memory only.
//
// Swipe contract: drag right = Like, left = Pass, up = Super Like. The card
// tracks the finger 1:1 with a slight rotation, the LIKE / PASS /
// SUPER LIKE badges fade in with the drag, and a committed swipe animates
// the card off-screen before the next profile shows.
(function () {
  'use strict';

  const Data = window.OmichatData;
  const UI = window.OmichatComponents;
  const icon = window.OmichatIcons.icon;
  const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

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
    deck: shuffle(Data.PROFILES.map(function (p) { return p.id; }), DECK_SEED),
    pos: 0,
    photo: 0,
    liked: new Set(),
    supers: new Set(),
    counts: { passes: 0 },
    // Discovery filters. null means the filter is off; a profile missing the
    // field a filter is set on is hidden rather than guessed about.
    filters: { minAge: null, maxAge: null, maxDistance: null },
  };

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
    likes: 'flex-1 min-h-0 overflow-y-auto overscroll-contain',
    matches: 'flex-1 min-h-0 overflow-y-auto overscroll-contain',
    messages: 'flex-1 min-h-0 overflow-y-auto overscroll-contain',
    profile: 'flex-1 min-h-0 overflow-y-auto overscroll-contain',
  };

  function render() {
    screenEl.className = SCREEN_CLASSES[state.tab];
    screenEl.innerHTML = '';
    if (state.tab === 'discover') renderDiscover();
    else if (state.tab === 'likes') renderLikes();
    else if (state.tab === 'matches') renderMatches();
    else if (state.tab === 'messages') renderMessages();
    else renderProfile();
    UI.renderTabbar(tabbarEl, state.tab, state.liked.size);
  }

  // -------------------------------------------------------------- discover

  function remaining() {
    return state.deck.slice(state.pos).filter(function (id) {
      const p = Data.byId.get(id);
      return p && matchesFilters(p);
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
        icon: 'heart',
        title: "You've seen everyone nearby.",
        body: "That's everyone within your current filters. Widen them to meet more people.",
        actionLabel: 'Expand Discovery',
        onAction: function () {
          state.deck = shuffle(Data.PROFILES.map(function (p) { return p.id; }), DECK_SEED);
          state.pos = 0;
          state.photo = 0;
          toast('Showing everyone nearby again');
          render();
        },
      }));
      return;
    }

    const top = Data.byId.get(next[0]);
    const under = next[1] ? Data.byId.get(next[1]) : null;
    if (under) deckEl.append(UI.ProfileCard(under, { behind: true }));
    const card = UI.ProfileCard(top, {});
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
      actionButton('pass', 'x', 'Pass',
        'w-14 h-14 rounded-full border border-zinc-600 text-zinc-300 bg-zinc-900/60 ' +
        'hover:border-zinc-400 hover:text-white hover:scale-105 active:scale-90 ' +
        'transition-all duration-150', 'w-7 h-7'),
      actionButton('super', 'star', 'Super Like',
        'w-12 h-12 rounded-full border border-amber-400/70 text-amber-300 bg-zinc-900/60 ' +
        'hover:border-amber-300 hover:text-amber-200 hover:scale-105 active:scale-90 ' +
        'transition-all duration-150', 'w-6 h-6'),
      actionButton('like', 'heart', 'Like',
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
      like: card.querySelector('[data-badge="like"]'),
      pass: card.querySelector('[data-badge="pass"]'),
      super: card.querySelector('[data-badge="super"]'),
    };

    function superActive() {
      return dy < -40 && Math.abs(dy) > Math.abs(dx) * 1.2;
    }

    function apply() {
      const up = superActive();
      const rot = clamp(dx / 16, -14, 14);
      card.style.transform = up
        ? 'translate3d(' + dx * 0.25 + 'px, ' + dy + 'px, 0) rotate(0deg)'
        : 'translate3d(' + dx + 'px, ' + dy + 'px, 0) rotate(' + rot + 'deg)';
      badges.like.style.opacity = up ? 0 : clamp((dx - 24) / 80, 0, 1);
      badges.pass.style.opacity = up ? 0 : clamp((-dx - 24) / 80, 0, 1);
      badges.super.style.opacity = up ? clamp((-dy - 30) / 70, 0, 1) : 0;
    }

    function resetBadges() {
      badges.like.style.opacity = 0;
      badges.pass.style.opacity = 0;
      badges.super.style.opacity = 0;
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
        if (dx > 110) { suppressClick = true; return commit('like'); }
        if (dx < -110) { suppressClick = true; return commit('pass'); }
        if (superActive() && dy < -140) { suppressClick = true; return commit('super'); }
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
    const h = deckEl.clientHeight;
    const targets = {
      like: 'translate3d(' + w * 1.5 + 'px, -40px, 0) rotate(30deg)',
      pass: 'translate3d(' + -w * 1.5 + 'px, -40px, 0) rotate(-30deg)',
      super: 'translate3d(0, ' + -h * 1.6 + 'px, 0) rotate(0deg)',
    };

    const badge = card.querySelector('[data-badge="' + action + '"]');
    if (badge) badge.style.opacity = 1;
    card.style.transition = REDUCED
      ? 'none'
      : 'transform 340ms cubic-bezier(0.2, 0.7, 0.3, 1), opacity 340ms ease-in';
    card.style.transform = REDUCED ? 'none' : targets[action];
    if (!REDUCED && action !== 'super') card.style.opacity = '0';

    if (action === 'like') {
      state.liked.add(profile.id);
    } else if (action === 'super') {
      state.supers.add(profile.id);
      state.liked.add(profile.id);
      toast('Super Like sent to ' + profile.name);
    } else {
      state.counts.passes++;
    }

    setTimeout(function () {
      committing = false;
      state.photo = 0;
      state.pos++;
      render();
    }, REDUCED ? 0 : 350);
  }

  // Keyboard support for desktop: arrows mirror the three actions.
  document.addEventListener('keydown', function (e) {
    if (filtersOpen) return;
    if (state.tab !== 'discover' || committing || !currentProfile()) return;
    if (e.target && /input|textarea|select/i.test(e.target.tagName)) return;
    if (e.key === 'ArrowLeft') commit('pass');
    else if (e.key === 'ArrowRight') commit('like');
    else if (e.key === 'ArrowUp') commit('super');
  });

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
      (p.verified
        ? ' <span class="align-middle text-sky-300">' + icon('shield-check', 'w-4 h-4') + '</span>'
        : '') +
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
    b.setAttribute('aria-label', 'Remove like');
    b.className =
      'p-2 rounded-full text-zinc-500 hover:text-sky-300 hover:bg-zinc-800 ' +
      'active:scale-90 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400';
    b.innerHTML = icon('undo', 'w-5 h-5');
    b.addEventListener('click', function () {
      state.liked.delete(p.id);
      render();
    });
    row.append(b);
    return row;
  }

  function renderLikes() {
    const section = document.createElement('section');
    section.dataset.screen = 'likes';
    section.className = 'h-full flex flex-col';
    section.innerHTML =
      '<h1 class="px-4 pt-4 pb-2 text-xl font-bold text-zinc-100">Likes</h1>';
    const list = document.createElement('div');
    list.className = 'px-4 pb-4 flex flex-col gap-2';
    section.append(list);
    screenEl.append(section);
    const likedProfiles = Data.PROFILES.filter(function (p) {
      return state.liked.has(p.id);
    });
    if (!likedProfiles.length) {
      list.className = 'flex-1 flex';
      list.append(UI.EmptyState({
        icon: 'heart',
        title: 'No likes yet',
        body: 'People you Like are saved here. Head to Discover to find someone.',
        actionLabel: 'Explore Discover',
        onAction: go('discover'),
      }));
      return;
    }
    likedProfiles.forEach(function (p) { list.append(likeRow(p)); });
  }

  function renderMatches() {
    const section = document.createElement('section');
    section.dataset.screen = 'matches';
    section.className = 'h-full flex flex-col';
    section.innerHTML =
      '<h1 class="px-4 pt-4 pb-2 text-xl font-bold text-zinc-100">Matches</h1>';
    const wrap = document.createElement('div');
    wrap.className = 'flex-1 flex';
    wrap.append(UI.EmptyState({
      icon: 'sparkles',
      title: 'No matches yet',
      body: 'When someone you Like Likes you back, your match shows up here.',
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
        body: 'Matches open a chat. Your conversations will live here.',
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
  // get the accent "You:" prefix, a Super Like is gold, and a match is a
  // system notice.
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
    if (last.kind === 'superlike') {
      return '<p class="text-sm text-amber-300 font-medium flex items-center gap-1.5 truncate">' +
        icon('star', 'w-4 h-4 shrink-0') + '<span class="truncate">' + escapeHtml(last.text) + '</span></p>';
    }
    if (last.kind === 'match') {
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

  function renderProfile() {
    const v = Data.VIEWER;
    const section = document.createElement('section');
    section.dataset.screen = 'profile';
    section.className = 'px-4 py-4 flex flex-col gap-4';
    section.innerHTML =
      '<div class="rounded-3xl overflow-hidden border border-zinc-800 bg-zinc-900">' +
      '<div class="h-24 bg-gradient-to-r from-sky-600/40 to-indigo-600/40"></div>' +
      '<div class="px-5 pb-5 -mt-8">' +
      '<img src="' + v.photo + '" alt="" class="w-16 h-16 rounded-full object-cover border-4 border-zinc-900 bg-zinc-800">' +
      '<div class="flex items-center gap-2 mt-2">' +
      '<h2 class="text-xl font-bold text-zinc-100">' + v.name + ', ' + v.age + '</h2>' +
      '<span class="text-sky-300" title="Verified profile">' + icon('shield-check', 'w-5 h-5') + '</span>' +
      '</div>' +
      '<p class="text-sm text-zinc-400 mt-1">' + escapeHtml(v.bio) + '</p>' +
      '<div class="grid grid-cols-3 gap-2 mt-4 text-center">' +
      '<div class="rounded-2xl bg-zinc-800/60 py-3"><p class="text-lg font-bold text-zinc-100">' + state.liked.size + '</p><p class="text-xs text-zinc-400">Likes sent</p></div>' +
      '<div class="rounded-2xl bg-zinc-800/60 py-3"><p class="text-lg font-bold text-zinc-100">' + state.counts.passes + '</p><p class="text-xs text-zinc-400">Passes</p></div>' +
      '<div class="rounded-2xl bg-zinc-800/60 py-3"><p class="text-lg font-bold text-zinc-100">' + state.supers.size + '</p><p class="text-xs text-zinc-400">Super Likes</p></div>' +
      '</div></div></div>';

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
    screenEl.append(section);
  }

  // ------------------------------------------------------------- bootstrap

  function route() {
    const h = location.hash.replace('#', '');
    state.tab = UI.TABS.some(function (t) { return t.id === h; }) ? h : 'discover';
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
})();
