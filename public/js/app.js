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

  const state = {
    tab: 'discover',
    deck: shuffle(Data.PROFILES.map(function (p) { return p.id; }), DECK_SEED),
    pos: 0,
    photo: 0,
    liked: new Set(),
    supers: new Set(),
    counts: { passes: 0 },
  };

  let committing = false;   // a card is animating off-screen
  let suppressClick = false; // the pointerup that just ended was a drag

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
    return state.deck.slice(state.pos);
  }

  function renderDiscover() {
    const section = document.createElement('section');
    section.dataset.screen = 'discover';
    section.className = 'h-full flex flex-col gap-3 px-4 pt-3 pb-3';
    const deckEl = document.createElement('div');
    deckEl.id = 'deck';
    deckEl.className = 'relative flex-1 min-h-0';
    const actions = document.createElement('div');
    actions.id = 'actions';
    actions.className = 'shrink-0 flex items-center justify-center gap-6 pt-1';
    section.append(deckEl, actions);
    screenEl.append(section);

    const next = remaining();
    if (!next.length) {
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
        'w-12 h-12 rounded-full border border-cyan-400/70 text-cyan-300 bg-zinc-900/60 ' +
        'hover:border-cyan-300 hover:text-cyan-200 hover:scale-105 active:scale-90 ' +
        'transition-all duration-150', 'w-6 h-6'),
      actionButton('like', 'heart', 'Like',
        'w-14 h-14 rounded-full bg-gradient-to-br from-fuchsia-500 to-violet-600 text-white ' +
        'shadow-lg shadow-fuchsia-600/30 hover:scale-105 active:scale-90 ' +
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
      'focus-visible:ring-2 focus-visible:ring-fuchsia-400 ' + cls;
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
    if (state.tab !== 'discover' || committing || !currentProfile()) return;
    if (e.target && /input|textarea|select/i.test(e.target.tagName)) return;
    if (e.key === 'ArrowLeft') commit('pass');
    else if (e.key === 'ArrowRight') commit('like');
    else if (e.key === 'ArrowUp') commit('super');
  });

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
      '<p class="font-semibold text-zinc-100 truncate">' + escapeHtml(p.name + ', ' + p.age) +
      (p.verified
        ? ' <span class="align-middle text-fuchsia-300">' + icon('shield-check', 'w-4 h-4') + '</span>'
        : '') +
      '</p>' +
      '</div>';
    // Status first, distance second, both as plain text.
    const secondary = document.createElement('p');
    secondary.className = 'text-xs text-zinc-400';
    secondary.textContent =
      (presence.label ? presence.label + ' · ' : '') + p.distance + ' km away';
    row.querySelector('.flex-1').append(secondary);
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('aria-label', 'Remove like');
    b.className =
      'p-2 rounded-full text-zinc-500 hover:text-fuchsia-300 hover:bg-zinc-800 ' +
      'active:scale-90 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400';
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
    const wrap = document.createElement('div');
    wrap.className = 'flex-1 flex';
    wrap.append(UI.EmptyState({
      icon: 'message-circle',
      title: 'No messages yet',
      body: 'Matches open a chat. Your conversations will live here.',
      actionLabel: 'Open Discover',
      onAction: go('discover'),
    }));
    section.append(wrap);
    screenEl.append(section);
  }

  function renderProfile() {
    const v = Data.VIEWER;
    const section = document.createElement('section');
    section.dataset.screen = 'profile';
    section.className = 'px-4 py-4 flex flex-col gap-4';
    section.innerHTML =
      '<div class="rounded-3xl overflow-hidden border border-zinc-800 bg-zinc-900">' +
      '<div class="h-24 bg-gradient-to-r from-fuchsia-600/40 to-violet-600/40"></div>' +
      '<div class="px-5 pb-5 -mt-8">' +
      '<img src="' + v.photo + '" alt="" class="w-16 h-16 rounded-full object-cover border-4 border-zinc-900 bg-zinc-800">' +
      '<div class="flex items-center gap-2 mt-2">' +
      '<h2 class="text-xl font-bold text-zinc-100">' + v.name + ', ' + v.age + '</h2>' +
      '<span class="text-fuchsia-300" title="Verified profile">' + icon('shield-check', 'w-5 h-5') + '</span>' +
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
        'hover:bg-zinc-800/60 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-fuchsia-400';
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
    toast('Discovery preferences arrive in a later phase');
  });

  route();
})();
