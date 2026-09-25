/* QuantiDawn dashboard. No framework, no build step.
   Security notes:
   - Every value that came from the public quote form is written with textContent (never innerHTML),
     so a hostile submission cannot inject markup or script into this page.
   - CSV export guards against spreadsheet formula injection.
   - Access control is enforced by the database (Row Level Security + public.admins), not by this page. */
(function () {
  'use strict';

  /* ======================================================================= config */
  var CFG = Object.assign({ url: '', key: '', table: 'quote_requests', bucket: 'quote-plans' }, window.QUANTIDAWN_BACKEND || {});
  var DEMO = !CFG.url;
  var DAY = 86400000;

  var STATUSES = ['new', 'contacted', 'quoted', 'won', 'lost', 'spam'];
  var STATUS_LABEL = { new: 'New', contacted: 'Contacted', quoted: 'Quoted', won: 'Won', lost: 'Lost', spam: 'Spam' };
  var MARKET_LABEL = { AU: 'Australia', US: 'United States', SG: 'Singapore', Other: 'Other' };
  var TYPE_LABEL = { residential: 'Residential', commercial: 'Commercial', civil: 'Civil', subcontractor: 'Subcontractor' };
  var INTEREST_LABEL = { single: 'Single project', retainer: 'Monthly retainer' };
  var TIMING_LABEL = { asap: 'As soon as possible', week: 'Within a week', flexible: 'Flexible' };
  var CURRENCIES = ['AUD', 'USD', 'SGD', 'PHP'];
  var STATUS_COLOR = { new: '#FD6101', contacted: '#3F6A97', quoted: '#5A4FB0', won: '#227E51', lost: '#85827E', spam: '#B9B7B3' };
  var WEEKDAYS = [[1, 'Monday'], [2, 'Tuesday'], [3, 'Wednesday'], [4, 'Thursday'], [5, 'Friday'], [6, 'Saturday'], [0, 'Sunday']];

  /* ======================================================================= tiny helpers */
  function $(id) { return document.getElementById(id); }
  function append(node, kid) {
    if (kid == null || kid === false) return;
    if (Array.isArray(kid)) { kid.forEach(function (k) { append(node, k); }); return; }
    node.appendChild(typeof kid === 'object' ? kid : document.createTextNode(String(kid)));
  }
  function h(tag, props) {
    var node = document.createElement(tag);
    Object.keys(props || {}).forEach(function (k) {
      var v = props[k];
      if (v == null || v === false) return;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), v);
      else if (k === 'dataset') Object.keys(v).forEach(function (d) { node.dataset[d] = v[d]; });
      else node.setAttribute(k, v === true ? '' : v);
    });
    for (var i = 2; i < arguments.length; i++) append(node, arguments[i]);
    return node;
  }
  function svg(name, attrs) {
    var n = document.createElementNS('http://www.w3.org/2000/svg', name);
    Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    for (var i = 2; i < arguments.length; i++) if (arguments[i]) n.appendChild(arguments[i]);
    return n;
  }
  function setKids(node, kids) { while (node.firstChild) node.removeChild(node.firstChild); append(node, kids); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function todayStr() { return ymd(new Date()); }
  function t(row) { return new Date(row.created_at).getTime(); }
  function sum(list) { return list.reduce(function (a, b) { return a + b; }, 0); }
  function pct(a, b) { return b ? Math.round((a / b) * 100) : 0; }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many || one + 's'); }

  var dateFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  var dateTimeFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  function fmtDate(iso) { return iso ? dateFmt.format(new Date(iso)) : '—'; }
  function fmtDateTime(iso) { return iso ? dateTimeFmt.format(new Date(iso)) : '—'; }
  function ago(iso) {
    var m = (Date.now() - new Date(iso).getTime()) / 60000;
    if (m < 1) return 'just now';
    if (m < 60) return Math.floor(m) + ' min ago';
    if (m < 1440) return Math.floor(m / 60) + ' h ago';
    if (m < 43200) return Math.floor(m / 1440) + ' d ago';
    return fmtDate(iso);
  }
  function hoursFmt(hr) {
    if (hr < 1) return Math.max(1, Math.round(hr * 60)) + ' min';
    if (hr < 48) return (Math.round(hr * 10) / 10) + ' h';
    return (Math.round(hr / 2.4) / 10) + ' d';
  }
  function money(v, cur) {
    if (v == null || v === '') return '—';
    try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur || 'USD', currencyDisplay: 'code', maximumFractionDigits: 0 }).format(v).replace(/ /g, ' '); }
    catch (e) { return (cur || '') + ' ' + v; }
  }
  function firstName(name) { return (name || '').trim().split(/\s+/)[0] || 'there'; }
  function fileLabel(path) { var base = String(path).split('/').pop(); return base.replace(/^\d+-/, ''); }

  function store(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* private mode: settings just won't persist */ } }
  function load(key) { try { return JSON.parse(localStorage.getItem(key)) || null; } catch (e) { return null; } }

  var toastTimer = null;
  function toast(msg, isError) {
    var n = $('toast');
    n.textContent = msg;
    n.className = 'toast' + (isError ? ' toast--error' : '');
    n.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { n.hidden = true; }, isError ? 5000 : 3000);
  }

  /* ======================================================================= settings + templates */
  var SETTINGS_KEY = 'quantidawn-admin-settings';
  var TPL_KEY = 'quantidawn-admin-templates';
  var settings = Object.assign({ target: 24, currency: 'AUD', pageSize: 25 }, load(SETTINGS_KEY));

  var DEFAULT_TEMPLATES = [
    { id: 'ack', label: 'Acknowledge the request', subject: 'Your QuantiDawn quote request',
      body: 'Hi {name},\n\nThanks for sending your project details to QuantiDawn. We have received your request for {company} and will come back to you with a quote within one business day.\n\nIf you have any extra drawings or scope notes, just reply to this email and attach them.\n\nKind regards,\nQuantiDawn' },
    { id: 'info', label: 'Ask for more information', subject: 'A few questions about your {project} project',
      body: 'Hi {name},\n\nThanks for your request. To give you an accurate quote we need a little more information:\n\n- \n- \n\nIf it is easier, reply with updated drawings or a short list of scope notes.\n\nKind regards,\nQuantiDawn' },
    { id: 'quote', label: 'Send the quote', subject: 'Your QuantiDawn quote',
      body: 'Hi {name},\n\nThank you for the opportunity to price your {project} project. Our quote is below.\n\nQuote: \nTurnaround: \n\nIf you would like to go ahead, or if anything in the scope needs to change, just reply to this email.\n\nKind regards,\nQuantiDawn' },
    { id: 'follow', label: 'Follow up on a quote', subject: 'Following up on your QuantiDawn quote',
      body: 'Hi {name},\n\nI wanted to check in on the quote we sent for {company}. Do you have any questions, or would you like us to adjust anything?\n\nHappy to help whenever you are ready.\n\nKind regards,\nQuantiDawn' }
  ];
  var templates = DEFAULT_TEMPLATES.map(function (tpl) { return Object.assign({}, tpl); });
  (function mergeSavedTemplates() {
    var saved = load(TPL_KEY);
    if (!saved) return;
    templates.forEach(function (tpl) { if (saved[tpl.id]) { tpl.subject = saved[tpl.id].subject; tpl.body = saved[tpl.id].body; } });
  })();
  function fillTemplate(text, row) {
    return text.replace(/\{name\}/g, firstName(row.name)).replace(/\{company\}/g, row.company).replace(/\{project\}/g, (TYPE_LABEL[row.project_type] || '').toLowerCase());
  }

  /* ======================================================================= state */
  var sb = null;
  var state = {
    rows: [], tab: 'overview', page: 1, selected: {}, currentId: null, aRange: '30',
    traffic: { range: '7', data: null, error: '', req: 0 },
    f: { q: '', market: '', type: '', interest: '', range: 'all', sort: 'new', status: 'active' }
  };
  var refreshTimer = null;

  /* ======================================================================= data layer */
  function findRow(id) { for (var i = 0; i < state.rows.length; i++) if (state.rows[i].id === id) return state.rows[i]; return null; }

  function loadRows() {
    if (DEMO) { if (!state.rows.length) state.rows = window.QUANTIDAWN_DEMO(); return Promise.resolve(); }
    var all = [], from = 0, size = 1000;
    function page() {
      return sb.from(CFG.table).select('*').order('created_at', { ascending: false }).range(from, from + size - 1).then(function (r) {
        if (r.error) throw r.error;
        all = all.concat(r.data);
        if (r.data.length === size && from < 20000) { from += size; return page(); }
        state.rows = all;
      });
    }
    return page();
  }

  function updateRow(id, patch) {
    if (DEMO) {
      var row = findRow(id);
      Object.assign(row, patch, { updated_at: new Date().toISOString() });
      return Promise.resolve(row);
    }
    return sb.from(CFG.table).update(patch).eq('id', id).select().single().then(function (r) {
      if (r.error) throw r.error;
      var i = state.rows.indexOf(findRow(id));
      if (i > -1) state.rows[i] = r.data;
      return r.data;
    });
  }

  function deleteRow(row) {
    function dropLocal() { state.rows = state.rows.filter(function (x) { return x.id !== row.id; }); }
    if (DEMO) { dropLocal(); return Promise.resolve(); }
    var files = (row.files && row.files.length) ? sb.storage.from(CFG.bucket).remove(row.files) : Promise.resolve({});
    return files.then(function (r) {
      if (r && r.error) throw r.error;
      return sb.from(CFG.table).delete().eq('id', row.id);
    }).then(function (r) { if (r.error) throw r.error; dropLocal(); });
  }

  function signedUrl(path) {
    return sb.storage.from(CFG.bucket).createSignedUrl(path, 120).then(function (r) {
      if (r.error) throw r.error;
      return r.data.signedUrl;
    });
  }

  // moving a lead out of "new" into a real conversation counts as the first reply
  function statusPatch(row, status) {
    var patch = { status: status };
    if (!row.first_response_at && row.status === 'new' && ['contacted', 'quoted', 'won'].indexOf(status) !== -1) {
      patch.first_response_at = new Date().toISOString();
    }
    return patch;
  }

  /* ======================================================================= derived data */
  function real(rows) { return rows.filter(function (r) { return r.status !== 'spam'; }); }
  function isStale(r) { return r.status === 'new' && (Date.now() - t(r)) / 3600000 > settings.target; }
  function followDue(r) { return !!r.follow_up_on && (r.status === 'contacted' || r.status === 'quoted') && r.follow_up_on <= todayStr(); }
  function replyHours(r) { return r.first_response_at ? (new Date(r.first_response_at) - new Date(r.created_at)) / 3600000 : null; }
  function byCurrency(rows) {
    var totals = {};
    rows.forEach(function (r) { if (r.quote_value != null) totals[r.quote_currency || 'USD'] = (totals[r.quote_currency || 'USD'] || 0) + Number(r.quote_value); });
    return Object.keys(totals).map(function (c) { return { cur: c, total: totals[c] }; }).sort(function (a, b) { return b.total - a.total; });
  }
  function countBy(rows, key) { var m = {}; rows.forEach(function (r) { m[r[key]] = (m[r[key]] || 0) + 1; }); return m; }

  function kpiSet(rows) {
    var r = real(rows), now = Date.now();
    var last30 = r.filter(function (x) { return now - t(x) < 30 * DAY; });
    var prev30 = r.filter(function (x) { var a = now - t(x); return a >= 30 * DAY && a < 60 * DAY; });
    var waiting = r.filter(function (x) { return x.status === 'new'; });
    var stale = waiting.filter(isStale);
    var times = r.filter(function (x) { return now - t(x) < 90 * DAY; }).map(replyHours).filter(function (x) { return x != null; });
    var won = r.filter(function (x) { return x.status === 'won'; });
    var lost = r.filter(function (x) { return x.status === 'lost'; });
    var quoted = r.filter(function (x) { return x.status === 'quoted'; });
    return { last30: last30, prev30: prev30, waiting: waiting, stale: stale, times: times, won: won, lost: lost, quoted: quoted };
  }

  /* ======================================================================= view: overview */
  function kpiCard(label, value, sub, alert) {
    return h('div', { class: 'kpi' + (alert ? ' kpi--alert' : '') },
      h('p', { class: 'kpi-label', text: label }),
      h('p', { class: 'kpi-value', text: value }),
      h('p', { class: 'kpi-sub' }, sub));
  }
  function deltaNode(now, before, label) {
    if (!before) return now ? 'No inquiries in the ' + label : 'Nothing yet';
    var d = Math.round(((now - before) / before) * 100);
    var cls = d > 0 ? 'delta delta--up' : d < 0 ? 'delta delta--down' : 'delta';
    return [h('span', { class: cls, text: (d > 0 ? '+' : '') + d + '%' }), ' vs the ' + label];
  }

  function renderOverview() {
    var k = kpiSet(state.rows);
    var avg = k.times.length ? sum(k.times) / k.times.length : null;
    var within = k.times.filter(function (x) { return x <= settings.target; }).length;
    var closed = k.won.length + k.lost.length;
    var quotedTot = byCurrency(k.quoted), wonTot = byCurrency(k.won);

    setKids($('kpis'), [
      kpiCard('Waiting for a reply', String(k.waiting.length),
        k.stale.length ? plural(k.stale.length, 'inquiry', 'inquiries') + ' past your ' + settings.target + ' h target' : (k.waiting.length ? 'All within target' : 'Inbox is clear'), k.stale.length > 0),
      kpiCard('Last 30 days', String(k.last30.length), deltaNode(k.last30.length, k.prev30.length, 'previous 30 days')),
      kpiCard('Average first reply', avg == null ? '—' : hoursFmt(avg),
        avg == null ? 'No replies recorded yet' : pct(within, k.times.length) + '% within ' + settings.target + ' h (last 90 days)'),
      kpiCard('Win rate', closed ? pct(k.won.length, closed) + '%' : '—', closed ? k.won.length + ' won, ' + k.lost.length + ' lost' : 'No closed quotes yet'),
      kpiCard('Open quotes', quotedTot.length ? money(quotedTot[0].total, quotedTot[0].cur) : String(k.quoted.length),
        plural(k.quoted.length, 'quote') + ' out' + (quotedTot.length > 1 ? ' · also ' + quotedTot.slice(1).map(function (x) { return money(x.total, x.cur); }).join(', ') : '')),
      kpiCard('Won value', wonTot.length ? money(wonTot[0].total, wonTot[0].cur) : '—',
        plural(k.won.length, 'project') + ' won' + (wonTot.length > 1 ? ' · also ' + wonTot.slice(1).map(function (x) { return money(x.total, x.cur); }).join(', ') : ''))
    ]);

    // needs attention
    // overdue first replies come before follow-ups (they are the more urgent job), oldest first within each
    var items = real(state.rows).filter(function (r) { return isStale(r) || followDue(r); })
      .sort(function (a, b) { return (isStale(b) - isStale(a)) || (t(a) - t(b)); }).slice(0, 8);
    if (!items.length) {
      setKids($('attention'), h('p', { class: 'empty' }, h('strong', { text: 'You are all caught up.' }), 'No inquiries are past your reply target and no follow-ups are due.'));
    } else {
      setKids($('attention'), h('div', { class: 'rows' }, items.map(function (r) {
        var why = isStale(r) ? 'Waiting ' + hoursFmt((Date.now() - t(r)) / 3600000) + ' for a first reply'
          : 'Follow-up due ' + (r.follow_up_on === todayStr() ? 'today' : fmtDate(r.follow_up_on + 'T00:00:00'));
        return h('div', { class: 'row-item' },
          h('div', { class: 'row-main' }, h('p', { class: 'row-title', text: r.name + ' · ' + r.company }), h('p', { class: 'row-meta', text: why })),
          h('button', { type: 'button', class: 'link-btn', 'aria-label': 'Open ' + r.name, onclick: function () { openDetail(r.id); } }, 'Open'));
      })));
    }

    setKids($('insights'), buildInsights(state.rows).map(function (n) { return h('li', null, n); }));

    // latest
    var latest = state.rows.filter(function (r) { return r.status !== 'spam'; }).slice(0, 6);
    if (!latest.length) {
      setKids($('latest'), emptyBlock('No inquiries yet', 'New requests from the quote form will appear here.'));
    } else {
      setKids($('latest'), h('div', { class: 'rows' }, latest.map(function (r) {
        return h('div', { class: 'row-item' },
          h('div', { class: 'row-main' },
            h('p', { class: 'row-title', text: r.name + ' · ' + r.company }),
            h('p', { class: 'row-meta', text: (TYPE_LABEL[r.project_type] || '') + ' · ' + (MARKET_LABEL[r.market] || r.market) + ' · ' + ago(r.created_at) })),
          pill(r.status),
          h('button', { type: 'button', class: 'link-btn', 'aria-label': 'Open ' + r.name, onclick: function () { openDetail(r.id); } }, 'Open'));
      })));
    }
  }

  function skeletons() {
    var kp = [];
    for (var i = 0; i < 6; i++) kp.push(h('div', { class: 'kpi kpi--skel', 'aria-hidden': 'true' },
      h('div', { class: 'skel skel-label' }), h('div', { class: 'skel skel-value' }), h('div', { class: 'skel skel-sub' })));
    var rows = [];
    for (var j = 0; j < 4; j++) rows.push(h('div', { class: 'skel skel-row', 'aria-hidden': 'true' }));
    setKids($('kpis'), kp); setKids($('latest'), rows);
    $('view-overview').setAttribute('aria-busy', 'true');
  }
  function emptyBlock(title, text, action) {
    return h('div', { class: 'empty' }, h('strong', { text: title }), text, action ? h('div', { class: 'row-actions' }, action) : null);
  }
  function pill(status) { return h('span', { class: 'pill pill--' + status, text: STATUS_LABEL[status] || status }); }

  /* ---- insights (plain rules over your own data, no guesses) ---- */
  function buildInsights(rows) {
    var r = real(rows);
    if (r.length < 5) return [h('span', null, 'Insights appear once you have at least ', h('strong', { text: '5 inquiries' }), '. You have ' + r.length + ' so far.')];
    var out = [], now = Date.now(), k = kpiSet(rows);

    if (k.stale.length) out.push(h('span', null, h('strong', { text: plural(k.stale.length, 'inquiry', 'inquiries') }), ' have waited longer than your ' + settings.target + ' h reply target. Reply to those first.'));
    else if (k.times.length) out.push(h('span', null, 'Average first reply is ', h('strong', { text: hoursFmt(sum(k.times) / k.times.length) }), ', with ' + pct(k.times.filter(function (x) { return x <= settings.target; }).length, k.times.length) + '% inside your ' + settings.target + ' h target.'));

    if (k.prev30.length >= 3) {
      var d = Math.round(((k.last30.length - k.prev30.length) / k.prev30.length) * 100);
      out.push(h('span', null, 'Inquiries are ', h('strong', { text: (d >= 0 ? 'up ' : 'down ') + Math.abs(d) + '%' }), ' on the previous 30 days (' + k.prev30.length + ' to ' + k.last30.length + ').'));
    }

    var recent = r.filter(function (x) { return now - t(x) < 90 * DAY; });
    if (recent.length >= 5) {
      var m = countBy(recent, 'market'), topM = Object.keys(m).sort(function (a, b) { return m[b] - m[a]; })[0];
      out.push(h('span', null, (MARKET_LABEL[topM] || topM) + ' sends the most inquiries: ', h('strong', { text: pct(m[topM], recent.length) + '%' }), ' of the last 90 days.'));
      var ty = countBy(recent, 'project_type'), types = Object.keys(ty).sort(function (a, b) { return ty[b] - ty[a]; });
      out.push(h('span', null, (TYPE_LABEL[types[0]] || types[0]) + ' is the most requested project type (', h('strong', { text: pct(ty[types[0]], recent.length) + '%' }), '), and ' + (TYPE_LABEL[types[types.length - 1]] || types[types.length - 1]).toLowerCase() + ' the least (' + pct(ty[types[types.length - 1]], recent.length) + '%).'));
      var wk = countBy(recent.map(function (x) { return { day: new Date(x.created_at).getDay() }; }), 'day'), topD = Object.keys(wk).sort(function (a, b) { return wk[b] - wk[a]; })[0];
      var dayName = WEEKDAYS.filter(function (w) { return String(w[0]) === topD; })[0][1];
      out.push(h('span', null, h('strong', { text: dayName }), ' is your busiest day (' + pct(wk[topD], recent.length) + '% of inquiries arrive then).'));
    }

    var ret = r.filter(function (x) { return x.interest === 'retainer'; });
    if (ret.length) {
      var rc = ret.filter(function (x) { return x.status === 'won' || x.status === 'lost'; }), sc = r.filter(function (x) { return x.interest === 'single' && (x.status === 'won' || x.status === 'lost'); });
      var line = [h('strong', { text: pct(ret.length, r.length) + '%' }), ' of inquiries ask about a monthly retainer.'];
      if (rc.length >= 5 && sc.length >= 5) line.push(' They win at ' + pct(rc.filter(function (x) { return x.status === 'won'; }).length, rc.length) + '%, against ' + pct(sc.filter(function (x) { return x.status === 'won'; }).length, sc.length) + '% for single projects.');
      out.push(h('span', null, line));
    }

    var withFiles = r.filter(function (x) { return x.files && x.files.length; });
    if (withFiles.length >= 5) out.push(h('span', null, h('strong', { text: pct(withFiles.length, r.length) + '%' }), ' of inquiries include plans. Those without plans usually need a follow-up question before you can quote.'));

    var closed = k.won.length + k.lost.length;
    if (closed >= 5) {
      var wonTot = byCurrency(k.won);
      out.push(h('span', null, 'You win ', h('strong', { text: pct(k.won.length, closed) + '%' }), ' of the quotes you close' + (wonTot.length ? ', averaging ' + money(wonTot[0].total / k.won.filter(function (x) { return (x.quote_currency || 'USD') === wonTot[0].cur && x.quote_value != null; }).length, wonTot[0].cur) + ' per won ' + wonTot[0].cur + ' quote.' : '.')));
    }

    var spam = rows.length - r.length;
    if (spam) out.push(h('span', null, plural(spam, 'inquiry', 'inquiries') + ' marked as spam (' + pct(spam, rows.length) + '% of everything received).'));
    return out.slice(0, 8);
  }

  /* ======================================================================= view: inquiries */
  function options(select, pairs, value) {
    setKids(select, pairs.map(function (p) { return h('option', { value: p[0], text: p[1] }); }));
    select.value = value;
  }

  function filteredRows() {
    var f = state.f, q = f.q.trim().toLowerCase(), now = Date.now();
    var list = state.rows.filter(function (r) {
      if (f.status === 'active' ? r.status === 'spam' : r.status !== f.status) return false;
      if (f.market && r.market !== f.market) return false;
      if (f.type && r.project_type !== f.type) return false;
      if (f.interest && r.interest !== f.interest) return false;
      if (f.range !== 'all' && now - t(r) > Number(f.range) * DAY) return false;
      if (q) {
        var hay = (r.name + ' ' + r.company + ' ' + r.email + ' ' + (r.phone || '') + ' ' + r.description + ' ' + (r.notes || '')).toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
    var sorts = {
      new: function (a, b) { return t(b) - t(a); },
      old: function (a, b) { return t(a) - t(b); },
      company: function (a, b) { return a.company.localeCompare(b.company); },
      value: function (a, b) { return (Number(b.quote_value) || 0) - (Number(a.quote_value) || 0); }
    };
    return list.sort(sorts[f.sort] || sorts.new);
  }

  function renderChips() {
    var counts = countBy(state.rows, 'status'), activeCount = state.rows.length - (counts.spam || 0);
    var defs = [['active', 'All', activeCount]].concat(STATUSES.map(function (s) { return [s, STATUS_LABEL[s], counts[s] || 0]; }));
    setKids($('status-chips'), defs.map(function (d) {
      return h('button', { type: 'button', class: 'chip', 'aria-pressed': String(state.f.status === d[0]), onclick: function () { state.f.status = d[0]; state.page = 1; renderInquiries(); } },
        d[1], h('span', { class: 'n', text: String(d[2]) }));
    }));
  }

  function renderInquiries() {
    renderChips();
    var list = filteredRows(), size = Number(settings.pageSize) || 25;
    var pages = Math.max(1, Math.ceil(list.length / size));
    if (state.page > pages) state.page = pages;
    var slice = list.slice((state.page - 1) * size, state.page * size);
    var filtered = state.f.q || state.f.market || state.f.type || state.f.interest || state.f.range !== 'all' || state.f.status !== 'active';

    $('result-line').textContent = plural(list.length, 'inquiry', 'inquiries') + (filtered ? ' match your filters' : '');
    var body = $('inq-body');
    if (!slice.length) {
      var clear = filtered ? h('button', { type: 'button', class: 'btn btn--secondary', onclick: resetFilters }, 'Clear filters') : null;
      setKids(body, h('tr', null, h('td', { colspan: '7' }, state.rows.length && filtered
        ? emptyBlock('No inquiries match these filters', 'Try a different search or clear the filters.', clear)
        : emptyBlock('No inquiries yet', 'New requests from the quote form appear here as soon as they are sent.'))));
    } else {
      setKids(body, slice.map(rowEl));
    }
    $('check-all').checked = slice.length > 0 && slice.every(function (r) { return state.selected[r.id]; });
    $('check-all').onchange = function (e) { slice.forEach(function (r) { if (e.target.checked) state.selected[r.id] = true; else delete state.selected[r.id]; }); renderInquiries(); };
    renderBulk();

    setKids($('pager'), pages > 1 ? [
      h('button', { type: 'button', class: 'btn btn--secondary', disabled: state.page <= 1, onclick: function () { state.page--; renderInquiries(); window.scrollTo(0, 0); } }, 'Previous'),
      h('span', { text: 'Page ' + state.page + ' of ' + pages }),
      h('button', { type: 'button', class: 'btn btn--secondary', disabled: state.page >= pages, onclick: function () { state.page++; renderInquiries(); window.scrollTo(0, 0); } }, 'Next')
    ] : []);
  }

  function rowEl(r) {
    var cb = h('input', { type: 'checkbox', 'aria-label': 'Select ' + r.name });
    cb.checked = !!state.selected[r.id];
    cb.addEventListener('change', function () { if (cb.checked) state.selected[r.id] = true; else delete state.selected[r.id]; renderBulk(); });
    var flag = isStale(r) ? h('span', { class: 'pill pill--new', text: 'Overdue' }) : null;
    return h('tr', { dataset: { id: r.id } },
      h('td', { class: 'col-check' }, h('label', null, cb)),
      h('td', { class: 'cell-main' },
        h('button', { type: 'button', class: 'row-link', onclick: function () { openDetail(r.id); } },
          h('span', { class: 'who', text: r.name }), h('span', { class: 'co', text: r.company }), h('span', { class: 'em', text: r.email }))),
      h('td', { 'data-label': 'Market', text: MARKET_LABEL[r.market] || r.market }),
      h('td', { 'data-label': 'Project' }, TYPE_LABEL[r.project_type] || r.project_type, h('span', { class: 'dim', text: ' · ' + (r.interest === 'retainer' ? 'Retainer' : 'Single') })),
      h('td', { 'data-label': 'Received', title: fmtDateTime(r.created_at), text: ago(r.created_at) }),
      h('td', { 'data-label': 'Status' }, pill(r.status), flag ? [' ', flag] : null),
      h('td', { 'data-label': 'Quote' }, r.quote_value != null ? h('span', { class: 'money', text: money(r.quote_value, r.quote_currency) }) : h('span', { class: 'dim', text: '—' })));
  }

  function renderBulk() {
    var ids = Object.keys(state.selected), bar = $('bulk');
    bar.hidden = !ids.length;
    $('bulk-count').textContent = ids.length + ' selected';
  }

  function resetFilters() {
    state.f = { q: '', market: '', type: '', interest: '', range: 'all', sort: 'new', status: 'active' };
    $('f-search').value = '';
    ['market', 'type', 'interest', 'range', 'sort'].forEach(function (k) { $('f-' + k).value = state.f[k]; });
    state.page = 1;
    renderInquiries();
  }

  function initInquiryControls() {
    var any = function (label, map) { return [['', label]].concat(Object.keys(map).map(function (k) { return [k, map[k]]; })); };
    options($('f-market'), any('All markets', MARKET_LABEL), '');
    options($('f-type'), any('All types', TYPE_LABEL), '');
    options($('f-interest'), any('Any', INTEREST_LABEL), '');
    options($('f-range'), [['all', 'Any time'], ['7', 'Last 7 days'], ['30', 'Last 30 days'], ['90', 'Last 90 days'], ['365', 'Last 12 months']], 'all');
    options($('f-sort'), [['new', 'Newest first'], ['old', 'Oldest first'], ['company', 'Company A to Z'], ['value', 'Highest quote']], 'new');
    options($('bulk-status'), [['', 'Set status…']].concat(STATUSES.map(function (s) { return [s, STATUS_LABEL[s]]; })), '');

    var typing = null;
    $('f-search').addEventListener('input', function (e) { clearTimeout(typing); typing = setTimeout(function () { state.f.q = e.target.value; state.page = 1; renderInquiries(); }, 150); });
    [['market', 'f-market'], ['type', 'f-type'], ['interest', 'f-interest'], ['range', 'f-range'], ['sort', 'f-sort']].forEach(function (p) {
      $(p[1]).addEventListener('change', function (e) { state.f[p[0]] = e.target.value; state.page = 1; renderInquiries(); });
    });

    $('bulk-clear').addEventListener('click', function () { state.selected = {}; renderInquiries(); });
    $('bulk-export').addEventListener('click', function () {
      var ids = state.selected;
      exportCsv(state.rows.filter(function (r) { return ids[r.id]; }), 'selected');
    });
    $('bulk-apply').addEventListener('click', function () {
      var status = $('bulk-status').value, ids = Object.keys(state.selected);
      if (!status) { toast('Choose a status first.', true); return; }
      Promise.all(ids.map(function (id) { return updateRow(id, statusPatch(findRow(id), status)); })).then(function () {
        toast(plural(ids.length, 'inquiry', 'inquiries') + ' set to ' + STATUS_LABEL[status] + '.');
        state.selected = {}; $('bulk-status').value = ''; renderAll();
      }).catch(function () { toast('Could not update some inquiries. Please try again.', true); });
    });
  }

  /* ======================================================================= view: analytics */
  function rangeWindow(range) {
    var now = Date.now();
    if (range === 'all') return { from: 0, prevFrom: null, days: null };
    var d = Number(range);
    return { from: now - d * DAY, prevFrom: now - 2 * d * DAY, days: d };
  }

  function niceMax(m) { return m <= 4 ? 4 : m <= 20 ? Math.ceil(m / 4) * 4 : Math.ceil(m / 10) * 10; }

  function bucketStart(d, mode) {
    var x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    if (mode === 'week') x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
    if (mode === 'month') x.setDate(1);
    return x;
  }
  function bucketKey(d, mode) { return mode === 'month' ? d.getFullYear() + '-' + pad(d.getMonth() + 1) : ymd(d); }
  function bucketLabel(d, mode) {
    return mode === 'month' ? new Intl.DateTimeFormat(undefined, { month: 'short', year: '2-digit' }).format(d) : new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' }).format(d);
  }

  function timeSeries(rows, range) {
    var now = new Date(), days = range === 'all' ? null : Number(range);
    if (days == null) {
      var oldest = rows.length ? Math.min.apply(null, rows.map(t)) : now.getTime();
      days = Math.max(1, Math.ceil((now.getTime() - oldest) / DAY) + 1);
    }
    var mode = days <= 31 ? 'day' : days <= 140 ? 'week' : 'month';
    var start = bucketStart(new Date(now.getTime() - (days - 1) * DAY), mode);
    var buckets = [], map = {};
    for (var d = new Date(start); d <= now; mode === 'day' ? d.setDate(d.getDate() + 1) : mode === 'week' ? d.setDate(d.getDate() + 7) : d.setMonth(d.getMonth() + 1)) {
      var b = { date: new Date(d), value: 0, label: bucketLabel(d, mode) };
      buckets.push(b); map[bucketKey(d, mode)] = b;
    }
    rows.forEach(function (r) { var k = bucketKey(bucketStart(new Date(r.created_at), mode), mode); if (map[k]) map[k].value++; });
    return { mode: mode, buckets: buckets };
  }

  function barChart(series, aria, width) {
    var W = width || 720, H = 220, L = 34, B = 26, T = 10, R = 6, n = series.buckets.length;
    var max = niceMax(Math.max.apply(null, series.buckets.map(function (b) { return b.value; }).concat([1])));
    var plotH = H - B - T, step = (W - L - R) / n, bw = Math.max(2, Math.min(28, step * 0.68));
    var root = svg('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'svg-chart', role: 'img', 'aria-label': aria });
    [0, max / 2, max].forEach(function (v) {
      var y = T + plotH - (v / max) * plotH;
      root.appendChild(svg('line', { x1: L, x2: W - R, y1: y, y2: y, class: v === 0 ? 'axis' : 'grid' }));
      var tx = svg('text', { x: L - 6, y: y + 4, 'text-anchor': 'end' }); tx.textContent = String(v); root.appendChild(tx);
    });
    var every = Math.ceil(n / Math.max(3, Math.floor((W - L) / 64)));
    series.buckets.forEach(function (b, i) {
      var bh = (b.value / max) * plotH, x = L + i * step + (step - bw) / 2;
      var rect = svg('rect', { x: x, y: T + plotH - bh, width: bw, height: Math.max(bh, b.value ? 2 : 0), rx: 2, class: 'bar' });
      var title = svg('title'); title.textContent = b.label + ': ' + plural(b.value, series.noun || 'inquiry', series.nouns || 'inquiries'); rect.appendChild(title);
      root.appendChild(rect);
      if (i % every === 0) { var lx = svg('text', { x: x + bw / 2, y: H - 8, 'text-anchor': 'middle' }); lx.textContent = b.label; root.appendChild(lx); }
    });
    return root;
  }

  function hbars(items, fmt) {
    var max = Math.max.apply(null, items.map(function (i) { return i.value; }).concat([1]));
    return h('div', { class: 'hbars' }, items.map(function (i) {
      return h('div', { class: 'hbar' },
        h('span', { class: 'lab', text: i.label }),
        h('span', { class: 'track', 'aria-hidden': 'true' }, h('span', { class: 'fill', style: 'width:' + (i.value / max) * 100 + '%' })),
        h('span', { class: 'val', text: fmt ? fmt(i) : String(i.value) }));
    }));
  }

  function legendList(items, total) {
    return h('ul', { class: 'legend' }, items.map(function (i, idx) {
      return h('li', null, h('span', { class: 'sw' + (i.color ? '' : ' c' + (idx + 1)), style: i.color ? 'background:' + i.color : null, 'aria-hidden': 'true' }), i.label,
        h('span', { class: 'v', text: i.value + (total ? ' (' + pct(i.value, total) + '%)' : '') }));
    }));
  }

  function donut(items, unit) {
    var total = sum(items.map(function (i) { return i.value; })), R = 66, C = 2 * Math.PI * R, acc = 0;
    var colors = ['#012852', '#FD6101', '#3F6A97', '#8AA9C7'];
    var root = svg('svg', { viewBox: '0 0 180 180', role: 'img', 'aria-label': items.map(function (i) { return i.label + ' ' + pct(i.value, total) + '%'; }).join(', ') });
    root.appendChild(svg('circle', { cx: 90, cy: 90, r: R, fill: 'none', stroke: '#EEF1F5', 'stroke-width': 24 }));
    if (total) items.forEach(function (i, idx) {
      var len = (i.value / total) * C;
      root.appendChild(svg('circle', { cx: 90, cy: 90, r: R, fill: 'none', stroke: colors[idx % colors.length], 'stroke-width': 24, 'stroke-dasharray': len + ' ' + (C - len), 'stroke-dashoffset': -acc, transform: 'rotate(-90 90 90)' }));
      acc += len;
    });
    var big = svg('text', { x: 90, y: 92, 'text-anchor': 'middle', style: 'font-size:26px;font-weight:700;fill:#012852;font-family:Poppins,sans-serif' }); big.textContent = String(total); root.appendChild(big);
    var small = svg('text', { x: 90, y: 112, 'text-anchor': 'middle' }); small.textContent = unit || 'inquiries'; root.appendChild(small);
    return h('div', { class: 'donut-wrap' }, root, legendList(items, total));
  }

  function stacked(items, total) {
    return h('div', null,
      h('div', { class: 'stack', role: 'img', 'aria-label': items.map(function (i) { return i.label + ' ' + i.value; }).join(', ') },
        items.filter(function (i) { return i.value; }).map(function (i) { return h('span', { class: i.color ? '' : 'c' + (items.indexOf(i) + 1), style: 'width:' + pct(i.value, total) + '%' + (i.color ? ';background:' + i.color : '') }); })),
      legendList(items, total));
  }

  function chartPanel(title, sub, body, wide) {
    return h('section', { class: 'panel chart' + (wide ? ' chart--wide' : '') },
      h('h3', { text: title }), sub ? h('p', { class: 'sub', text: sub }) : null, body);
  }

  function renderAnalytics() {
    var win = rangeWindow(state.aRange);
    var inRange = state.rows.filter(function (r) { return t(r) >= win.from; });
    var rr = real(inRange), prev = win.prevFrom ? real(state.rows).filter(function (r) { return t(r) >= win.prevFrom && t(r) < win.from; }) : null;
    var hasData = rr.length > 0;

    var times = rr.map(replyHours).filter(function (x) { return x != null; });
    var won = rr.filter(function (r) { return r.status === 'won'; }), lost = rr.filter(function (r) { return r.status === 'lost'; });
    var replied = rr.filter(function (r) { return r.status !== 'new'; });
    var wonTot = byCurrency(won);
    setKids($('a-summary'), [
      kpiCard('Inquiries', String(rr.length), prev ? deltaNode(rr.length, prev.length, 'previous period') : (inRange.length - rr.length ? plural(inRange.length - rr.length, 'spam message') + ' excluded' : 'All time')),
      kpiCard('Replied to', rr.length ? pct(replied.length, rr.length) + '%' : '—', times.length ? 'Average first reply ' + hoursFmt(sum(times) / times.length) : 'No replies recorded'),
      kpiCard('Win rate', won.length + lost.length ? pct(won.length, won.length + lost.length) + '%' : '—', won.length + ' won, ' + lost.length + ' lost'),
      kpiCard('Won value', wonTot.length ? money(wonTot[0].total, wonTot[0].cur) : '—', wonTot.length > 1 ? 'also ' + wonTot.slice(1).map(function (x) { return money(x.total, x.cur); }).join(', ') : plural(won.length, 'project') + ' won')
    ]);

    var box = $('a-charts');
    if (!hasData) { setKids(box, h('div', { class: 'panel chart--wide' }, emptyBlock('No inquiries in this period', 'Try a longer period, or check back once new inquiries arrive.'))); return; }

    var series = timeSeries(rr, state.aRange);
    var chartWidth = Math.min(1040, Math.max(280, box.clientWidth - 50));
    var mk = countBy(rr, 'market'), ty = countBy(rr, 'project_type'), it = countBy(rr, 'interest'), st = countBy(inRange, 'status');
    var wd = countBy(rr.map(function (r) { return { d: new Date(r.created_at).getDay() }; }), 'd');
    var buckets = [['Under 1 hour', 0, 1], ['1 to 4 hours', 1, 4], ['4 to 24 hours', 4, 24], ['Over 24 hours', 24, Infinity]];
    var tb = buckets.map(function (b) { return { label: b[0], value: times.filter(function (x) { return x >= b[1] && x < b[2]; }).length }; });
    tb.push({ label: 'Not replied yet', value: rr.filter(function (r) { return r.first_response_at == null && r.status === 'new'; }).length });
    var typeWin = Object.keys(TYPE_LABEL).map(function (k) {
      var w = won.filter(function (r) { return r.project_type === k; }).length, l = lost.filter(function (r) { return r.project_type === k; }).length;
      return { label: TYPE_LABEL[k], value: w + l ? Math.round((w / (w + l)) * 100) : 0, w: w, n: w + l };
    });

    setKids(box, [
      chartPanel('Inquiries over time', 'Per ' + series.mode + '. Spam is not counted.', barChart(series, 'Bar chart of inquiries per ' + series.mode + ': ' + series.buckets.map(function (b) { return b.label + ' ' + b.value; }).join(', '), chartWidth), true),
      chartPanel('Pipeline by status', 'Where every inquiry in this period stands right now.', stacked(STATUSES.map(function (s) { return { label: STATUS_LABEL[s], value: st[s] || 0, color: STATUS_COLOR[s] }; }), inRange.length)),
      chartPanel('By market', null, hbars(Object.keys(MARKET_LABEL).map(function (k) { return { label: MARKET_LABEL[k], value: mk[k] || 0 }; }), function (i) { return i.value + ' · ' + pct(i.value, rr.length) + '%'; })),
      chartPanel('By project type', null, hbars(Object.keys(TYPE_LABEL).map(function (k) { return { label: TYPE_LABEL[k], value: ty[k] || 0 }; }), function (i) { return i.value + ' · ' + pct(i.value, rr.length) + '%'; })),
      chartPanel('Single project or retainer', null, donut(Object.keys(INTEREST_LABEL).map(function (k) { return { label: INTEREST_LABEL[k], value: it[k] || 0 }; }))),
      chartPanel('Busiest days', 'Based on when the inquiry was sent, in your local time.', hbars(WEEKDAYS.map(function (w) { return { label: w[1], value: wd[w[0]] || 0 }; }), function (i) { return String(i.value); })),
      chartPanel('Time to first reply', 'How long inquiries waited before you replied.', hbars(tb, function (i) { return String(i.value); })),
      chartPanel('Win rate by project type', 'Won as a share of won plus lost.', hbars(typeWin, function (i) { return i.n ? i.value + '% · ' + i.w + '/' + i.n : 'no closed quotes'; }))
    ]);
  }

  /* ======================================================================= view: traffic */
  var regionNames = null;
  function countryName(code) {
    try { regionNames = regionNames || new Intl.DisplayNames(undefined, { type: 'region' }); return regionNames.of(code) || code; } catch (e) { return code; }
  }
  function fmtDuration(ms) {
    var sec = Math.round(ms / 1000);
    return sec < 60 ? sec + ' s' : Math.floor(sec / 60) + ' min ' + (sec % 60) + ' s';
  }
  function trend(now, before) {
    if (!before) return now ? 'Nothing to compare with yet' : 'Nothing yet';
    var d = Math.round(((now - before) / before) * 100);
    return [h('span', { class: d > 0 ? 'delta delta--up' : d < 0 ? 'delta delta--down' : 'delta', text: (d > 0 ? '+' : '') + d + '%' }), ' vs the previous period'];
  }
  function pathLabel(p) { return p === '/' || p === '/index.html' ? 'Home' : p.replace(/^\//, '').replace(/\.html$/, '').replace(/-/g, ' '); }

  function loadTraffic() {
    var tr = state.traffic, days = Number(tr.range), id = ++tr.req, tz = 'UTC';
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch (e) {}
    var p = DEMO ? Promise.resolve(window.QUANTIDAWN_TRAFFIC(days))
      : sb.rpc('traffic_summary', { p_days: days, p_tz: tz }).then(function (r) { if (r.error) throw r.error; return r.data; });
    return p.then(function (d) { if (id === tr.req) { tr.data = d; tr.error = ''; } })
      .catch(function (e) { if (id === tr.req) { tr.data = null; tr.error = e && (e.code === 'PGRST202' || /traffic_summary/.test(e.message || '')) ? 'setup' : 'load'; } })
      .then(function () { if (id === tr.req && state.tab === 'traffic') renderTraffic(); });
  }

  function trafficSeries(d) {
    var byKey = {}, hourly = d.unit === 'hour', now = new Date(), buckets = [], i;
    d.series.forEach(function (r) { byKey[r.t.slice(0, hourly ? 13 : 10)] = r.visits; });
    var fmtHour = new Intl.DateTimeFormat(undefined, { hour: 'numeric' });
    if (hourly) {
      for (i = 23; i >= 0; i--) {
        var hd = new Date(now.getTime() - i * 3600000);
        buckets.push({ label: fmtHour.format(hd), value: byKey[ymd(hd) + 'T' + pad(hd.getHours())] || 0 });
      }
    } else {
      for (i = d.days - 1; i >= 0; i--) {
        var dd = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
        buckets.push({ label: bucketLabel(dd, 'day'), value: byKey[ymd(dd)] || 0 });
      }
    }
    return { mode: hourly ? 'hour' : 'day', noun: 'visit', nouns: 'visits', buckets: buckets };
  }

  function listOrEmpty(items, fmt) {
    return items.length ? hbars(items, fmt) : h('p', { class: 'empty' }, 'Nothing recorded in this period yet.');
  }

  function renderTraffic() {
    var tr = state.traffic, d = tr.data, sumBox = $('t-summary'), box = $('t-charts');
    if (tr.error) {
      setKids(sumBox, []);
      setKids(box, h('div', { class: 'panel chart--wide' }, tr.error === 'setup'
        ? emptyBlock('Traffic tracking is not set up yet', 'Run backend/analytics.sql in the Supabase SQL editor, then reload this page.')
        : emptyBlock('Could not load traffic', 'Check your connection, then use Refresh.')));
      return;
    }
    if (!d) {
      var kp = [];
      for (var i = 0; i < 6; i++) kp.push(h('div', { class: 'kpi kpi--skel', 'aria-hidden': 'true' }, h('div', { class: 'skel skel-label' }), h('div', { class: 'skel skel-value' }), h('div', { class: 'skel skel-sub' })));
      setKids(sumBox, kp); setKids(box, []);
      return;
    }
    var tot = d.totals, prev = d.prev, visits = tot.visits;
    var bounce = visits ? Math.round((tot.bounces / visits) * 100) : null;
    var prevBounce = prev.visits ? Math.round((prev.bounces / prev.visits) * 100) : null;
    setKids(sumBox, [
      kpiCard('Visits', String(visits), trend(visits, prev.visits)),
      kpiCard('Page views', String(tot.views), trend(tot.views, prev.views)),
      kpiCard('Bounce rate', bounce == null ? '—' : bounce + '%', bounce == null ? 'No visits yet' : (prevBounce == null ? tot.bounces + ' of ' + visits + ' left after one page' : tot.bounces + ' of ' + visits + ' visits. Previous period ' + prevBounce + '%')),
      kpiCard('Time on site', tot.avg_ms ? fmtDuration(tot.avg_ms) : '—', 'Average time per visit'),
      kpiCard('Clicks', String(tot.clicks), visits ? (tot.clicks / visits).toFixed(1) + ' per visit' : 'No visits yet'),
      kpiCard('Quote requests', String(tot.conversions), visits ? pct(tot.converted_visits, visits) + '% of visits' : 'No visits yet')
    ]);

    if (!tot.views) {
      setKids(box, h('div', { class: 'panel chart--wide' }, emptyBlock('No visits recorded in this period', 'Page views appear here within a minute of someone opening the site. Visits from browsers that send Do Not Track, and your own if you have excluded this browser below, are not counted.')));
      return;
    }
    var series = trafficSeries(d), width = Math.min(1040, Math.max(280, box.clientWidth - 50));
    var share = function (i) { return i.value + ' · ' + pct(i.value, visits) + '%'; };
    setKids(box, [
      chartPanel('Visits over time', 'Per ' + series.mode + '. ' + plural(tot.views, 'page view') + ' in total.', barChart(series, 'Bar chart of visits per ' + series.mode + ': ' + series.buckets.map(function (b) { return b.label + ' ' + b.value; }).join(', '), width), true),
      chartPanel('Top pages', 'Page views, average time on the page and how far people scroll.', listOrEmpty(d.pages.map(function (p) { return { label: pathLabel(p.path), value: p.views, avg: p.avg_ms, scroll: p.scroll }; }),
        function (i) { return i.value + (i.avg ? ' · ' + fmtDuration(i.avg) : '') + (i.scroll != null ? ' · ' + i.scroll + '%' : ''); })),
      chartPanel('Countries', 'Where visits came from.', listOrEmpty(d.countries.map(function (c) { return { label: countryName(c.country), value: c.visits }; }), share)),
      chartPanel('Regions', 'State or province, where known.', listOrEmpty(d.regions.filter(function (r) { return /[A-Za-z]/.test(r.region); }).map(function (r) { return { label: r.region + ', ' + countryName(r.country), value: r.visits }; }), share)),
      chartPanel('Traffic sources', 'Direct, search, social and campaign links (utm_source).', listOrEmpty(d.sources.map(function (r) { return { label: r.source, value: r.visits }; }), share)),
      chartPanel('Devices', null, donut(d.devices.map(function (x) { return { label: x.device.charAt(0).toUpperCase() + x.device.slice(1), value: x.visits }; }), 'visits')),
      chartPanel('Top clicks', 'Links and buttons people pressed.', listOrEmpty(d.clicks.map(function (c) { return { label: c.label, value: c.clicks }; })))
    ]);
  }

  function ignoreState() { try { return localStorage.getItem('qd_ignore') === '1'; } catch (e) { return false; } }
  function paintIgnore() {
    var on = ignoreState();
    $('t-ignore').textContent = on ? 'Count my visits again' : 'Do not count my visits';
    $('t-ignore-note').textContent = on ? 'This browser is excluded from the numbers above.' : 'Stops your own browsing of the site from inflating the numbers.';
  }
  function initTraffic() {
    options($('t-range'), [['1', 'Last 24 hours'], ['7', 'Last 7 days'], ['30', 'Last 30 days'], ['90', 'Last 90 days']], state.traffic.range);
    $('t-range').addEventListener('change', function (e) { state.traffic.range = e.target.value; state.traffic.data = null; state.traffic.error = ''; renderTraffic(); loadTraffic(); });
    $('t-ignore').addEventListener('click', function () {
      try { if (ignoreState()) localStorage.removeItem('qd_ignore'); else localStorage.setItem('qd_ignore', '1'); } catch (e) { toast('This browser blocks the setting.', true); }
      paintIgnore();
    });
    paintIgnore();
  }

  /* ======================================================================= view: tools */
  function currentTemplate() { return templates.filter(function (x) { return x.id === $('tpl-select').value; })[0] || templates[0]; }

  function initTools() {
    options($('tpl-select'), templates.map(function (x) { return [x.id, x.label]; }), templates[0].id);
    var loadTpl = function () { var x = currentTemplate(); $('tpl-subject').value = x.subject; $('tpl-body').value = x.body; };
    loadTpl();
    $('tpl-select').addEventListener('change', loadTpl);
    $('tpl-save').addEventListener('click', function () {
      var x = currentTemplate(); x.subject = $('tpl-subject').value; x.body = $('tpl-body').value;
      var saved = {}; templates.forEach(function (tp) { saved[tp.id] = { subject: tp.subject, body: tp.body }; });
      store(TPL_KEY, saved); fillDetailTemplates(); toast('Template saved in this browser.');
    });
    $('tpl-reset').addEventListener('click', function () {
      var d = DEFAULT_TEMPLATES.filter(function (x) { return x.id === currentTemplate().id; })[0];
      var x = currentTemplate(); x.subject = d.subject; x.body = d.body; loadTpl();
      var saved = {}; templates.forEach(function (tp) { saved[tp.id] = { subject: tp.subject, body: tp.body }; });
      store(TPL_KEY, saved); toast('Template reset to the default.');
    });
    $('tpl-copy').addEventListener('click', function () { copyText($('tpl-body').value, 'Message copied.'); });

    $('export-all-csv').addEventListener('click', function () { exportCsv(state.rows, 'all'); });
    $('export-all-json').addEventListener('click', function () {
      download('quantidawn-backup-' + todayStr() + '.json', JSON.stringify(state.rows, null, 2), 'application/json');
      toast('Backup downloaded.');
    });

    options($('set-currency'), CURRENCIES.map(function (c) { return [c, c]; }), settings.currency);
    options($('set-pagesize'), [['10', '10'], ['25', '25'], ['50', '50'], ['100', '100']], String(settings.pageSize));
    $('set-target').value = settings.target;
    $('set-save').addEventListener('click', function () {
      var target = Math.round(Number($('set-target').value));
      if (!(target >= 1 && target <= 168)) { toast('Enter a reply target between 1 and 168 hours.', true); return; }
      settings = { target: target, currency: $('set-currency').value, pageSize: Number($('set-pagesize').value) };
      store(SETTINGS_KEY, settings); state.page = 1; renderAll(); toast('Settings saved in this browser.');
    });
  }

  /* ======================================================================= export */
  function download(name, text, type) {
    var blob = new Blob([text], { type: type + ';charset=utf-8' });
    var a = h('a', { href: URL.createObjectURL(blob), download: name });
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }
  function csvCell(v) {
    var s = v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;                    // stop spreadsheet formula injection
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function exportCsv(rows, label) {
    var cols = [['Received', function (r) { return r.created_at; }], ['Name', function (r) { return r.name; }], ['Company', function (r) { return r.company; }],
      ['Email', function (r) { return r.email; }], ['Phone', function (r) { return r.phone; }], ['Market', function (r) { return MARKET_LABEL[r.market] || r.market; }],
      ['Project type', function (r) { return TYPE_LABEL[r.project_type] || r.project_type; }], ['Interested in', function (r) { return INTEREST_LABEL[r.interest] || r.interest; }], ['Timing', function (r) { return TIMING_LABEL[r.timing] || ''; }],
      ['Status', function (r) { return STATUS_LABEL[r.status] || r.status; }], ['Quote value', function (r) { return r.quote_value; }], ['Currency', function (r) { return r.quote_currency; }],
      ['Follow up on', function (r) { return r.follow_up_on; }], ['First reply', function (r) { return r.first_response_at; }], ['Files', function (r) { return (r.files || []).length; }],
      ['Description', function (r) { return r.description; }], ['Notes', function (r) { return r.notes; }]];
    var lines = [cols.map(function (c) { return csvCell(c[0]); }).join(',')].concat(rows.map(function (r) { return cols.map(function (c) { return csvCell(c[1](r)); }).join(','); }));
    download('quantidawn-inquiries-' + label + '-' + todayStr() + '.csv', '﻿' + lines.join('\r\n'), 'text/csv');
    toast('Exported ' + plural(rows.length, 'inquiry', 'inquiries') + '.');
  }
  function copyText(text, message) {
    var done = function () { toast(message); };
    if (navigator.clipboard && window.isSecureContext) { navigator.clipboard.writeText(text).then(done, function () { toast('Could not copy. Select and copy manually.', true); }); return; }
    var ta = h('textarea', { 'aria-hidden': 'true', style: 'position:fixed;left:-9999px' }); ta.value = text;
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); done(); } catch (e) { toast('Could not copy. Select and copy manually.', true); }
    document.body.removeChild(ta);
  }

  /* ======================================================================= detail panel */
  var detail = null;

  function fillDetailTemplates() {
    if (!$('d-template')) return;
    var keep = $('d-template').value;
    options($('d-template'), templates.map(function (x) { return [x.id, x.label]; }), keep || templates[0].id);
    if (state.currentId) updateReplyLink(findRow(state.currentId));
  }
  function updateReplyLink(row) {
    if (!row) return;
    var tpl = templates.filter(function (x) { return x.id === $('d-template').value; })[0] || templates[0];
    $('d-reply').href = 'mailto:' + encodeURIComponent(row.email).replace(/%40/g, '@') + '?subject=' + encodeURIComponent(fillTemplate(tpl.subject, row)) + '&body=' + encodeURIComponent(fillTemplate(tpl.body, row));
  }

  function fact(label, value) { return [h('dt', { text: label }), h('dd', null, value)]; }

  function renderDetail() {
    var r = findRow(state.currentId); if (!r) return;
    $('detail-title').textContent = r.name;
    $('detail-sub').textContent = r.company + ' · received ' + ago(r.created_at);
    updateReplyLink(r);
    var tel = $('d-call'); tel.hidden = !r.phone; if (r.phone) tel.href = 'tel:' + r.phone.replace(/[^\d+]/g, '');

    var rh = replyHours(r);
    setKids($('d-facts'), [
      fact('Status', pill(r.status)),
      fact('Received', fmtDateTime(r.created_at)),
      fact('Email', h('a', { href: 'mailto:' + r.email, text: r.email })),
      fact('Phone', r.phone ? h('a', { href: 'tel:' + r.phone.replace(/[^\d+]/g, ''), text: r.phone }) : '—'),
      fact('Market', MARKET_LABEL[r.market] || r.market),
      fact('Project type', TYPE_LABEL[r.project_type] || r.project_type),
      fact('Interested in', INTEREST_LABEL[r.interest] || r.interest),
      fact('Timing', TIMING_LABEL[r.timing] || '—'),
      fact('First reply', r.first_response_at ? fmtDateTime(r.first_response_at) + ' (' + hoursFmt(rh) + ' after)' : 'Not yet')
    ]);
    $('d-desc').textContent = r.description;

    var files = r.files || [];
    setKids($('d-files'), files.length ? files.map(function (p) {
      return h('li', null, h('span', { class: 'fname', text: fileLabel(p) }),
        DEMO ? h('span', { class: 'hint', text: 'Preview only' })
          : h('button', { type: 'button', class: 'btn btn--secondary', onclick: function () { openFile(p); } }, 'Open'));
    }) : h('li', null, h('span', { class: 'hint', text: 'No plans were uploaded with this inquiry.' })));

    options($('d-status'), STATUSES.map(function (s) { return [s, STATUS_LABEL[s]]; }), r.status);
    $('d-follow').value = r.follow_up_on || '';
    $('d-value').value = r.quote_value != null ? r.quote_value : '';
    options($('d-currency'), CURRENCIES.map(function (c) { return [c, c]; }), r.quote_currency || settings.currency);
    $('d-notes').value = r.notes || '';
    $('d-error').hidden = true;
    $('d-contacted').hidden = r.status !== 'new';
    $('d-spam').hidden = r.status === 'spam';
  }

  function openFile(path) {
    var w = window.open('', '_blank');                                  // opened synchronously so popup blockers allow it
    signedUrl(path).then(function (url) { if (w) { w.opener = null; w.location = url; } }).catch(function () { if (w) w.close(); toast('Could not open that file.', true); });
  }

  function openDetail(id) {
    state.currentId = id;
    fillDetailTemplates();
    resetDelete();
    renderDetail();
    document.body.style.overflow = 'hidden';
    if (!detail.open) detail.showModal();
    $('detail').querySelector('.detail-body').scrollTop = 0;
  }
  function closeDetail() { if (detail.open) detail.close(); }
  function resetDelete() {
    setKids($('d-del-row'), h('button', { type: 'button', class: 'btn btn--secondary', id: 'd-delete', onclick: askDelete }, 'Delete inquiry'));
  }
  function askDelete() {
    setKids($('d-del-row'), [
      h('button', { type: 'button', class: 'btn btn--danger', onclick: confirmDelete }, 'Yes, delete permanently'),
      h('button', { type: 'button', class: 'btn btn--secondary', onclick: resetDelete }, 'Cancel')]);
    $('d-del-row').querySelector('button').focus();
  }
  function confirmDelete() {
    var r = findRow(state.currentId);
    deleteRow(r).then(function () { closeDetail(); state.selected = {}; renderAll(); toast('Inquiry deleted.'); })
      .catch(function () { toast('Could not delete. Please try again.', true); });
  }

  function saveDetail(extra) {
    var r = findRow(state.currentId), err = $('d-error');
    var raw = $('d-value').value.trim(), value = raw === '' ? null : Number(raw);
    if (value != null && !(value >= 0)) { err.textContent = 'Enter a quote value of zero or more.'; err.hidden = false; $('d-value').focus(); return Promise.resolve(); }
    err.hidden = true;
    var newStatus = (extra && extra.status) || $('d-status').value;
    var patch = Object.assign(newStatus !== r.status ? statusPatch(r, newStatus) : {}, {
      follow_up_on: $('d-follow').value || null,
      quote_value: value,
      quote_currency: value == null ? null : $('d-currency').value,
      notes: $('d-notes').value.trim() || null
    });
    var btn = $('d-save'); btn.disabled = true; btn.classList.add('is-loading'); btn.querySelector('.btn-label').textContent = 'Saving…';
    return updateRow(r.id, patch).then(function () {
      toast('Saved.'); renderDetail(); renderAll();
    }).catch(function () {
      err.textContent = 'Could not save. Check your connection and try again.'; err.hidden = false;
    }).then(function () { btn.disabled = false; btn.classList.remove('is-loading'); btn.querySelector('.btn-label').textContent = 'Save changes'; });
  }

  function initDetail() {
    detail = $('detail');
    detail.addEventListener('close', function () { document.body.style.overflow = ''; state.currentId = null; });
    detail.addEventListener('click', function (e) { if (e.target === detail) closeDetail(); });
    $('detail-close').addEventListener('click', closeDetail);
    $('d-template').addEventListener('change', function () { updateReplyLink(findRow(state.currentId)); });
    $('d-copy').addEventListener('click', function () { copyText(findRow(state.currentId).email, 'Email address copied.'); });
    $('d-save').addEventListener('click', function () { saveDetail(); });
    $('d-contacted').addEventListener('click', function () { $('d-status').value = 'contacted'; saveDetail({ status: 'contacted' }); });
    $('d-spam').addEventListener('click', function () { $('d-status').value = 'spam'; saveDetail({ status: 'spam' }).then(closeDetail); });
    $('d-reply').addEventListener('click', function () {
      var r = findRow(state.currentId);                        // replying counts as the first response
      if (r && r.status === 'new') { $('d-status').value = 'contacted'; saveDetail({ status: 'contacted' }); }
    });
  }

  /* ======================================================================= shell: tabs, render, refresh */
  function renderAll() {
    var waiting = real(state.rows).filter(function (r) { return r.status === 'new'; }).length;
    var badge = $('tab-count'); badge.hidden = !waiting; badge.textContent = waiting; badge.setAttribute('aria-label', waiting + ' new');
    document.title = (waiting ? '(' + waiting + ') ' : '') + 'Dashboard | QuantiDawn';
    if (state.tab === 'overview') renderOverview();
    if (state.tab === 'inquiries') renderInquiries();
    if (state.tab === 'analytics') renderAnalytics();
    if (state.tab === 'traffic') renderTraffic();
  }

  function showTab(name, focusHeading) {
    state.tab = name;
    Array.prototype.forEach.call(document.querySelectorAll('[data-view]'), function (s) { s.hidden = s.dataset.view !== name; });
    Array.prototype.forEach.call(document.querySelectorAll('.tabs button'), function (b) {
      if (b.dataset.tab === name) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    renderAll();
    if (name === 'traffic') loadTraffic();
    rise(document.querySelectorAll('[data-view]:not([hidden]) > *'), { y: 8, gap: 0.05 });
    if (focusHeading) { var hd = $('h-' + name); hd.tabIndex = -1; hd.focus({ preventScroll: true }); window.scrollTo(0, 0); }
  }

  function reload(announce) {
    return loadRows().then(function () {
      $('load-error').hidden = true; $('view-overview').removeAttribute('aria-busy'); renderAll(); if (state.tab === 'traffic') loadTraffic(); if (announce) toast('Up to date.');
    }).catch(function (e) {
      if ($('view-overview').hasAttribute('aria-busy')) { $('view-overview').removeAttribute('aria-busy'); setKids($('kpis'), []); setKids($('latest'), []); }
      $('load-error').textContent = 'Could not load inquiries' + (e && e.message ? ' (' + e.message + ')' : '') + '. Check your connection, then use Refresh.';
      $('load-error').hidden = false;
    });
  }

  var resizeTimer = null, lastWidth = window.innerWidth;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () { if (window.innerWidth !== lastWidth) { lastWidth = window.innerWidth; if (state.tab === 'analytics') renderAnalytics(); } }, 200);
  });

  function initShell() {
    Array.prototype.forEach.call(document.querySelectorAll('.tabs button'), function (b) { b.addEventListener('click', function () { showTab(b.dataset.tab, true); }); });
    Array.prototype.forEach.call(document.querySelectorAll('[data-goto]'), function (b) { b.addEventListener('click', function () { showTab(b.dataset.goto, true); }); });
    $('refresh-btn').addEventListener('click', function () { reload(true); });
    options($('a-range'), [['7', 'Last 7 days'], ['30', 'Last 30 days'], ['90', 'Last 90 days'], ['365', 'Last 12 months'], ['all', 'All time']], state.aRange);
    $('a-range').addEventListener('change', function (e) { state.aRange = e.target.value; renderAnalytics(); });
    initInquiryControls(); initTools(); initTraffic(); initDetail();
  }

  /* ======================================================================= motion
     Motion (assets/vendor/motion.js: animate + stagger). Transform/opacity only, and skipped
     entirely when the visitor prefers reduced motion or the library did not load. */
  var M = window.Motion;
  var calm = !M || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function settle(el) { el.style.removeProperty('transform'); el.style.removeProperty('opacity'); }
  function rise(els, opts) {
    if (calm) return;
    var list = Array.prototype.slice.call(els.length === undefined ? [els] : els);
    if (!list.length) return;
    opts = opts || {};
    M.animate(list, { opacity: [0, 1], y: [opts.y || 10, 0] },
      { type: 'spring', stiffness: 380, damping: 32, delay: list.length > 1 ? M.stagger(opts.gap || 0.045) : 0 }
    ).then(function () { list.forEach(settle); });
  }
  function shake(el) {
    if (calm) return;
    M.animate(el, { x: [0, -8, 8, -5, 5, 0] }, { duration: 0.38, ease: 'easeOut' }).then(function () { settle(el); });
  }

  /* ======================================================================= auth + boot */
  function setLoginBusy(on) {
    var b = $('login-btn'); b.disabled = on; b.classList.toggle('is-loading', on); b.querySelector('.btn-label').textContent = on ? 'Signing in…' : 'Sign in';
  }
  function loginError(field, msg) {
    var box = field ? $('login-' + field + '-error') : $('login-error');
    box.textContent = msg; box.hidden = !msg;
    if (field) $('login-' + field).classList.toggle('is-invalid', !!msg);
    if (msg) { rise(box, { y: -4 }); shake($('login-form').closest('.login-card')); }
  }
  function showLogin(message) {
    clearInterval(refreshTimer);
    $('app').hidden = true; $('login-screen').hidden = false; document.title = 'Sign in | QuantiDawn';
    loginError(null, message || '');
    if (!message) rise($('login-screen').querySelector('.login-card'), { y: 14 });
  }
  function showApp(email) {
    $('login-screen').hidden = true; $('app').hidden = false;
    $('user-email').textContent = email;
    $('demo-banner').hidden = !DEMO;
    $('signout-btn').hidden = DEMO;
    showTab('overview');
    if (!DEMO && !state.rows.length) skeletons();
    reload();
    clearInterval(refreshTimer);
    refreshTimer = setInterval(function () { if (!document.hidden && !detail.open) reload(); }, 60000);
  }

  function afterSignIn(user) {
    return sb.from('admins').select('user_id').eq('user_id', user.id).maybeSingle().then(function (r) {
      if (r.error || !r.data) {
        return sb.auth.signOut().then(function () { showLogin('This account does not have dashboard access. Ask an admin to add you.'); });
      }
      showApp(user.email);
    });
  }

  function initLogin() {
    $('login-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var email = $('login-email').value.trim(), password = $('login-password').value;
      loginError('email', email ? '' : 'Enter your email address.');
      loginError('password', password ? '' : 'Enter your password.');
      loginError(null, '');
      if (!email) { $('login-email').focus(); return; }
      if (!password) { $('login-password').focus(); return; }
      setLoginBusy(true);
      sb.auth.signInWithPassword({ email: email, password: password }).then(function (r) {
        if (r.error) {
          loginError(null, r.error.name === 'AuthRetryableFetchError' ? 'Could not reach the server. Check your connection and try again.' : 'That email or password is not correct.');
          return;
        }
        $('login-password').value = '';
        return afterSignIn(r.data.user);
      }).catch(function () { loginError(null, 'Something went wrong. Please try again.'); })
        .then(function () { setLoginBusy(false); });
    });
    $('google-btn').addEventListener('click', function () {
      var b = this; b.disabled = true; loginError(null, '');
      sb.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: location.origin + location.pathname, queryParams: { prompt: 'select_account' } }
      }).then(function (r) {
        if (r.error) { b.disabled = false; loginError(null, 'Google sign-in is not available right now. Use your email and password.'); }
      }).catch(function () { b.disabled = false; loginError(null, 'Something went wrong. Please try again.'); });
    });
    $('signout-btn').addEventListener('click', function () { sb.auth.signOut().then(function () { state.rows = []; showLogin(); }); });
  }

  var booted = false;
  function boot() {
    if (booted) return;
    booted = true;
    initShell(); initLogin();
    if (DEMO) { showApp('Preview'); return; }
    if (!window.supabase || !window.supabase.createClient) { showLogin('The dashboard could not load its data library. Reload the page.'); return; }
    sb = window.supabase.createClient(CFG.url, CFG.key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
    var oauthErr = new URLSearchParams(location.search.slice(1) || location.hash.slice(1)).get('error_description');
    sb.auth.getSession().then(function (r) {
      if (r.data && r.data.session) return afterSignIn(r.data.session.user);
      showLogin(oauthErr ? 'Google sign-in was not completed. Please try again.' : '');
    }).catch(function () { showLogin('Could not reach the server. Reload the page to try again.'); });
    sb.auth.onAuthStateChange(function (event) { if (event === 'SIGNED_OUT') { state.rows = []; if ($('app').hidden === false) showLogin(); } });
  }

  document.addEventListener('DOMContentLoaded', boot);
  if (document.readyState !== 'loading') boot();
})();
