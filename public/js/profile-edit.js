// Omichat Edit Profile screen. Works on a draft copy of the viewer's profile;
// "Save changes" validates it with the shared schema (the server validates
// again) and persists it through PUT /api/profile.
//
// Photos are uploaded as soon as they are picked: downscaled in a canvas,
// then stored platform-side with usernode.uploadFile. The profile keeps only
// each file's id and URL. Files picked but never saved are deleted on
// Cancel; saved photos removed in the draft are deleted after the save.
(function () {
  const icon = window.OmichatIcons.icon;
  const UI = window.OmichatComponents;
  const Schema = window.OmichatSchema;
  const L = Schema.LIMITS;

  const MAX_PICK_BYTES = 25 * 1024 * 1024; // before compression
  const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // platform storage limit

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  const INPUT_CLS =
    'w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm text-zinc-100 ' +
    'placeholder-zinc-500 focus:border-sky-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400';

  function chipCls(on, disabled) {
    return 'rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ' +
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ' +
      (on
        ? 'border-sky-400/70 bg-sky-500/20 text-sky-100'
        : disabled
          ? 'border-zinc-800 bg-zinc-900 text-zinc-600'
          : 'border-zinc-700 bg-zinc-900 text-zinc-200 hover:border-zinc-500');
  }

  function clone(p) {
    return JSON.parse(JSON.stringify(p));
  }

  function bridge() {
    return typeof usernode !== 'undefined' ? usernode : null;
  }

  // deps: { me: { username, profile }, save(profile) -> Promise<Response>,
  //         downscale(file) -> Promise<Blob>, toast(msg), onDone(me), onCancel(),
  //         onPreview(profile) }
  function build(deps) {
    const original = deps.me.profile
      ? Object.assign(Schema.empty(), clone(deps.me.profile))
      : Object.assign(Schema.empty(), { name: deps.me.username || '' });
    const draft = clone(original);
    let errors = {};
    let uploading = 0;
    let saving = false;
    let photoError = '';
    const sessionUploads = new Set(); // file ids uploaded on this screen

    const root = el('section', 'h-full flex flex-col');
    root.dataset.testid = 'edit-profile';

    // Top bar: Cancel on the left, the title, Preview on the right.
    const bar = el('div', 'shrink-0 flex items-center gap-2 px-2 py-2 border-b border-zinc-800/80');
    const cancel = textButton('Cancel', onCancel);
    const title = el('h1', 'flex-1 text-center text-base font-semibold text-zinc-100', 'Edit profile');
    const preview = textButton('Preview', function () { deps.onPreview(clone(draft)); });
    bar.append(cancel, title, preview);
    root.append(bar);

    const scroller = el('div', 'flex-1 min-h-0 overflow-y-auto overscroll-contain');
    const form = el('div', 'px-4 pt-4 pb-8 flex flex-col gap-7');
    scroller.append(form);
    root.append(scroller);

    const footer = el('div', 'shrink-0 px-4 pt-3 pb-3 border-t border-zinc-800/80 bg-zinc-950 flex flex-col gap-2');
    const formError = el('p', 'text-sm text-rose-300 hidden');
    formError.setAttribute('role', 'alert');
    const saveBtn = UI.Button('Save changes', { onClick: onSave });
    saveBtn.dataset.testid = 'save-profile';
    saveBtn.className += ' w-full disabled:opacity-50';
    footer.append(formError, saveBtn);
    root.append(footer);

    // ---------------------------------------------------------- completeness
    const completenessEl = el('div');
    form.append(completenessEl);
    function renderCompleteness() {
      completenessEl.innerHTML = '';
      // Photos still uploading don't count yet.
      const settled = Object.assign({}, draft, {
        photos: draft.photos.filter(function (p) { return !p.pending; }),
      });
      completenessEl.append(CompletenessMeter(Schema.completeness(settled), { compact: true }));
    }

    // --------------------------------------------------------------- photos
    const photosSection = section('Photos', 'Your first photo is your main photo. Add up to ' + L.photos + '.');
    photosSection.dataset.testid = 'edit-photos';
    const photosBody = el('div', 'flex flex-col gap-2');
    photosSection.append(photosBody);
    form.append(photosSection);

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.multiple = true;
    fileInput.className = 'hidden';
    fileInput.addEventListener('change', function () {
      const files = Array.prototype.slice.call(fileInput.files || []);
      fileInput.value = '';
      addFiles(files);
    });
    root.append(fileInput);

    function renderPhotos() {
      photosBody.innerHTML = '';
      const grid = el('div', 'grid grid-cols-3 gap-2');
      draft.photos.forEach(function (ph, i) { grid.append(photoTile(ph, i)); });
      if (draft.photos.length < L.photos) {
        const add = document.createElement('button');
        add.type = 'button';
        add.dataset.testid = 'add-photo';
        add.className =
          'h-36 rounded-2xl border-2 border-dashed border-zinc-700 text-zinc-400 flex flex-col items-center justify-center gap-1.5 ' +
          'hover:border-sky-400 hover:text-sky-300 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400';
        add.innerHTML = icon('plus', 'w-6 h-6') + '<span class="text-xs font-medium">Add photo</span>';
        add.addEventListener('click', function () {
          const b = bridge();
          if (!b || typeof b.uploadFile !== 'function') {
            photoError = 'Photo uploads are not available here. Open Omichat inside Homeroom to add photos.';
            renderPhotos();
            return;
          }
          fileInput.click();
        });
        grid.append(add);
      }
      photosBody.append(grid);
      const meta = el('div', 'flex items-center justify-between gap-2');
      const count = draft.photos.filter(function (p) { return !p.pending; }).length;
      meta.append(el('p', 'text-xs text-zinc-500', count + ' of ' + L.photos + ' photos'));
      photosBody.append(meta);
      const errText = errors.photos || photoError;
      if (errText) {
        const e = el('p', 'text-xs text-rose-300', errText);
        e.setAttribute('role', 'alert');
        photosBody.append(e);
      }
      renderCompleteness();
      saveBtn.disabled = saving || uploading > 0;
      saveBtn.textContent = saving ? 'Saving...' : uploading > 0 ? 'Uploading photos...' : 'Save changes';
    }

    function photoTile(ph, i) {
      const tile = el('div', 'relative h-36 rounded-2xl overflow-hidden bg-zinc-800');
      tile.dataset.testid = 'photo-tile';
      if (ph.pending) {
        tile.setAttribute('aria-busy', 'true');
        tile.className += ' flex flex-col items-center justify-center gap-2 text-zinc-300';
        tile.innerHTML = icon('loader', 'w-6 h-6 animate-spin motion-reduce:animate-none text-sky-300') +
          '<span class="text-xs font-medium">Uploading</span>';
        return tile;
      }
      const img = document.createElement('img');
      img.src = ph.url;
      img.alt = 'Photo ' + (i + 1);
      img.className = 'absolute inset-0 w-full h-full object-cover';
      tile.append(img);
      if (i === 0) {
        tile.append(el('span',
          'absolute top-1.5 left-1.5 rounded-full bg-zinc-950/70 px-2 py-0.5 text-xs font-semibold text-white', 'Main'));
      }
      const del = tileButton('trash', 'Delete photo ' + (i + 1), function () {
        draft.photos.splice(i, 1);
        photoError = '';
        delete errors.photos;
        renderPhotos();
      });
      del.className += ' absolute top-1.5 right-1.5';
      tile.append(del);
      const moves = el('div', 'absolute bottom-1.5 inset-x-1.5 flex justify-between');
      const left = tileButton('chevron-left', 'Move photo ' + (i + 1) + ' earlier', function () { move(i, -1); });
      const right = tileButton('chevron-right', 'Move photo ' + (i + 1) + ' later', function () { move(i, 1); });
      if (i === 0) left.classList.add('invisible');
      if (i === draft.photos.length - 1 || (draft.photos[i + 1] && draft.photos[i + 1].pending)) {
        right.classList.add('invisible');
      }
      moves.append(left, right);
      tile.append(moves);
      return tile;
    }

    function tileButton(iconName, label, onClick) {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('aria-label', label);
      b.className = 'w-8 h-8 rounded-full bg-zinc-950/70 text-white flex items-center justify-center ' +
        'hover:bg-zinc-950 active:scale-90 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400';
      b.innerHTML = icon(iconName, 'w-4 h-4');
      b.addEventListener('click', onClick);
      return b;
    }

    function move(i, dir) {
      const j = i + dir;
      if (j < 0 || j >= draft.photos.length || draft.photos[j].pending) return;
      const t = draft.photos[i]; draft.photos[i] = draft.photos[j]; draft.photos[j] = t;
      renderPhotos();
    }

    async function addFiles(files) {
      photoError = '';
      delete errors.photos;
      const room = L.photos - draft.photos.length;
      if (files.length > room) {
        photoError = 'You can add ' + room + ' more ' + (room === 1 ? 'photo' : 'photos') + '. The rest were left out.';
        files = files.slice(0, room);
      }
      const jobs = files.map(function (file) {
        if (!Schema.isPickableImage(file.type, file.name)) {
          photoError = 'Choose a PNG, JPEG, WebP or GIF image.';
          return null;
        }
        if (file.size > MAX_PICK_BYTES) {
          photoError = 'That image is too large. Choose one under 25 MB.';
          return null;
        }
        const slot = { pending: true };
        draft.photos.push(slot);
        uploading++;
        return { file: file, slot: slot };
      }).filter(Boolean);
      renderPhotos();
      await Promise.all(jobs.map(async function (job) {
        try {
          const blob = await deps.downscale(job.file);
          if (blob.size > MAX_UPLOAD_BYTES) throw new Error('That image is still over 5 MB after compressing. Try another.');
          // A re-encoded photo is always JPEG. Otherwise the original comes
          // back: name it after its real type so storage's extension check
          // passes, or send it untouched when the type cannot be told.
          const named = blob === job.file ? Schema.photoUploadName(job.file.type, job.file.name) : null;
          const upload = blob !== job.file
            ? new File([blob], 'profile-photo.jpg', { type: 'image/jpeg' })
            : named
              ? new File([job.file], 'profile-photo.' + named.ext, { type: named.type })
              : job.file;
          const stored = await bridge().uploadFile(upload, { visibility: 'public' });
          sessionUploads.add(stored.id);
          const idx = draft.photos.indexOf(job.slot);
          if (idx !== -1) draft.photos[idx] = { id: stored.id, url: stored.url };
        } catch (err) {
          const idx = draft.photos.indexOf(job.slot);
          if (idx !== -1) draft.photos.splice(idx, 1);
          photoError = uploadMessage(err);
        } finally {
          uploading--;
        }
      }));
      renderPhotos();
    }

    function uploadMessage(err) {
      // Errors arrive as a code, or as a message like "invalid_image: ...".
      const messageText = String((err && err.message) || '');
      function has(code) {
        return (err && err.code === code) || messageText.indexOf(code) !== -1;
      }
      if (has('user_quota_exceeded') || has('app_quota_exceeded') || has('staging_quota_exceeded')) {
        return 'Your photo storage is full. Delete a photo and try again.';
      }
      if (has('storage_unavailable')) return 'Photo storage is not available right now. Try again later.';
      if (has('invalid_image')) return 'That file is not an image we can use. Try another.';
      if (has('file_too_large')) return 'That image is too large. Try a smaller one.';
      if (/shell|standalone/i.test(String(err && err.message))) {
        return 'Photo uploads are not available here. Open Omichat inside Homeroom to add photos.';
      }
      if (err && err.message && err.message.indexOf('5 MB') !== -1) return err.message;
      return 'The photo did not upload. Try again.';
    }

    // ---------------------------------------------------------------- basics
    const basics = section('Basics');
    const nameField = textField('name', 'Name', { max: L.name, autocomplete: 'given-name' });
    const ageField = textField('age', 'Age (optional)', { type: 'text', inputMode: 'numeric', max: 2 });
    const ageRow = el('div', 'grid grid-cols-3 gap-3');
    nameField.wrap.className += ' col-span-2';
    ageRow.append(nameField.wrap, ageField.wrap);
    basics.append(ageRow);
    form.append(basics);

    const aboutSection = section('About you');
    const bioField = textField('bio', 'Bio', { multiline: true, max: L.bio, rows: 5,
      placeholder: 'What do you like doing, and who would you like to meet?' });
    aboutSection.append(bioField.wrap);
    form.append(aboutSection);

    // ------------------------------------------------------------ looking for
    const lookingSection = section('Looking for', 'Pick the one that fits best.');
    const lookingBody = el('div', 'flex flex-wrap gap-2');
    lookingBody.setAttribute('role', 'radiogroup');
    lookingBody.setAttribute('aria-label', 'Looking for');
    lookingSection.append(lookingBody);
    form.append(lookingSection);
    function renderLooking() {
      lookingBody.innerHTML = '';
      Schema.LOOKING_FOR.forEach(function (o) {
        const on = draft.lookingFor === o.value;
        const b = document.createElement('button');
        b.type = 'button';
        b.setAttribute('role', 'radio');
        b.setAttribute('aria-checked', on ? 'true' : 'false');
        b.className = chipCls(on, false);
        b.textContent = o.label;
        b.addEventListener('click', function () {
          draft.lookingFor = on ? null : o.value; // tap again to clear
          renderLooking();
          renderCompleteness();
        });
        lookingBody.append(b);
      });
    }

    // ------------------------------------------------------- job & education
    const workSection = section('Work and education');
    const jobField = textField('job', 'Job (optional)', { max: L.job, placeholder: 'e.g. Bike mechanic' });
    const eduField = textField('education', 'Education (optional)', { max: L.education, placeholder: 'e.g. Linguistics, University of Porto' });
    workSection.append(jobField.wrap, eduField.wrap);
    form.append(workSection);

    // -------------------------------------------------------------- interests
    const interestsSection = section('Interests');
    interestsSection.dataset.testid = 'edit-interests';
    const interestsMeta = el('p', 'text-xs text-zinc-500');
    const interestsBody = el('div', 'flex flex-wrap gap-2');
    const interestsErr = el('p', 'text-xs text-rose-300');
    interestsSection.append(interestsMeta, interestsBody, interestsErr);
    form.append(interestsSection);
    function renderInterests() {
      const full = draft.interests.length >= L.interests;
      interestsMeta.textContent = draft.interests.length + ' of ' + L.interests + ' selected' +
        (full ? '. Remove one to pick another.' : '');
      interestsBody.innerHTML = '';
      Schema.INTERESTS.forEach(function (name) {
        const on = draft.interests.indexOf(name) !== -1;
        const b = document.createElement('button');
        b.type = 'button';
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
        b.disabled = !on && full;
        b.className = chipCls(on, !on && full);
        b.textContent = name;
        b.addEventListener('click', function () {
          if (on) draft.interests.splice(draft.interests.indexOf(name), 1);
          else if (draft.interests.length < L.interests) draft.interests.push(name);
          delete errors.interests;
          renderInterests();
          renderCompleteness();
        });
        interestsBody.append(b);
      });
      interestsErr.textContent = errors.interests || '';
    }

    // -------------------------------------------------------------- languages
    const languagesSection = section('Languages', 'Optional. Up to ' + L.languages + ', so people can see why you match a language filter.');
    languagesSection.dataset.testid = 'edit-languages';
    const languagesMeta = el('p', 'text-xs text-zinc-500');
    const languagesBody = el('div', 'flex flex-wrap gap-2');
    const languagesErr = el('p', 'text-xs text-rose-300');
    languagesSection.append(languagesMeta, languagesBody, languagesErr);
    form.append(languagesSection);
    function renderLanguages() {
      const full = draft.languages.length >= L.languages;
      languagesMeta.textContent = draft.languages.length + ' of ' + L.languages + ' selected' +
        (full ? '. Remove one to pick another.' : '');
      languagesBody.innerHTML = '';
      Schema.LANGUAGES.forEach(function (name) {
        const on = draft.languages.indexOf(name) !== -1;
        const b = document.createElement('button');
        b.type = 'button';
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
        b.disabled = !on && full;
        b.className = chipCls(on, !on && full);
        b.textContent = name;
        b.addEventListener('click', function () {
          if (on) draft.languages.splice(draft.languages.indexOf(name), 1);
          else if (draft.languages.length < L.languages) draft.languages.push(name);
          delete errors.languages;
          renderLanguages();
        });
        languagesBody.append(b);
      });
      languagesErr.textContent = errors.languages || '';
    }

    // ---------------------------------------------------------------- prompts
    const promptsSection = section('Prompts', 'Answer up to ' + L.prompts + ' prompts in a sentence or two.');
    promptsSection.dataset.testid = 'edit-prompts';
    const promptsBody = el('div', 'flex flex-col gap-3');
    promptsSection.append(promptsBody);
    form.append(promptsSection);
    function renderPrompts() {
      promptsBody.innerHTML = '';
      if (!draft.prompts.length) {
        promptsBody.append(el('p', 'text-sm text-zinc-500', 'No prompts yet. They give people an easy way to start talking.'));
      }
      draft.prompts.forEach(function (p, idx) {
        const block = el('div', 'rounded-2xl border border-zinc-800 bg-zinc-900/60 p-3 flex flex-col gap-2');
        block.dataset.testid = 'prompt-block';
        const sel = document.createElement('select');
        sel.className = INPUT_CLS;
        sel.setAttribute('aria-label', 'Prompt ' + (idx + 1));
        Schema.PROMPTS.forEach(function (q) {
          const usedElsewhere = draft.prompts.some(function (o, j) { return j !== idx && o.prompt === q; });
          if (usedElsewhere) return;
          const opt = document.createElement('option');
          opt.value = q;
          opt.textContent = q;
          sel.append(opt);
        });
        sel.value = p.prompt;
        sel.addEventListener('change', function () {
          p.prompt = sel.value;
          delete errors['prompt' + idx];
          renderPrompts();
        });
        const ta = document.createElement('textarea');
        ta.rows = 2;
        ta.maxLength = L.answer;
        ta.className = INPUT_CLS + ' resize-none';
        ta.placeholder = 'Your answer';
        ta.setAttribute('aria-label', 'Answer to prompt ' + (idx + 1));
        ta.value = p.answer || '';
        const foot = el('div', 'flex items-center justify-between gap-2');
        const counter = el('span', 'text-xs text-zinc-500', ta.value.length + ' / ' + L.answer);
        const err = el('p', 'text-xs text-rose-300', errors['prompt' + idx] || '');
        ta.addEventListener('input', function () {
          p.answer = ta.value;
          counter.textContent = ta.value.length + ' / ' + L.answer;
          if (errors['prompt' + idx] && ta.value.trim()) { delete errors['prompt' + idx]; err.textContent = ''; }
          renderCompleteness();
        });
        const remove = textButton('Remove', function () {
          draft.prompts.splice(idx, 1);
          errors = shiftPromptErrors(errors, idx);
          renderPrompts();
          renderCompleteness();
        });
        foot.append(remove, counter);
        block.append(sel, ta, err, foot);
        promptsBody.append(block);
      });
      if (draft.prompts.length < L.prompts) {
        const add = UI.Button('Add a prompt', {
          variant: 'outline',
          onClick: function () {
            const unused = Schema.PROMPTS.filter(function (q) {
              return !draft.prompts.some(function (o) { return o.prompt === q; });
            });
            draft.prompts.push({ prompt: unused[0], answer: '' });
            renderPrompts();
            const tas = promptsBody.querySelectorAll('textarea');
            if (tas.length) tas[tas.length - 1].focus({ preventScroll: true });
          },
        });
        add.dataset.testid = 'add-prompt';
        add.className += ' self-start';
        promptsBody.append(add);
      }
    }

    function shiftPromptErrors(errs, removed) {
      const next = {};
      Object.keys(errs).forEach(function (k) {
        const m = /^prompt(\d)$/.exec(k);
        if (!m) { next[k] = errs[k]; return; }
        const n = Number(m[1]);
        if (n < removed) next[k] = errs[k];
        else if (n > removed) next['prompt' + (n - 1)] = errs[k];
      });
      return next;
    }

    // ----------------------------------------------------------------- social
    const socialSection = section('Instagram and Spotify', 'Optional. They show on your profile only when filled in.');
    const igField = textField('instagram', 'Instagram username', { prefix: '@', max: 31, autocomplete: 'off', placeholder: 'yourname' });
    const spField = textField('spotify', 'Spotify username', { prefix: '@', max: 31, autocomplete: 'off', placeholder: 'yourname' });
    socialSection.append(igField.wrap, spField.wrap);
    form.append(socialSection);

    const fields = [nameField, ageField, bioField, jobField, eduField, igField, spField];

    // ----------------------------------------------------------------- helpers
    function section(titleText, hintText) {
      const s = el('div', 'flex flex-col gap-3');
      const head = el('div', 'flex flex-col gap-0.5');
      head.append(el('h2', 'text-base font-semibold text-zinc-100', titleText));
      if (hintText) head.append(el('p', 'text-xs text-zinc-500', hintText));
      s.append(head);
      return s;
    }

    function textButton(label, onClick) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.className = 'rounded-full px-3 py-1.5 text-sm font-medium text-sky-300 hover:text-sky-200 ' +
        'active:scale-95 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400';
      b.addEventListener('click', onClick);
      return b;
    }

    function textField(key, label, o) {
      o = o || {};
      const wrap = el('label', 'flex flex-col gap-1.5');
      const top = el('div', 'flex items-center justify-between gap-2');
      top.append(el('span', 'text-xs font-medium text-zinc-400', label));
      const counter = o.max && o.max > 3 && !o.prefix ? el('span', 'text-xs text-zinc-500') : null;
      if (counter) top.append(counter);
      wrap.append(top);
      const input = document.createElement(o.multiline ? 'textarea' : 'input');
      if (!o.multiline) input.type = o.type || 'text';
      if (o.rows) input.rows = o.rows;
      if (o.inputMode) input.inputMode = o.inputMode;
      if (o.max) input.maxLength = o.max;
      if (o.placeholder) input.placeholder = o.placeholder;
      input.autocomplete = o.autocomplete || 'off';
      input.className = INPUT_CLS + (o.multiline ? ' resize-none' : '') + (o.prefix ? ' pl-8' : '');
      const v = draft[key];
      input.value = v == null ? '' : String(v);
      let holder = input;
      if (o.prefix) {
        holder = el('div', 'relative');
        holder.append(el('span', 'absolute left-3 top-1/2 -translate-y-1/2 text-sm text-zinc-500 pointer-events-none', o.prefix));
        holder.append(input);
      }
      wrap.append(holder);
      const err = el('p', 'text-xs text-rose-300');
      wrap.append(err);
      function updateCounter() {
        if (counter) counter.textContent = input.value.length + ' / ' + o.max;
      }
      updateCounter();
      input.addEventListener('input', function () {
        let val = input.value;
        if (key === 'age') {
          val = val.replace(/\D/g, '');
          if (val !== input.value) input.value = val;
          draft.age = val === '' ? null : Number(val);
        } else if (o.prefix) {
          draft[key] = val.replace(/^@+/, '');
        } else {
          draft[key] = val;
        }
        updateCounter();
        if (errors[key]) {
          // Re-check just this field so the message clears as soon as it is fixed.
          const again = Schema.validate(draft).errors[key];
          if (!again) { delete errors[key]; showFieldError(field); clearFormErrorIfFixed(); }
        }
        renderCompleteness();
      });
      const field = { key: key, wrap: wrap, input: input, err: err };
      return field;
    }

    function showFieldError(f) {
      const msg = errors[f.key] || '';
      f.err.textContent = msg;
      f.input.setAttribute('aria-invalid', msg ? 'true' : 'false');
      f.input.classList.toggle('border-rose-400', !!msg);
      f.input.classList.toggle('border-zinc-700', !msg);
    }

    function clearFormErrorIfFixed() {
      if (!Object.keys(errors).length) formError.classList.add('hidden');
    }

    function showAllErrors() {
      fields.forEach(showFieldError);
      renderPhotos();
      renderInterests();
      renderLanguages();
      renderPrompts();
      const any = Object.keys(errors).length;
      formError.textContent = any ? 'Check the highlighted fields.' : '';
      formError.classList.toggle('hidden', !any);
      if (any) {
        const first = form.querySelector('[aria-invalid="true"]') ||
          form.querySelector('.text-rose-300:not(:empty)');
        if (first && first.scrollIntoView) first.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    }

    function dirty() {
      return JSON.stringify(Schema.validate(draft).value) !== JSON.stringify(Schema.validate(original).value) ||
        uploading > 0;
    }

    // ----------------------------------------------------------- save, cancel
    async function onSave() {
      if (saving || uploading > 0) return;
      const result = Schema.validate(draft);
      errors = result.errors;
      if (Object.keys(errors).length) { showAllErrors(); return; }
      saving = true;
      formError.classList.add('hidden');
      renderPhotos();
      try {
        const r = await deps.save(result.value);
        const data = await r.json().catch(function () { return {}; });
        if (!r.ok) {
          errors = data.fields || {};
          saving = false;
          showAllErrors();
          if (!data.fields) {
            formError.textContent = data.error || 'Could not save your profile. Try again.';
            formError.classList.remove('hidden');
          }
          return;
        }
        // Delete stored files that are no longer on the profile.
        const kept = new Set(result.value.photos.map(function (p) { return p.id; }));
        const dropped = original.photos.map(function (p) { return p.id; })
          .concat(Array.from(sessionUploads))
          .filter(function (id) { return id && !kept.has(id); });
        deleteFiles(dropped);
        saving = false;
        deps.toast('Profile saved');
        deps.onDone({ username: data.username, profile: data.profile });
      } catch (err) {
        saving = false;
        renderPhotos();
        formError.textContent = 'Could not reach the server. Check your connection and try again.';
        formError.classList.remove('hidden');
      }
    }

    function deleteFiles(ids) {
      const b = bridge();
      if (!b || typeof b.deleteFile !== 'function') return;
      ids.forEach(function (id) { b.deleteFile(id).catch(function () {}); });
    }

    async function onCancel() {
      if (dirty()) {
        let discard = true;
        if (window.unNative && typeof window.unNative.alert === 'function') {
          const res = await window.unNative.alert({
            title: 'Discard your changes?',
            message: 'Your edits to your profile will not be saved.',
            buttons: [
              { label: 'Keep editing', style: 'cancel' },
              { label: 'Discard', style: 'destructive' },
            ],
          });
          discard = !!(res && res.button && res.button.label === 'Discard');
        } else {
          discard = window.confirm('Discard your changes?');
        }
        if (!discard) return;
      }
      deleteFiles(Array.from(sessionUploads));
      deps.onCancel();
    }

    renderCompleteness();
    renderPhotos();
    renderLooking();
    renderInterests();
    renderLanguages();
    renderPrompts();
    root.scroller = scroller;
    return root;
  }

  // Completeness meter: the percentage, a bar, and the next things to add.
  // opts.onHint makes each hint a button (the Profile tab opens Edit Profile).
  function CompletenessMeter(c, opts) {
    opts = opts || {};
    const wrap = el('div', 'flex flex-col gap-2');
    wrap.dataset.testid = 'profile-completeness';
    const top = el('div', 'flex items-center justify-between gap-2');
    top.append(el('p', 'text-sm font-semibold text-zinc-100', 'Profile ' + c.percent + '% complete'));
    wrap.append(top);
    const track = el('div', 'h-2 rounded-full bg-zinc-800 overflow-hidden');
    track.setAttribute('role', 'progressbar');
    track.setAttribute('aria-valuemin', '0');
    track.setAttribute('aria-valuemax', '100');
    track.setAttribute('aria-valuenow', String(c.percent));
    track.setAttribute('aria-label', 'Profile completeness');
    const fill = el('div', 'h-full rounded-full bg-gradient-to-r from-sky-500 to-indigo-600 transition-all motion-reduce:transition-none');
    fill.style.width = c.percent + '%';
    track.append(fill);
    wrap.append(track);
    if (!c.hints.length) {
      wrap.append(el('p', 'text-xs text-zinc-400', 'Your profile is complete. Nice.'));
      return wrap;
    }
    const shown = c.hints.slice(0, opts.compact ? 2 : 3);
    const list = el('ul', 'flex flex-col gap-1');
    shown.forEach(function (h) {
      const li = el('li', 'text-xs text-zinc-400 flex items-center gap-1.5');
      li.innerHTML = '<span class="text-sky-300 shrink-0">' + icon('plus', 'w-3.5 h-3.5') + '</span>';
      li.append(el('span', null, h));
      list.append(li);
    });
    wrap.append(el('p', 'text-xs font-medium text-zinc-300', 'Next:'));
    wrap.append(list);
    return wrap;
  }

  window.OmichatProfileEdit = { build: build, CompletenessMeter: CompletenessMeter };
})();
