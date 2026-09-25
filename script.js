/* QuantiDawn - shared behaviour. No dependencies. */
(function () {
  'use strict';

  /* ---- Mobile navigation ------------------------------------------------ */
  var toggle = document.querySelector('.nav-toggle');
  var nav = document.getElementById('site-nav');

  if (toggle && nav) {
    var desktop = window.matchMedia('(min-width: 960px)');

    var setOpen = function (open, returnFocus) {
      nav.classList.toggle('is-open', open);
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
      var label = toggle.querySelector('.nav-toggle-label');
      if (label) label.textContent = open ? 'Close' : 'Menu';
      if (!open && returnFocus) toggle.focus();
    };

    toggle.addEventListener('click', function () {
      setOpen(toggle.getAttribute('aria-expanded') !== 'true');
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') {
        setOpen(false, true);
      }
    });

    nav.addEventListener('click', function (e) {
      if (e.target.closest('a')) setOpen(false);
    });

    var onBreakpoint = function () { if (desktop.matches) setOpen(false); };
    if (desktop.addEventListener) desktop.addEventListener('change', onBreakpoint);
    else desktop.addListener(onBreakpoint);
  }

  /* ---- Hero dawn clip ----------------------------------------------------
     Progressive enhancement: only on desktop-size screens, with motion allowed
     and no data-saver. Starts after the page has loaded, loops (forward, then
     in reverse, so there is no jump). The photo underneath is the poster. */
  var heroVideo = document.querySelector('.hero-video');
  var heroBtn = document.querySelector('.hero-motion');
  if (heroVideo && heroBtn) {
    var conn = navigator.connection || {};
    var motionOk = window.matchMedia('(min-width: 768px)').matches &&
      !window.matchMedia('(prefers-reduced-motion: reduce)').matches &&
      !conn.saveData && !/(^|-)2g$/.test(conn.effectiveType || '');

    if (motionOk) {
      var startHero = function () {
        heroVideo.src = heroVideo.canPlayType('video/webm; codecs="vp9"') ? heroVideo.dataset.webm : heroVideo.dataset.mp4;
        var p = heroVideo.play();
        if (p && p.catch) p.catch(function () { heroVideo.removeAttribute('src'); heroVideo.load(); });
      };
      heroVideo.addEventListener('playing', function () { heroVideo.classList.add('is-playing'); heroBtn.hidden = false; });
      heroBtn.addEventListener('click', function () {
        var pause = !heroVideo.paused;
        heroBtn.classList.toggle('is-paused', pause);
        heroBtn.setAttribute('aria-label', pause ? 'Play background video' : 'Pause background video');
        if (pause) heroVideo.pause(); else heroVideo.play();
      });
      if (document.readyState === 'complete') startHero();
      else window.addEventListener('load', startHero);
    }
  }

  /* ---- Footer year ------------------------------------------------------- */
  var year = document.getElementById('year');
  if (year) year.textContent = new Date().getFullYear();
})();

/* ==========================================================================
   Quote form: client-side validation, loading state, confirmation.
   Only runs on get-a-quote.html.
   ========================================================================== */
