// Omichat Phase 1 app logic: tab routing, the Discover deck and swipe
// gestures. Swipes live in memory only; the one persisted feature is
// account verification on the Profile tab (see the verification section).
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

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
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
    deck: shuffle(Data.PROFILES.map(function (p) { return p.id; })),
    pos: 0,
    photo: 0,
    liked: new Set(),
    supers: new Set(),
    counts: { passes: 0 },
    // Verification status. undefined = not loaded yet, null = unavailable
    // (no auth here, server unreachable): no card, no badge, never a fake one.
    verification: undefined,
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
          state.deck = shuffle(Data.PROFILES.map(function (p) { return p.id; }));
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
    row.innerHTML =
      '<img src="' + p.photos[0] + '" alt="" class="w-14 h-14 rounded-xl object-cover shrink-0">' +
      '<div class="flex-1 min-w-0">' +
      '<p class="font-semibold text-zinc-100 truncate">' + escapeHtml(p.name + ', ' + p.age) +
      (p.verified ? ' ' + UI.VerifiedBadge('w-4 h-4') : '') +
      '</p>' +
      '<p class="text-xs text-zinc-400">' + p.distance + ' km away</p>' +
      '</div>';
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

  async function downscaleImage(file) {
    const MAX = 1024;
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
      // Real verification status only: unavailable or unverified shows no badge.
      (state.verification && state.verification.tier !== 'unverified'
        ? UI.VerifiedBadge('w-5 h-5') : '') +
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
    if (state.verification) {
      section.append(buildVerificationCard());
      if (state.verification.canReview) section.append(buildReviewCard());
    }
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
  // Verification status arrives asynchronously; re-render the Profile tab
  // (if that is where the user is) once it resolves.
  loadVerification().then(function () {
    if (state.tab === 'profile') render();
  });
})();
