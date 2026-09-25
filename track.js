/* QuantiDawn privacy-friendly analytics. No cookies, no fingerprinting, no personal data.
   Sends page views, clicks, time on page and scroll depth to /api/collect. The only thing kept in
   the browser is a random visit id in sessionStorage, which vanishes when the tab closes.
   Skipped entirely for Do Not Track / Global Privacy Control, and for a browser that opted out
   from the dashboard (localStorage qd_ignore). */
(function () {
  'use strict';
  var nav = navigator;
  if (nav.doNotTrack === '1' || window.doNotTrack === '1' || nav.globalPrivacyControl) return;
  try { if (localStorage.getItem('qd_ignore') === '1') return; } catch (e) {}

  function rand() {
    var a = new Uint8Array(16), s = '', i;
    (window.crypto || window.msCrypto).getRandomValues(a);
    for (i = 0; i < a.length; i++) s += (a[i] < 16 ? '0' : '') + a[i].toString(16);
    return s;
  }
  var sid;
  try { sid = sessionStorage.getItem('qd_s'); if (!sid) { sid = rand(); sessionStorage.setItem('qd_s', sid); } } catch (e) { sid = rand(); }

  function send(o) {
    o.s = sid; o.p = location.pathname.replace(/index\.html$/, '');
    var body = JSON.stringify(o);
    try { if (nav.sendBeacon && nav.sendBeacon('/api/collect', new Blob([body], { type: 'text/plain' }))) return; } catch (e) {}
    try { fetch('/api/collect', { method: 'POST', body: body, keepalive: true, headers: { 'Content-Type': 'text/plain' } }).catch(function () {}); } catch (e) {}
  }
  window.qdTrack = function (name) { send({ t: 'conversion', l: String(name).slice(0, 60) }); };

  var shownAt = 0, engaged = 0, maxScroll = 0;
  function scrollPct() {
    var el = document.documentElement, h = el.scrollHeight - el.clientHeight;
    return h > 0 ? Math.min(100, Math.round(((window.pageYOffset || el.scrollTop) / h) * 100)) : 100;
  }
  function tick() { if (shownAt) { engaged += Date.now() - shownAt; shownAt = 0; } }
  function flush() {
    tick();
    if (engaged < 300) return;
    send({ t: 'leave', d: Math.min(engaged, 1800000), c: maxScroll });
    engaged = 0;
  }

  function start() {
    var utm = null, ref = null;
    try { utm = new URLSearchParams(location.search).get('utm_source'); } catch (e) {}
    try { if (document.referrer) ref = new URL(document.referrer).hostname.replace(/^www\./, ''); } catch (e) {}
    send({ t: 'pageview', r: ref, u: utm && utm.toLowerCase() });
    if (document.visibilityState !== 'hidden') shownAt = Date.now();
    maxScroll = scrollPct();

    window.addEventListener('scroll', function () { var p = scrollPct(); if (p > maxScroll) maxScroll = p; }, { passive: true });
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') flush(); else shownAt = Date.now();
    });
    window.addEventListener('pagehide', flush);

    document.addEventListener('click', function (e) {
      var el = e.target && e.target.closest && e.target.closest('a[href], button, [data-track]');
      if (!el || el.matches('input, select, textarea')) return;
      var text = (el.getAttribute('data-track') || el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 50);
      var label = text || 'Unnamed control';
      if (el.tagName === 'A') {
        var href = el.getAttribute('href') || '', u;
        if (/^mailto:/i.test(href)) label = 'Email link';
        else if (/^tel:/i.test(href)) label = 'Phone link';
        else {
          try { u = new URL(el.href, location.href); } catch (err) { u = null; }
          if (u && u.host !== location.host) label = text + ' (outbound: ' + u.hostname + ')';
          else if (u) label = text + ' → ' + u.pathname;
        }
      }
      send({ t: 'click', l: label });
    }, true);
  }

  if (document.prerendering) document.addEventListener('prerenderingchange', start, { once: true }); else start();
})();
