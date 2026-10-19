// Omichat full profile screen: swipeable photo gallery, the person's
// details, prompts, interests and optional social handles, with Skip and
// Say hi kept in a bar at the bottom. Used for Discover profiles and for the
// viewer's own "Preview" (without the action bar). Everything a person typed
// goes in through textContent, never innerHTML.
(function () {
  const icon = window.OmichatIcons.icon;
  const UI = window.OmichatComponents;
  const Schema = window.OmichatSchema;

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function sectionTitle(text) {
    return el('h3', 'text-sm font-semibold text-zinc-400', text);
  }

  function muted(text) {
    return el('p', 'text-sm text-zinc-500', text);
  }

  // Horizontal scroll-snap gallery: native 1:1 swiping on touch; the arrows
  // (wider screens), arrow keys and the dots on desktop. Up to 6 photos.
  // opts: { heightClass (default 'h-96'), testid }
  function gallery(photos, name, opts) {
    opts = opts || {};
    const wrap = el('div', 'relative bg-zinc-900 ' + (opts.heightClass || 'h-96'));
    wrap.dataset.testid = opts.testid || 'profile-gallery';
    const list = (photos || []).slice(0, Schema.LIMITS.photos);
    if (!list.length) {
      wrap.append(UI.PhotoPlaceholder('absolute inset-0', 'No photos yet'));
      return wrap;
    }
    const track = el('div', 'absolute inset-0 flex overflow-x-auto snap-x snap-mandatory overscroll-x-contain');
    track.style.scrollbarWidth = 'none';
    track.tabIndex = 0;
    track.setAttribute('aria-label', name + "'s photos");
    list.forEach(function (ph, i) {
      const img = document.createElement('img');
      img.src = UI.photoSrc(ph);
      img.alt = 'Photo ' + (i + 1) + ' of ' + list.length;
      img.draggable = false;
      img.className = 'w-full h-full shrink-0 snap-center object-cover';
      track.append(img);
    });
    wrap.append(track);

    if (list.length > 1) {
      const dots = el('div', 'absolute top-3 inset-x-0 flex justify-center gap-1.5 pointer-events-none');
      const dotEls = list.map(function (_, i) {
        const d = document.createElement('button');
        d.type = 'button';
        d.setAttribute('aria-label', 'Go to photo ' + (i + 1));
        d.className = 'h-1.5 rounded-full transition-all pointer-events-auto ' +
          (i === 0 ? 'w-5 bg-white' : 'w-1.5 bg-white/40');
        d.addEventListener('click', function () { go(i); });
        dots.append(d);
        return d;
      });
      wrap.append(dots);
      const count = el('span',
        'absolute bottom-3 right-3 rounded-full bg-zinc-950/60 px-2.5 py-1 text-xs font-medium text-white',
        '1 / ' + list.length);
      wrap.append(count);

      function arrow(dir) {
        const b = document.createElement('button');
        b.type = 'button';
        b.dataset.galleryArrow = dir;
        b.setAttribute('aria-label', dir === 'prev' ? 'Previous photo' : 'Next photo');
        b.className = 'hidden sm:flex absolute top-1/2 -translate-y-1/2 w-9 h-9 items-center justify-center rounded-full ' +
          'bg-zinc-950/60 text-white hover:bg-zinc-950/80 active:scale-90 transition-all disabled:opacity-0 ' +
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ' +
          (dir === 'prev' ? 'left-3' : 'right-3');
        b.innerHTML = icon(dir === 'prev' ? 'chevron-left' : 'chevron-right', 'w-5 h-5');
        b.addEventListener('click', function () {
          go(dir === 'prev' ? Math.max(0, current - 1) : Math.min(list.length - 1, current + 1));
        });
        wrap.append(b);
        return b;
      }
      const prevBtn = arrow('prev');
      const nextBtn = arrow('next');
      prevBtn.disabled = true;

      let current = 0;
      function go(i) {
        track.scrollTo({ left: i * track.clientWidth, behavior: 'smooth' });
      }
      track.addEventListener('scroll', function () {
        const i = Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
        if (i === current) return;
        current = i;
        dotEls.forEach(function (d, j) {
          d.className = 'h-1.5 rounded-full transition-all pointer-events-auto ' +
            (j === i ? 'w-5 bg-white' : 'w-1.5 bg-white/40');
        });
        count.textContent = (i + 1) + ' / ' + list.length;
        prevBtn.disabled = i === 0;
        nextBtn.disabled = i === list.length - 1;
      }, { passive: true });
      track.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowRight') { e.stopPropagation(); go(Math.min(list.length - 1, current + 1)); }
        if (e.key === 'ArrowLeft') { e.stopPropagation(); go(Math.max(0, current - 1)); }
      });
    }
    return wrap;
  }

  function detailRow(iconName, label, value) {
    const row = el('div', 'flex items-center gap-3 py-2.5');
    row.innerHTML = '<span class="text-zinc-500 shrink-0">' + icon(iconName, 'w-5 h-5') + '</span>';
    const body = el('div', 'flex-1 min-w-0');
    body.append(el('p', 'text-xs text-zinc-500', label));
    body.append(el('p', value ? 'text-sm text-zinc-100' : 'text-sm text-zinc-500', value || 'Not added'));
    row.append(body);
    return row;
  }

  function socialRow(iconName, label, handle, href) {
    const a = document.createElement('a');
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.className = 'flex items-center gap-3 py-2.5 rounded-lg hover:text-sky-300 transition-colors ' +
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400';
    a.innerHTML = '<span class="text-zinc-500 shrink-0">' + icon(iconName, 'w-5 h-5') + '</span>';
    const body = el('div', 'flex-1 min-w-0');
    body.append(el('p', 'text-xs text-zinc-500', label));
    body.append(el('p', 'text-sm text-zinc-100 truncate', '@' + handle));
    a.append(body);
    return a;
  }

  // opts: { viewerInterests, onBack, onAction(action) | null, backLabel,
  //         verified (overrides profile.verified), testid }
  function build(profile, opts) {
    opts = opts || {};
    const root = el('section', 'h-full flex flex-col');
    root.dataset.testid = opts.testid || 'full-profile';

    const bar = el('div', 'shrink-0 flex items-center gap-2 px-2 py-2 border-b border-zinc-800/80');
    const back = document.createElement('button');
    back.type = 'button';
    back.dataset.back = '';
    back.className = 'flex items-center gap-1 rounded-full pl-1 pr-3 py-1.5 text-sm font-medium text-sky-300 ' +
      'hover:text-sky-200 active:scale-95 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400';
    back.innerHTML = icon('chevron-left', 'w-5 h-5');
    back.append(document.createTextNode(opts.backLabel || 'Back'));
    back.addEventListener('click', opts.onBack);
    bar.append(back);
    root.append(bar);

    const scroller = el('div', 'flex-1 min-h-0 overflow-y-auto overscroll-contain');
    root.append(scroller);
    scroller.append(gallery(profile.photos, profile.name));

    const body = el('div', 'px-4 pt-4 pb-6 flex flex-col gap-6');
    scroller.append(body);

    // Identity: name, age, badge, presence, distance, shared interests.
    const head = el('div', 'flex flex-col gap-1.5');
    const nameRow = el('div', 'flex items-center gap-2');
    nameRow.append(el('h2', 'text-2xl font-bold text-zinc-100',
      profile.name + (profile.age == null ? '' : ', ' + profile.age)));
    const verified = opts.verified != null ? opts.verified : profile.verified;
    if (verified) nameRow.insertAdjacentHTML('beforeend', UI.VerifiedBadge('w-5 h-5'));
    head.append(nameRow);
    const presence = UI.presenceEl(profile);
    if (presence) head.append(presence);
    if (profile.distance !== undefined) {
      const dist = el('p', 'flex items-center gap-1.5 text-sm text-zinc-400');
      dist.innerHTML = icon('map-pin', 'w-4 h-4 text-zinc-500');
      dist.append(el('span', null, profile.distance == null ? 'Distance unknown' : profile.distance + ' km away'));
      head.append(dist);
    }
    const shared = UI.sharedInterestsEl(profile, opts.viewerInterests);
    if (shared) head.append(shared);
    body.append(head);

    // About.
    const about = el('div', 'flex flex-col gap-2');
    about.append(sectionTitle('About'));
    about.append(profile.bio
      ? el('p', 'text-base leading-relaxed text-zinc-200 whitespace-pre-line', profile.bio)
      : muted('No bio yet.'));
    body.append(about);

    // Prompts.
    const prompts = el('div', 'flex flex-col gap-3');
    prompts.dataset.testid = 'profile-prompts';
    prompts.append(sectionTitle('Prompts'));
    if (profile.prompts && profile.prompts.length) {
      profile.prompts.forEach(function (p) {
        const block = el('div', 'rounded-2xl border border-zinc-800 bg-zinc-900/60 px-4 py-3.5 flex flex-col gap-1');
        block.append(el('p', 'text-xs font-medium text-zinc-400', p.prompt));
        block.append(el('p', 'text-lg font-semibold leading-snug text-zinc-100', p.answer));
        prompts.append(block);
      });
    } else {
      prompts.append(muted('No prompts answered yet.'));
    }
    body.append(prompts);

    // Details.
    const details = el('div', 'flex flex-col');
    details.append(sectionTitle('Details'));
    const list = el('div', 'divide-y divide-zinc-800');
    list.append(
      detailRow('search', 'Looking for', Schema.lookingForLabel(profile.lookingFor)),
      detailRow('briefcase', 'Job', profile.job),
      detailRow('graduation-cap', 'Education', profile.education)
    );
    details.append(list);
    body.append(details);

    // Interests, the shared ones highlighted.
    const interests = el('div', 'flex flex-col gap-2');
    interests.append(sectionTitle('Interests'));
    if (profile.interests && profile.interests.length) {
      const common = Array.isArray(opts.viewerInterests)
        ? Schema.sharedInterests(profile.interests, opts.viewerInterests) : [];
      const tags = el('div', 'flex flex-wrap gap-2');
      profile.interests.forEach(function (i) {
        tags.append(el('span', common.indexOf(i) !== -1
          ? 'rounded-full border border-sky-400/60 bg-sky-500/15 px-3 py-1 text-sm font-medium text-sky-200'
          : 'rounded-full border border-zinc-700 bg-zinc-900 px-3 py-1 text-sm font-medium text-zinc-200', i));
      });
      interests.append(tags);
    } else {
      interests.append(muted('No interests added yet.'));
    }
    body.append(interests);

    // Instagram and Spotify, only when filled in.
    if (profile.instagram || profile.spotify) {
      const social = el('div', 'flex flex-col');
      social.append(sectionTitle('Elsewhere'));
      const rows = el('div', 'divide-y divide-zinc-800');
      if (profile.instagram) {
        rows.append(socialRow('instagram', 'Instagram', profile.instagram,
          'https://www.instagram.com/' + encodeURIComponent(profile.instagram) + '/'));
      }
      if (profile.spotify) {
        rows.append(socialRow('music', 'Spotify', profile.spotify,
          'https://open.spotify.com/user/' + encodeURIComponent(profile.spotify)));
      }
      social.append(rows);
      body.append(social);
    }

    if (opts.onAction) {
      const actions = el('div', 'shrink-0 flex items-center gap-3 px-4 pt-3 pb-3 border-t border-zinc-800/80 bg-zinc-950');
      const skip = UI.Button('Skip', { variant: 'outline', onClick: function () { opts.onAction('skip'); } });
      skip.dataset.action = 'skip';
      skip.className += ' flex-1';
      const hi = UI.Button('Say hi', { onClick: function () { opts.onAction('hi'); } });
      hi.dataset.action = 'hi';
      hi.className += ' flex-1';
      actions.append(skip, hi);
      root.append(actions);
    }
    return root;
  }

  window.OmichatProfileView = { build: build, gallery: gallery };
})();
