// Omichat Safety and Trust UI: the card and conversation menus (Report
// message / Report / Block), the report sheet, the block confirmation, the "What does Verified mean?" modal, the
// selfie verification flow, the Privacy sheet and the 18+ age gate.
//
// All data goes through OmichatSafety.services() (see safety.js), so none
// of this code knows whether it is talking to the mock or a real backend.
// app.js calls init() once with the few shell helpers this file reuses.
(function () {
  'use strict';

  const Safety = window.OmichatSafety;
  const icon = window.OmichatIcons.icon;
  const UI = window.OmichatComponents;

  let host = { presentSheet: null, toast: null, onChange: null };
  let openLayers = 0; // sheets, modals and overlays up: the deck ignores keys

  function init(opts) { host = Object.assign(host, opts); }
  function busy() { return openLayers > 0; }

  // ----------------------------------------------------------------- helpers

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400';

  function smallButton(b) {
    b.className = b.className.replace('px-5 py-2.5', 'px-4 py-2.5');
    b.className += ' w-full';
    return b;
  }

  // A destructive-looking outline button. The app has no filled red: errors
  // use rose text, so destructive actions do too.
  function dangerButton(label, onClick) {
    const b = UI.Button(label, { variant: 'outline', onClick: onClick });
    b.className += ' w-full !border-rose-500/60 !text-rose-300 hover:!border-rose-400 hover:!text-rose-200';
    return b;
  }

  function errorLine() {
    const p = el('p', 'text-sm text-rose-300');
    p.setAttribute('role', 'alert');
    p.hidden = true;
    return {
      el: p,
      show: function (msg) { p.textContent = msg; p.hidden = false; },
      clear: function () { p.hidden = true; },
    };
  }

  // Bottom sheet through the app's presentSheet, counted so the deck's
  // keyboard shortcuts stay quiet while it is open.
  function sheet(content, onDismiss) {
    openLayers++;
    let closed = false;
    return host.presentSheet(content, function () {
      if (!closed) { closed = true; openLayers--; }
      if (onDismiss) onDismiss();
    });
  }

  // Centered modal: a dimmed backdrop and a card. Escape and a backdrop tap
  // dismiss it. Plain DOM so it works with or without the native kit.
  function modal(content, opts) {
    opts = opts || {};
    openLayers++;
    const backdrop = el('div', 'fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-6');
    const card = el('div', 'w-full max-w-sm rounded-3xl bg-zinc-900 border border-zinc-800 shadow-2xl');
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    if (opts.label) card.setAttribute('aria-label', opts.label);
    card.append(content);
    backdrop.append(card);
    function onKey(e) { if (e.key === 'Escape') api.dismiss(); }
    const api = {
      el: backdrop,
      dismiss: function () {
        if (!backdrop.isConnected) return;
        backdrop.remove();
        document.removeEventListener('keydown', onKey);
        openLayers--;
      },
    };
    backdrop.addEventListener('click', function (e) { if (e.target === backdrop) api.dismiss(); });
    document.addEventListener('keydown', onKey);
    document.body.append(backdrop);
    const first = card.querySelector('button, input');
    if (first) first.focus();
    return api;
  }

  // ------------------------------------------------------------- card menu

  function menuRow(iconName, label, onClick, danger) {
    const b = el('button',
      'w-full flex items-center gap-3 px-4 py-3.5 text-left text-sm font-medium transition-colors ' +
      'hover:bg-zinc-800/60 ' + FOCUS + ' focus-visible:ring-inset ' +
      (danger ? 'text-rose-300' : 'text-zinc-200'));
    b.type = 'button';
    b.dataset.menuItem = label.toLowerCase();
    b.innerHTML = '<span class="' + (danger ? 'text-rose-300' : 'text-zinc-500') + '">' +
      icon(iconName, 'w-5 h-5') + '</span><span class="flex-1"></span>';
    b.querySelector('.flex-1').textContent = label;
    b.addEventListener('click', onClick);
    return b;
  }

  // opts.thread: opened from a conversation in Messages; its last message
  // can be reported on its own when someone else sent it.
  function openMenu(profile, opts) {
    opts = opts || {};
    const content = el('div', 'px-5 pt-2 pb-7 flex flex-col gap-3');
    content.dataset.testid = opts.thread ? 'thread-menu' : 'card-menu';
    content.append(el('h2', 'text-lg font-bold text-zinc-100', profile.name));
    const list = el('div', 'rounded-2xl border border-zinc-800 divide-y divide-zinc-800 bg-zinc-900/60 overflow-hidden');
    let s;
    const last = opts.thread && opts.thread.last;
    if (Safety.canReportMessage(last)) {
      list.append(menuRow('message-circle', 'Report message', function () {
        s.dismiss(); openReport(profile, { message: last });
      }));
    }
    list.append(
      menuRow('flag', 'Report', function () { s.dismiss(); openReport(profile); }),
      menuRow('ban', 'Block', function () { s.dismiss(); openBlock(profile); }, true)
    );
    content.append(list);
    s = sheet(content);
  }

  // ---------------------------------------------------------------- report

  // opts.message: report that one message (shown quoted) instead of the
  // whole profile, with the reasons made for messages.
  function openReport(profile, opts) {
    const message = opts && opts.message;
    const content = el('form', 'px-5 pt-2 pb-7 flex flex-col gap-4');
    content.dataset.testid = 'report-sheet';
    content.noValidate = true;
    content.append(el('h2', 'text-lg font-bold text-zinc-100',
      message ? 'Report message from ' + profile.name : 'Report ' + profile.name));
    content.append(el('p', 'text-sm text-zinc-400', 'Tell us what is wrong. We keep your report private.'));
    if (message) {
      const quote = el('blockquote', 'border-l-[3px] rounded-lg bg-zinc-800 px-3 py-2 text-sm text-zinc-300', message.text);
      quote.dataset.testid = 'reported-message';
      quote.style.borderLeftColor = profile.accent || '#38bdf8';
      content.append(quote);
    }

    let chosen = null;
    const group = el('div', 'rounded-2xl border border-zinc-800 divide-y divide-zinc-800 bg-zinc-900/60 overflow-hidden');
    group.setAttribute('role', 'radiogroup');
    group.setAttribute('aria-label', 'Reason');
    Safety.reasonsFor(message ? 'message' : 'profile').forEach(function (r) {
      const row = el('label',
        'flex items-center gap-3 px-4 py-3 text-sm text-zinc-200 cursor-pointer hover:bg-zinc-800/60');
      const input = el('input', 'w-4 h-4 accent-sky-500 ' + FOCUS);
      input.type = 'radio';
      input.name = 'report-reason';
      input.value = r.id;
      input.addEventListener('change', function () { chosen = r.id; err.clear(); });
      row.append(input, el('span', 'flex-1', r.label));
      group.append(row);
    });
    content.append(group);

    const noteWrap = el('label', 'flex flex-col gap-1.5 text-xs text-zinc-400');
    noteWrap.append(el('span', null, 'Details (optional)'));
    const note = el('textarea',
      'rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm text-zinc-100 placeholder-zinc-500 ' +
      'resize-none ' + FOCUS);
    note.rows = 3;
    note.maxLength = Safety.REPORT_NOTE_MAX;
    note.placeholder = 'Anything else we should know?';
    noteWrap.append(note);
    content.append(noteWrap);

    const err = errorLine();
    content.append(err.el);
    const send = UI.Button('Send report', {});
    send.type = 'submit';
    send.className += ' w-full disabled:opacity-60';
    content.append(send);

    let s;
    content.addEventListener('submit', async function (e) {
      e.preventDefault();
      if (send.disabled) return;
      if (!chosen) { err.show('Choose a reason to continue.'); return; }
      err.clear();
      send.disabled = true;
      send.textContent = 'Sending…';
      try {
        await Safety.services().reports.submit({
          targetType: message ? 'message' : 'profile',
          profileId: profile.id,
          targetName: profile.name,
          messageId: message ? message.id : undefined,
          messageText: message ? message.text : undefined,
          reason: chosen,
          note: note.value,
        });
        s.dismiss();
        host.toast('Report sent. Thank you.');
      } catch (ex) {
        err.show(ex.message || 'Could not send the report. Try again.');
        send.disabled = false;
        send.textContent = 'Send report';
      }
    });
    s = sheet(content);
  }

  // ----------------------------------------------------------------- block

  function openBlock(profile) {
    const content = el('div', 'px-5 pt-2 pb-7 flex flex-col gap-4');
    content.dataset.testid = 'block-confirm';
    content.append(
      el('h2', 'text-lg font-bold text-zinc-100', 'Block ' + profile.name + '?'),
      el('p', 'text-sm text-zinc-400',
        profile.name + ' will be removed from Discover, Hellos and Messages. ' +
        'You will not see each other again, and this cannot be undone.')
    );
    const err = errorLine();
    content.append(err.el);
    let s;
    const confirm = dangerButton('Block ' + profile.name, async function () {
      if (confirm.disabled) return;
      err.clear();
      confirm.disabled = true;
      cancel.disabled = true;
      confirm.textContent = 'Blocking…';
      try {
        await Safety.services().blocks.block(profile.id, profile.name);
        s.dismiss();
        host.toast(profile.name + ' is blocked');
        if (host.onChange) host.onChange();
      } catch (ex) {
        err.show(ex.message || 'Could not block this person. Try again.');
        confirm.disabled = false;
        cancel.disabled = false;
        confirm.textContent = 'Block ' + profile.name;
      }
    });
    confirm.dataset.testid = 'block-confirm-button';
    const cancel = smallButton(UI.Button('Cancel', {
      variant: 'outline', onClick: function () { s.dismiss(); },
    }));
    content.append(confirm, cancel);
    s = sheet(content);
  }

  // --------------------------------------------------- verified explainer

  function openVerifiedInfo() {
    const content = el('div', 'p-6 flex flex-col gap-4');
    content.dataset.testid = 'verified-info';
    const head = el('div', 'flex items-center gap-3');
    head.innerHTML = '<span class="text-fuchsia-300">' + icon('shield-check', 'w-7 h-7') + '</span>';
    head.append(el('h2', 'text-lg font-bold text-zinc-100', 'What does Verified mean?'));
    content.append(head,
      el('p', 'text-sm text-zinc-300',
        'A shield means the person passed a selfie check: a reviewer confirmed that a live photo ' +
        'of them matches their profile.'),
      el('p', 'text-sm text-zinc-400',
        'To get verified, take a quick selfie from your Profile tab. It only takes a minute.'));
    let m;
    const go = UI.Button('Get verified', {
      onClick: function () { m.dismiss(); openSelfieFlow(); },
    });
    go.className += ' w-full';
    const close = smallButton(UI.Button('Close', { variant: 'outline', onClick: function () { m.dismiss(); } }));
    content.append(go, close);
    m = modal(content, { label: 'What does Verified mean?' });
  }

  // -------------------------------------------------------- selfie flow

  // Mean brightness (0-255) of a video frame, sampled on a small canvas.
  function frameBrightness(video) {
    const c = document.createElement('canvas');
    c.width = 32; c.height = 32;
    const ctx = c.getContext('2d');
    ctx.drawImage(video, 0, 0, 32, 32);
    const px = ctx.getImageData(0, 0, 32, 32).data;
    let sum = 0;
    for (let i = 0; i < px.length; i += 4) sum += (px[i] + px[i + 1] + px[i + 2]) / 3;
    return sum / (px.length / 4);
  }

  // Asks the platform shell for camera access (the frame cannot grant itself
  // the capability), then opens the stream. Throws a plain-language Error.
  async function openCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('This device or browser does not support the camera.');
    }
    const bridge = typeof usernode !== 'undefined' ? usernode : null;
    if (bridge && typeof bridge.requestPermission === 'function') {
      let r = null;
      try { r = await bridge.requestPermission('camera'); } catch (e) { r = null; }
      if (r && r.state === 'denied') {
        throw new Error('Camera access was declined. Allow it to take your selfie.');
      }
      if (r && r.state === 'granted' && r.active === false) {
        throw new Error('Camera access is on. Omichat is reopening, then try again.');
      }
    }
    try {
      return await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
    } catch (e) {
      throw new Error(e && e.name === 'NotFoundError'
        ? 'No camera was found on this device.'
        : 'We could not open the camera. Check that it is allowed and not in use.');
    }
  }

  function openSelfieFlow() {
    openLayers++;
    const overlay = el('div', 'fixed inset-0 z-50 bg-zinc-950');
    overlay.dataset.testid = 'selfie-flow';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Selfie verification');
    overlay.style.paddingTop = 'var(--un-safe-inset-top, env(safe-area-inset-top, 0px))';
    overlay.style.paddingBottom = 'var(--un-safe-inset-bottom, env(safe-area-inset-bottom, 0px))';
    const col = el('div', 'h-full max-w-md mx-auto flex flex-col');
    const bar = el('div', 'shrink-0 flex items-center justify-between px-4 pt-3 pb-2 border-b border-zinc-800/80');
    bar.append(el('h1', 'text-lg font-bold text-zinc-100', 'Get verified'));
    const closeBtn = el('button',
      'p-2 rounded-full text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/70 active:scale-90 transition-all ' + FOCUS);
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.innerHTML = icon('x', 'w-5 h-5');
    bar.append(closeBtn);
    const body = el('div', 'flex-1 min-h-0 overflow-y-auto flex flex-col');
    col.append(bar, body);
    overlay.append(col);
    document.body.append(overlay);

    let stream = null;
    let poll = null;
    let closed = false;

    function stopCamera() {
      if (stream) { stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; }
    }
    function stopPoll() { if (poll) { clearInterval(poll); poll = null; } }
    function close() {
      if (closed) return;
      closed = true;
      stopCamera();
      stopPoll();
      overlay.remove();
      openLayers--;
      document.removeEventListener('keydown', onKey);
      if (host.onChange) host.onChange();
    }
    function onKey(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', onKey);
    closeBtn.addEventListener('click', close);

    // One stage = a centered message block with at most one primary action.
    function stage(name, o) {
      stopPoll();
      body.innerHTML = '';
      body.dataset.stage = name;
      const wrap = el('div', 'flex-1 flex flex-col items-center justify-center text-center gap-3 px-6 py-10');
      const badge = el('div',
        'w-16 h-16 rounded-full flex items-center justify-center ' +
        (o.tone === 'bad' ? 'bg-rose-500/15 text-rose-300'
          : o.tone === 'good' ? 'bg-fuchsia-500/15 text-fuchsia-300'
          : 'bg-gradient-to-br from-sky-500/25 to-indigo-500/25 text-sky-300'));
      if (o.spinner) {
        badge.innerHTML = '<span class="w-7 h-7 rounded-full border-2 border-sky-300/30 border-t-sky-300 animate-spin motion-reduce:animate-none"></span>';
      } else {
        badge.innerHTML = icon(o.icon, 'w-8 h-8');
      }
      wrap.append(badge, el('h2', 'text-lg font-bold text-zinc-100', o.title));
      if (o.body) wrap.append(Object.assign(el('p', 'text-sm text-zinc-400 max-w-xs', o.body), { }));
      if (o.list) {
        const ul = el('ul', 'text-sm text-zinc-300 text-left max-w-xs flex flex-col gap-1.5 list-disc pl-5');
        o.list.forEach(function (t) { ul.append(el('li', null, t)); });
        wrap.append(ul);
      }
      (o.actions || []).forEach(function (a) { wrap.append(a); });
      body.append(wrap);
      return wrap;
    }

    function action(label, fn, variant) {
      const b = UI.Button(label, { variant: variant || 'primary', onClick: fn });
      b.className += ' w-full max-w-xs mt-1';
      return b;
    }

    function showIntro() {
      stage('intro', {
        icon: 'camera',
        title: 'Take a quick selfie',
        body: 'A reviewer checks that a live photo of you matches your profile.',
        list: [
          'Find good light and face the camera.',
          'Take off sunglasses and hats.',
          'Only you should be in the frame.',
        ],
        actions: [action('Open camera', showCamera), action('Not now', close, 'outline')],
      });
    }

    async function showCamera() {
      stage('opening', { spinner: true, title: 'Opening the camera…' });
      try {
        stream = await openCamera();
      } catch (e) {
        if (closed) return;
        stage('error', {
          icon: 'camera', tone: 'bad', title: 'Camera not available', body: e.message,
          actions: [action('Try again', showCamera), action('Close', close, 'outline')],
        });
        return;
      }
      if (closed) { stopCamera(); return; }
      body.innerHTML = '';
      body.dataset.stage = 'camera';
      const wrap = el('div', 'flex-1 flex flex-col items-center justify-center gap-4 px-4 py-6');
      const frame = el('div', 'relative w-full aspect-square max-h-96 rounded-3xl overflow-hidden bg-zinc-900 border border-zinc-800');
      const video = el('video', 'absolute inset-0 w-full h-full object-cover -scale-x-100');
      video.autoplay = true; video.muted = true; video.playsInline = true;
      video.setAttribute('aria-label', 'Camera preview');
      video.srcObject = stream;
      frame.append(video);
      wrap.append(frame, el('p', 'text-sm text-zinc-400', 'Center your face in the frame.'));
      const snap = action('Take selfie', function () {
        if (!video.videoWidth) return;
        const brightness = frameBrightness(video);
        stopCamera();
        submit(brightness);
      });
      wrap.append(snap);
      body.append(wrap);
      video.play().catch(function () { /* autoplay refused: the preview stays still */ });
    }

    async function submit(brightness) {
      stage('submitting', { spinner: true, title: 'Sending your selfie…' });
      try {
        await Safety.services().verification.submitSelfie({ brightness: brightness });
      } catch (e) {
        if (closed) return;
        stage('error', {
          icon: 'camera', tone: 'bad', title: 'Could not send your selfie',
          body: e.message || 'Something went wrong. Please try again.',
          actions: [action('Try again', showCamera), action('Close', close, 'outline')],
        });
        return;
      }
      if (!closed) showPending();
    }

    function showPending() {
      stage('pending', {
        icon: 'shield-check',
        title: 'Pending review',
        body: 'Your selfie is with a reviewer. You can close this and come back: we keep your place.',
        actions: [action('Done', close, 'outline')],
      });
      if (host.onChange) host.onChange();
      poll = setInterval(async function () {
        try {
          const s = await Safety.services().verification.getStatus();
          if (closed || s.status === 'pending') return;
          showResult(s);
        } catch (e) { /* keep polling; the next tick may succeed */ }
      }, 1000);
    }

    function showResult(s) {
      if (host.onChange) host.onChange();
      if (s.status === 'verified') {
        stage('verified', {
          icon: 'shield-check', tone: 'good', title: 'You are verified',
          body: 'Your profile now shows the verified shield.',
          actions: [action('Done', close)],
        });
      } else {
        stage('rejected', {
          icon: 'x', tone: 'bad', title: 'We could not verify you',
          body: s.reason || 'The selfie did not match. You can try again.',
          actions: [action('Try again', async function () {
            await Safety.services().verification.reset();
            showIntro();
          }), action('Close', close, 'outline')],
        });
      }
    }

    // Start from wherever the person left off.
    stage('loading', { spinner: true, title: 'Loading…' });
    Safety.services().verification.getStatus().then(function (s) {
      if (closed) return;
      if (s.status === 'pending') showPending();
      else if (s.status === 'verified' || s.status === 'rejected') showResult(s);
      else showIntro();
    }).catch(function () {
      if (closed) return;
      stage('error', {
        icon: 'x', tone: 'bad', title: 'Could not load verification',
        body: 'Check your connection and try again.',
        actions: [action('Try again', openAgain), action('Close', close, 'outline')],
      });
    });
    function openAgain() { close(); openSelfieFlow(); }
    closeBtn.focus();
  }

  // --------------------------------------------------------------- privacy

  function toggleRow(label, hintText, key, settings, onSaved) {
    const row = el('div', 'flex items-center gap-3 px-4 py-3.5');
    const text = el('div', 'flex-1 min-w-0');
    text.append(el('p', 'text-sm font-medium text-zinc-200', label), el('p', 'text-xs text-zinc-400 mt-0.5', hintText));
    const sw = el('button',
      'relative shrink-0 w-11 h-6 rounded-full transition-colors ' + FOCUS);
    sw.type = 'button';
    sw.setAttribute('role', 'switch');
    sw.setAttribute('aria-label', label);
    sw.dataset.setting = key;
    const knob = el('span', 'absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform motion-reduce:transition-none');
    sw.append(knob);
    function paint(on) {
      sw.setAttribute('aria-checked', on ? 'true' : 'false');
      sw.className = sw.className.replace(/\bbg-\S+/g, '').trim() + (on ? ' bg-sky-500' : ' bg-zinc-700');
      knob.style.transform = on ? 'translateX(20px)' : 'translateX(0)';
    }
    paint(settings[key]);
    sw.addEventListener('click', async function () {
      if (sw.disabled) return;
      const next = sw.getAttribute('aria-checked') !== 'true';
      paint(next); // optimistic; rolled back below if the save fails
      sw.disabled = true;
      try {
        const saved = await Safety.services().privacy.update({ [key]: next });
        onSaved(saved);
      } catch (e) {
        paint(!next);
        host.toast('Could not save that setting. Try again.');
      }
      sw.disabled = false;
    });
    row.append(text, sw);
    return row;
  }

  // A "Who can…" row: the current choice in the accent, opening a picker.
  function choiceRow(label, hintText, key, settings, onOpen) {
    const b = el('button',
      'w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-zinc-800/60 transition-colors ' +
      FOCUS + ' focus-visible:ring-inset');
    b.type = 'button';
    b.dataset.setting = key;
    const text = el('div', 'flex-1 min-w-0');
    text.append(el('p', 'text-sm font-medium text-zinc-200', label), el('p', 'text-xs text-zinc-400 mt-0.5', hintText));
    const value = el('span', 'shrink-0 text-xs text-sky-300', audienceLabel(settings[key]));
    const chev = el('span', 'shrink-0 text-zinc-600');
    chev.innerHTML = icon('chevron-right', 'w-4 h-4');
    b.append(text, value, chev);
    b.setAttribute('aria-label', label + ': ' + audienceLabel(settings[key]));
    b.addEventListener('click', onOpen);
    return b;
  }

  function audienceLabel(id) {
    const a = Safety.AUDIENCES.find(function (x) { return x.id === id; });
    return a ? a.label : '';
  }

  // Three radio rows, saved on tap. The choice shows at once and rolls back
  // if the save fails. Closing it returns to the Privacy sheet.
  function openAudiencePicker(key, title, onClosed) {
    const content = el('div', 'px-5 pt-2 pb-7 flex flex-col gap-4');
    content.dataset.testid = 'audience-picker';
    content.append(el('h2', 'text-lg font-bold text-zinc-100', title));
    const group = el('div', 'rounded-2xl border border-zinc-800 divide-y divide-zinc-800 bg-zinc-900/60 overflow-hidden');
    group.setAttribute('role', 'radiogroup');
    group.setAttribute('aria-label', title);
    let current = Safety.services().privacy.get()[key];
    let saving = false;
    const inputs = [];
    let s;
    Safety.AUDIENCES.forEach(function (a) {
      const row = el('label',
        'flex items-center gap-3 px-4 py-3 text-sm text-zinc-200 cursor-pointer hover:bg-zinc-800/60');
      const input = el('input', 'w-4 h-4 accent-sky-500 ' + FOCUS);
      input.type = 'radio';
      input.name = 'audience-' + key;
      input.value = a.id;
      input.checked = a.id === current;
      inputs.push(input);
      input.addEventListener('change', async function () {
        if (saving || a.id === current) return;
        saving = true;
        const before = current;
        try {
          await Safety.services().privacy.update({ [key]: a.id });
          current = a.id;
          if (host.onChange) host.onChange();
          s.dismiss();
        } catch (e) {
          inputs.forEach(function (i) { i.checked = i.value === before; });
          host.toast('Could not save that setting. Try again.');
        }
        saving = false;
      });
      row.append(input, el('span', 'flex-1', a.label));
      group.append(row);
    });
    content.append(group);
    s = sheet(content, onClosed);
  }

  function blockedList() {
    const entries = Safety.services().blocks.entries ? Safety.services().blocks.entries() : [];
    if (!entries.length) return null;
    const wrap = el('div', 'flex flex-col gap-2');
    wrap.dataset.testid = 'blocked-people';
    wrap.append(el('p', 'text-xs font-medium uppercase tracking-wide text-zinc-400', 'Blocked people'));
    const group = el('div', 'rounded-2xl border border-zinc-800 divide-y divide-zinc-800 bg-zinc-900/60 overflow-hidden');
    const Data = window.OmichatData;
    entries.forEach(function (b) {
      const id = Safety.mockIdFromKey(b.key);
      const p = id != null && Data ? Data.byId.get(id) : null;
      const name = b.name || (p ? p.name : 'Someone');
      const when = b.at
        ? 'Blocked ' + new Date(b.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + '. '
        : '';
      const row = el('div', 'px-4 py-3');
      row.append(el('p', 'text-sm font-medium text-zinc-200', name),
        el('p', 'text-xs text-zinc-400 mt-0.5', when + "Blocks can't be undone."));
      group.append(row);
    });
    wrap.append(group);
    return wrap;
  }

  function openPrivacy() {
    const content = el('div', 'px-5 pt-2 pb-7 flex flex-col gap-4');
    content.dataset.testid = 'privacy-sheet';
    content.append(el('h2', 'text-lg font-bold text-zinc-100', 'Privacy'));
    const settings = Safety.services().privacy.get();
    function saved() { if (host.onChange) host.onChange(); }
    let s;
    function pick(key, title) {
      return function () {
        s.dismiss();
        openAudiencePicker(key, title, openPrivacy);
      };
    }
    const choices = el('div', 'rounded-2xl border border-zinc-800 divide-y divide-zinc-800 bg-zinc-900/60 overflow-hidden');
    choices.append(
      choiceRow('Who can message you', 'Blocked people can never message you.', 'whoCanMessage', settings,
        pick('whoCanMessage', 'Who can message you')),
      choiceRow('Who can see your profile', 'Controls who finds you in Discover.', 'whoCanSeeProfile', settings,
        pick('whoCanSeeProfile', 'Who can see your profile'))
    );
    content.append(choices);
    const group = el('div', 'rounded-2xl border border-zinc-800 divide-y divide-zinc-800 bg-zinc-900/60 overflow-hidden');
    group.append(
      toggleRow('Hide my distance', 'Distance is hidden on profiles you see.', 'hideDistance', settings, saved),
      toggleRow('Show my online status',
        "When off, nobody sees when you were last active, and you don't see theirs.",
        'showOnlineStatus', settings, saved)
    );
    content.append(group);
    const blocked = blockedList();
    if (blocked) content.append(blocked);
    content.append(UI.Button('Done', { onClick: function () { s.dismiss(); } }));
    s = sheet(content);
  }

  // -------------------------------------------------------------- age gate

  // Blocks the whole app until a date of birth shows the person is 18+.
  // The app behind it is made inert so focus and taps cannot reach it.
  function mountAgeGate() {
    const status = Safety.services().age.get().status;
    if (status === 'passed') return;
    const appEl = document.getElementById('app');
    openLayers++;
    if (appEl) appEl.inert = true;
    const overlay = el('div', 'fixed inset-0 z-50 bg-zinc-950 overflow-y-auto');
    overlay.dataset.testid = 'age-gate';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Confirm your age');
    const col = el('div', 'min-h-full max-w-md mx-auto flex flex-col items-center justify-center gap-4 px-6 py-10 text-center');
    overlay.append(col);
    document.body.append(overlay);

    function release() {
      overlay.remove();
      openLayers--;
      if (appEl) appEl.inert = false;
    }

    function showBlocked() {
      col.innerHTML = '';
      col.dataset.stage = 'blocked';
      const badge = el('div', 'w-16 h-16 rounded-full bg-rose-500/15 text-rose-300 flex items-center justify-center');
      badge.innerHTML = icon('ban', 'w-8 h-8');
      col.append(badge,
        el('h1', 'text-xl font-bold text-zinc-100', 'Omichat is for people 18 and over'),
        el('p', 'text-sm text-zinc-400 max-w-xs',
          'You cannot create an account right now. Come back when you are 18.'));
    }

    function showForm() {
      col.innerHTML = '';
      col.dataset.stage = 'form';
      const badge = el('div', 'w-16 h-16 rounded-full bg-gradient-to-br from-sky-500/25 to-indigo-500/25 text-sky-300 flex items-center justify-center');
      badge.innerHTML = icon('shield-check', 'w-8 h-8');
      const form = el('form', 'w-full max-w-xs flex flex-col gap-4 text-left');
      form.noValidate = true;
      const label = el('label', 'flex flex-col gap-1.5 text-xs text-zinc-400');
      label.append(el('span', null, 'Date of birth'));
      const input = el('input',
        'rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm text-zinc-100 ' + FOCUS);
      input.type = 'date';
      input.name = 'dob';
      input.required = true;
      input.max = new Date().toISOString().slice(0, 10);
      label.append(input);
      const err = errorLine();
      const go = UI.Button('Continue', {});
      go.type = 'submit';
      go.className += ' w-full disabled:opacity-60';
      form.append(label, err.el, go);
      form.addEventListener('submit', async function (e) {
        e.preventDefault();
        if (go.disabled) return;
        err.clear();
        go.disabled = true;
        go.textContent = 'Checking…';
        try {
          const r = await Safety.services().age.submit(input.value);
          if (r.ok) { release(); return; }
          if (r.reason === 'underage') { showBlocked(); return; }
          err.show('Enter your full date of birth.');
        } catch (ex) {
          err.show('Could not check your age. Try again.');
        }
        go.disabled = false;
        go.textContent = 'Continue';
      });
      col.append(badge,
        el('h1', 'text-xl font-bold text-zinc-100', 'Confirm your age'),
        el('p', 'text-sm text-zinc-400 max-w-xs', 'You must be 18 or older to use Omichat. Your date of birth is not stored.'),
        form);
      input.focus();
    }

    if (status === 'blocked') showBlocked(); else showForm();
  }

  window.OmichatSafetyUI = {
    init: init,
    busy: busy,
    openMenu: openMenu,
    openReport: openReport,
    openBlock: openBlock,
    openVerifiedInfo: openVerifiedInfo,
    openSelfieFlow: openSelfieFlow,
    openPrivacy: openPrivacy,
    mountAgeGate: mountAgeGate,
  };
})();