(function () {
  'use strict';

  var form = document.getElementById('quote-form');
  if (!form) return;

  var MAX_BYTES = 25 * 1024 * 1024;
  var ALLOWED = ['pdf', 'dwg', 'dxf', 'jpg', 'jpeg'];
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  var PHONE_RE = /^[+()\d][\d\s().+-]{5,19}$/;

  var submitBtn = document.getElementById('submit-btn');
  var btnLabel = submitBtn.querySelector('.btn-label');
  var statusEl = document.getElementById('form-status');
  var submitError = document.getElementById('submit-error');
  var success = document.getElementById('success');
  var successTitle = document.getElementById('success-title');
  var resetBtn = document.getElementById('reset-btn');

  /* Each field: how to find the control(s), and a function returning an error string ('' = valid). */
  var fields = [
    { name: 'name', el: 'name', check: function (v) { return v.trim() ? '' : 'Enter your name.'; } },
    { name: 'company', el: 'company', check: function (v) { return v.trim() ? '' : 'Enter your company name.'; } },
    { name: 'email', el: 'email', check: function (v) {
        if (!v.trim()) return 'Enter your email address.';
        return EMAIL_RE.test(v.trim()) ? '' : 'Enter a valid email, like name@company.com.';
    } },
    { name: 'phone', el: 'phone', check: function (v) {
        if (!v.trim()) return '';                       // optional
        return PHONE_RE.test(v.trim()) ? '' : 'Enter a valid phone number, or leave this blank.';
    } },
    { name: 'market', el: 'market', check: function (v) { return v ? '' : 'Select your country or market.'; } },
    { name: 'projectType', group: true, check: function (v) { return v ? '' : 'Choose a project type.'; } },
    { name: 'description', el: 'description', check: function (v) {
        var t = v.trim();
        if (!t) return 'Describe your project - a few lines is enough.';
        return t.length >= 10 ? '' : 'Add a little more detail (at least 10 characters).';
    } },
    { name: 'plans', el: 'plans', file: true, check: function (files) {
        for (var i = 0; i < files.length; i++) {
          var f = files[i];
          var ext = (f.name.split('.').pop() || '').toLowerCase();
          if (ALLOWED.indexOf(ext) === -1) return '"' + f.name + '" is not a supported file. Upload PDF, DWG, DXF or JPG.';
          if (f.size > MAX_BYTES) return '"' + f.name + '" is larger than 25 MB. Upload a smaller file.';
        }
        return '';
    } },
    { name: 'interest', group: true, check: function (v) { return v ? '' : 'Choose single project or monthly retainer.'; } }
  ];

  function valueOf(f) {
    if (f.group) {
      var checked = form.querySelector('input[name="' + f.name + '"]:checked');
      return checked ? checked.value : '';
    }
    var el = document.getElementById(f.el);
    return f.file ? el.files : el.value;
  }

  function controlsOf(f) {
    return f.group ? form.querySelectorAll('input[name="' + f.name + '"]') : [document.getElementById(f.el)];
  }

  function errorElOf(f) { return document.getElementById((f.group ? f.name : f.el) + '-error'); }

  function setError(f, message) {
    var err = errorElOf(f);
    var controls = controlsOf(f);
    var holder = f.group ? document.getElementById(f.name + '-group') : controls[0];
    if (message) {
      err.textContent = message;
      err.hidden = false;
      holder.classList.add('is-invalid');
      Array.prototype.forEach.call(controls, function (c) { c.setAttribute('aria-invalid', 'true'); });
    } else {
      err.textContent = '';
      err.hidden = true;
      holder.classList.remove('is-invalid');
      Array.prototype.forEach.call(controls, function (c) { c.removeAttribute('aria-invalid'); });
    }
  }

  function validateField(f) {
    var message = f.check(valueOf(f));
    setError(f, message);
    return message;
  }

  /* Validate when the user leaves a field; once a field shows an error, re-check as they fix it. */
  fields.forEach(function (f) {
    Array.prototype.forEach.call(controlsOf(f), function (c) {
      c.addEventListener('blur', function () {
        // for radio groups, wait until focus leaves the whole group
        if (f.group) { setTimeout(function () {
          if (!document.getElementById(f.name + '-group').contains(document.activeElement)) validateField(f);
        }, 0); return; }
        validateField(f);
      });
      var live = function () { if (!errorElOf(f).hidden) validateField(f); };
      c.addEventListener('input', live);
      c.addEventListener('change', live);
    });
  });

  function validateAll() {
    var first = null, count = 0;
    fields.forEach(function (f) {
      if (validateField(f)) { count++; if (!first) first = f; }
    });
    return { first: first, count: count };
  }

  /* ---- Delivery ---------------------------------------------------------------
     Requests go to a Supabase project: a table for the lead and a private bucket for
     the uploaded plans (see backend/quote-inbox.sql). Fill in BACKEND.url and BACKEND.key
     with the project URL and its publishable (anon) key. Both are safe to expose
     because Row Level Security only allows inserts. While BACKEND.url is empty the
     submission is simulated so the form can still be previewed.                    */
  var BACKEND = Object.assign({ url: '', key: '', table: 'quote_requests', bucket: 'quote-plans' }, window.QUANTIDAWN_BACKEND || {});

  function newId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    var b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    var h = Array.prototype.map.call(b, function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }

  function send(path, options) {
    return fetch(BACKEND.url + path, options).then(function (r) {
      if (!r.ok) throw new Error('Request failed: ' + r.status);
      return r;
    });
  }

  function submitQuote() {
    if (document.getElementById('website').value) return Promise.resolve();      // honeypot: bots fill this in
    if (!BACKEND.url) return new Promise(function (resolve) { setTimeout(resolve, 1400); });

    var id = newId();
    var auth = { apikey: BACKEND.key, Authorization: 'Bearer ' + BACKEND.key };
    var files = Array.prototype.slice.call(document.getElementById('plans').files);
    var paths = [];

    // 1) upload plans one at a time, 2) then save the lead with the file paths
    var uploaded = files.reduce(function (chain, file, i) {
      return chain.then(function () {
        var path = id + '/' + (i + 1) + '-' + file.name.replace(/[^\w.\-]+/g, '_').slice(-120);
        return send('/storage/v1/object/' + BACKEND.bucket + '/' + path, {
          method: 'POST',
          headers: Object.assign({ 'Content-Type': file.type || 'application/octet-stream', 'x-upsert': 'false' }, auth),
          body: file
        }).then(function () { paths.push(path); });
      });
    }, Promise.resolve());

    return uploaded.then(function () {
      var val = function (el) { return document.getElementById(el).value.trim(); };
      var row = {
        id: id,
        name: val('name'),
        company: val('company'),
        email: val('email'),
        phone: val('phone') || null,
        market: document.getElementById('market').value,
        project_type: form.querySelector('input[name="projectType"]:checked').value,
        interest: form.querySelector('input[name="interest"]:checked').value,
        description: val('description'),
        timing: document.getElementById('timing').value || null,
        files: paths
      };
      return send('/rest/v1/' + BACKEND.table, {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }, auth),
        body: JSON.stringify(row)
      });
    });
  }

  function setLoading(on) {
    submitBtn.disabled = on;
    submitBtn.classList.toggle('is-loading', on);
    submitBtn.setAttribute('aria-busy', String(on));
    form.setAttribute('aria-busy', String(on));
    btnLabel.textContent = on ? 'Sending…' : 'Send Request';
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (submitBtn.disabled) return;
    submitError.hidden = true;

    var result = validateAll();
    if (result.first) {
      statusEl.textContent = result.count === 1
        ? 'There is 1 field to correct.'
        : 'There are ' + result.count + ' fields to correct.';
      var target = result.first.group
        ? form.querySelector('input[name="' + result.first.name + '"]')
        : document.getElementById(result.first.el);
      target.focus();
      return;
    }

    statusEl.textContent = '';
    setLoading(true);
    submitQuote().then(function () {
      form.hidden = true;
      success.hidden = false;
      successTitle.focus();
    }).catch(function () {
      submitError.textContent = 'We couldn’t send your request. Please check your connection and try again.';
      submitError.hidden = false;
    }).then(function () { setLoading(false); });
  });

  resetBtn.addEventListener('click', function () {
    form.reset();
    fields.forEach(function (f) { setError(f, ''); });
    success.hidden = true;
    form.hidden = false;
    document.getElementById('name').focus();
  });
})();
