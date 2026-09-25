/* QuantiDawn dashboard Inbox: read, search, organise, compose and reply to email (Resend transport).
   Loaded by admin.html; admin.js hands over the Supabase client through QDInbox.init().
   Security: received mail is untrusted. It is only ever shown in a sandboxed iframe (no scripts, no same-origin,
   locked-down CSP) or as plain text via textContent, never with innerHTML. */
(function () {
  'use strict';
  var F = window.QDEmailFormat;
  var ctx = null, sb = null;
  var S = { rows: [], folder: 'inbox', q: '', sel: {}, cur: null, mode: 'list', loaded: false, error: '', signature: '', reply: null };
  var $ = function (id) { return document.getElementById(id); };

  function h(tag, props) {
    var n = document.createElement(tag);
    Object.keys(props || {}).forEach(function (k) {
      var v = props[k];
      if (v == null || v === false) return;
      if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v;
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), v); else n.setAttribute(k, v === true ? '' : v);
    });
    for (var i = 2; i < arguments.length; i++) { var c = arguments[i]; if (c == null) continue; (Array.isArray(c) ? c : [c]).forEach(function (x) { n.appendChild(typeof x === 'object' ? x : document.createTextNode(String(x))); }); }
    return n;
  }
  function kids(node, list) { while (node.firstChild) node.removeChild(node.firstChild); (Array.isArray(list) ? list : [list]).forEach(function (c) { if (c) node.appendChild(c); }); }
  function ago(iso) {
    var s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (s < 60) return 'just now'; if (s < 3600) return Math.floor(s / 60) + ' min ago'; if (s < 86400) return Math.floor(s / 3600) + ' h ago';
    if (s < 86400 * 7) return Math.floor(s / 86400) + ' d ago';
    return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso));
  }
  function when(iso) { return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso)); }
  function find(id) { for (var i = 0; i < S.rows.length; i++) if (S.rows[i].id === id) return S.rows[i]; return null; }

  var FOLDERS = [['inbox', 'Inbox'], ['sent', 'Sent'], ['starred', 'Starred'], ['archive', 'Archive'], ['trash', 'Trash'], ['all', 'All mail']];
  var inFolder = {
    inbox: function (r) { return r.direction === 'INBOUND' && !r.is_archived && !r.deleted_at; },
    sent: function (r) { return r.direction === 'OUTBOUND' && !r.deleted_at; },
    starred: function (r) { return r.is_starred && !r.deleted_at; },
    archive: function (r) { return r.is_archived && !r.deleted_at; },
    trash: function (r) { return !!r.deleted_at; },
    all: function (r) { return !r.deleted_at; }
  };
  function unread() { return S.rows.filter(function (r) { return inFolder.inbox(r) && !r.is_read; }).length; }
  function updateBadge() { var n = unread(), b = $('ib-count'); if (b) { b.hidden = !n; b.textContent = n; b.setAttribute('aria-label', n + ' unread'); } }

  /* ---------------------------------------------------------------- data */
  var COLS = 'id,created_at,direction,status,message_id,in_reply_to,from_email,to_email,subject,inquiry_id,is_read,is_starred,is_archived,deleted_at';
  function load() {
    if (ctx.demo) { S.rows = window.QUANTIDAWN_INBOX ? window.QUANTIDAWN_INBOX() : []; S.loaded = true; S.error = ''; updateBadge(); return Promise.resolve(); }
    return sb.from('email_messages').select(COLS).order('created_at', { ascending: false }).limit(500).then(function (r) {
      if (r.error) throw r.error;
      var open = S.cur, prevBodies = {}; S.rows.forEach(function (x) { if (x.body_html !== undefined || x.body_text !== undefined) prevBodies[x.id] = x; });
      S.rows = r.data.map(function (x) { var p = prevBodies[x.id]; if (p) { x.body_html = p.body_html; x.body_text = p.body_text; } return x; });
      S.loaded = true; S.error = ''; if (open && !find(open)) S.cur = null; updateBadge();
    }).catch(function (e) {
      S.error = e && (e.code === '42P01' || /email_messages/.test(e.message || '')) ? 'setup' : 'load';
    });
  }
  function loadBody(row) {
    if (row.body_html !== undefined || ctx.demo) return Promise.resolve(row);
    return sb.from('email_messages').select('body_text,body_html').eq('id', row.id).single().then(function (r) {
      if (!r.error && r.data) { row.body_text = r.data.body_text; row.body_html = r.data.body_html; }
      return row;
    });
  }
  function patch(ids, changes) {
    ids.forEach(function (id) { var r = find(id); if (r) Object.assign(r, changes); });
    updateBadge(); render();
    if (ctx.demo) return Promise.resolve();
    return sb.from('email_messages').update(changes).in('id', ids).then(function (r) {
      if (r.error) { ctx.toast('Could not save that change. Refresh and try again.', true); return load().then(render); }
    });
  }
  function remove(ids) {
    S.rows = S.rows.filter(function (r) { return ids.indexOf(r.id) === -1; }); ids.forEach(function (id) { delete S.sel[id]; });
    if (ids.indexOf(S.cur) !== -1) { S.cur = null; S.mode = 'list'; }
    updateBadge(); render();
    if (ctx.demo) return Promise.resolve();
    return sb.from('email_messages').delete().in('id', ids).then(function (r) { if (r.error) { ctx.toast('Could not delete. Refresh and try again.', true); return load().then(render); } });
  }

  /* ---------------------------------------------------------------- list */
  function visible() {
    var q = S.q.trim().toLowerCase();
    return S.rows.filter(inFolder[S.folder]).filter(function (r) {
      return !q || (r.from_email + ' ' + r.to_email + ' ' + r.subject).toLowerCase().indexOf(q) !== -1;
    });
  }
  function statusPill(r) {
    if (r.direction !== 'OUTBOUND') return null;
    var label = { SENT: 'Sent', DELIVERED: 'Delivered', BOUNCED: 'Bounced', FAILED: 'Failed' }[r.status] || r.status;
    var cls = r.status === 'DELIVERED' ? 'won' : r.status === 'BOUNCED' || r.status === 'FAILED' ? 'new' : 'contacted';
    return h('span', { class: 'pill pill--' + cls, text: label });
  }
  function star(r) {
    return h('button', { type: 'button', class: 'ib-star' + (r.is_starred ? ' is-on' : ''), 'aria-pressed': String(!!r.is_starred), 'aria-label': r.is_starred ? 'Remove star' : 'Star this message',
      onclick: function (e) { e.stopPropagation(); patch([r.id], { is_starred: !r.is_starred }); } },
      h('svg', { viewBox: '0 0 24 24', width: 18, height: 18, 'aria-hidden': 'true', focusable: 'false' }));
  }
  function starIcon(btn) { btn.innerHTML = ''; var s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', '18'); s.setAttribute('height', '18'); s.setAttribute('aria-hidden', 'true');
    var p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', 'M12 3l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.8 6.2 20.9l1.1-6.5L2.6 9.8l6.5-.9z'); p.setAttribute('stroke', 'currentColor'); p.setAttribute('stroke-width', '1.8'); p.setAttribute('stroke-linejoin', 'round'); s.appendChild(p); btn.appendChild(s); }

  function renderFolders() {
    $('ib-empty-trash').hidden = S.folder !== 'trash';
    kids($('ib-folders'), FOLDERS.map(function (f) {
      var n = f[0] === 'inbox' ? unread() : 0;
      return h('button', { type: 'button', class: 'chip', 'aria-pressed': String(S.folder === f[0]), onclick: function () { S.folder = f[0]; S.sel = {}; S.cur = null; S.mode = 'list'; render(); } },
        f[1], n ? h('span', { class: 'n', text: ' ' + n }) : null);
    }));
  }
  function renderBulk() {
    var ids = Object.keys(S.sel), box = $('ib-bulk'); box.hidden = !ids.length; if (!ids.length) return;
    var inTrash = S.folder === 'trash';
    kids(box, [h('span', { text: ids.length + ' selected' }),
      inTrash ? h('button', { type: 'button', class: 'btn btn--quiet', onclick: function () { patch(ids, { deleted_at: null }); S.sel = {}; render(); } }, 'Restore') : [
        h('button', { type: 'button', class: 'btn btn--quiet', onclick: function () { patch(ids, { is_read: true }); } }, 'Mark read'),
        h('button', { type: 'button', class: 'btn btn--quiet', onclick: function () { patch(ids, { is_archived: S.folder !== 'archive' }); S.sel = {}; render(); } }, S.folder === 'archive' ? 'Unarchive' : 'Archive'),
        h('button', { type: 'button', class: 'btn btn--quiet', onclick: function () { patch(ids, { deleted_at: new Date().toISOString() }); S.sel = {}; render(); } }, 'Move to Trash')],
      h('button', { type: 'button', class: 'btn btn--quiet', onclick: function () { S.sel = {}; render(); } }, 'Clear')]);
  }
  function renderList() {
    var rows = visible(), box = $('ib-list');
    if (!rows.length) {
      var msg = S.q ? ['No messages match', 'Try a different search.'] : S.folder === 'inbox' ? ['Your inbox is empty', 'Replies from clients and anything sent to your receiving address will appear here.'] :
        S.folder === 'trash' ? ['Trash is empty', 'Deleted messages stay here until you delete them permanently.'] : ['Nothing here yet', 'Messages you file here will show up in this folder.'];
      kids(box, h('div', { class: 'empty' }, h('strong', { text: msg[0] }), msg[1])); return;
    }
    kids(box, rows.map(function (r) {
      var out = r.direction === 'OUTBOUND', who = out ? 'To: ' + r.to_email : r.from_email, isUnread = !r.is_read && !out;
      var st = star(r); starIcon(st);
      var check = h('input', { type: 'checkbox', 'aria-label': 'Select message from ' + who, onclick: function (e) { e.stopPropagation(); }, onchange: function (e) { if (e.target.checked) S.sel[r.id] = true; else delete S.sel[r.id]; renderBulk(); } });
      if (S.sel[r.id]) check.checked = true;
      return h('div', { class: 'ib-row' + (isUnread ? ' is-unread' : '') + (S.cur === r.id ? ' is-current' : ''), role: 'listitem' },
        h('span', { class: 'ib-check' }, check), st,
        h('button', { type: 'button', class: 'ib-open', onclick: function () { openMsg(r.id); } },
          h('span', { class: 'ib-who', text: who }),
          h('span', { class: 'ib-subj', text: r.subject || '(no subject)' }),
          h('span', { class: 'ib-meta' }, statusPill(r), r.inquiry_id ? h('span', { class: 'pill pill--quoted', text: 'Inquiry' }) : null, h('span', { class: 'ib-time', text: ago(r.created_at) }))));
    }));
  }

  /* ---------------------------------------------------------------- reading */
  var CSP = "default-src 'none'; img-src https: data:; style-src 'unsafe-inline'";
  function frame(html) {
    var f = h('iframe', { class: 'ib-frame', title: 'Message content', sandbox: 'allow-popups', referrerpolicy: 'no-referrer', loading: 'lazy' });
    f.srcdoc = '<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="' + CSP + '"><base target="_blank"><style>body{font:15px/1.55 -apple-system,Segoe UI,Arial,sans-serif;color:#17212B;margin:12px;word-wrap:break-word}img{max-width:100%;height:auto}</style>' + html;
    return f;
  }
  function openMsg(id) {
    S.cur = id; S.mode = 'read'; var r = find(id);
    if (r && r.direction === 'INBOUND' && !r.is_read) patch([id], { is_read: true });
    render(); loadBody(r).then(function () { if (S.cur === id) renderDetail(); });
  }
  function btn(label, fn, cls) { return h('button', { type: 'button', class: 'btn ' + (cls || 'btn--secondary'), onclick: fn }, label); }
  function renderDetail() {
    var box = $('ib-detail'), r = find(S.cur);
    if (!r || S.mode === 'list') { box.hidden = true; return; }
    if (S.mode === 'compose' || S.mode === 'signature') { box.hidden = true; return; }
    box.hidden = false;
    var body;
    if (r.body_html === undefined && !ctx.demo) body = h('p', { class: 'hint', text: 'Loading…' });
    else if (r.body_html) body = frame(r.body_html);
    else body = h('pre', { class: 'ib-plain', text: r.body_text || '(no content)' });
    var trashed = !!r.deleted_at;
    var actions = [
      btn('Reply', function () { compose({ to: r.direction === 'INBOUND' ? r.from_email : r.to_email, subject: /^re:/i.test(r.subject) ? r.subject : 'Re: ' + (r.subject || ''), parent: r }); }, 'btn--primary'),
      btn(r.is_starred ? 'Unstar' : 'Star', function () { patch([r.id], { is_starred: !r.is_starred }); })
    ];
    if (trashed) {
      actions.push(btn('Restore', function () { patch([r.id], { deleted_at: null }); }));
      actions.push(btn('Delete forever', function () { confirmDelete([r.id]); }, 'btn--danger'));
    } else {
      actions.push(btn(r.is_archived ? 'Unarchive' : 'Archive', function () { patch([r.id], { is_archived: !r.is_archived }); }));
      if (r.direction === 'INBOUND') actions.push(btn(r.is_read ? 'Mark unread' : 'Mark read', function () { patch([r.id], { is_read: !r.is_read }); }));
      actions.push(btn('Move to Trash', function () { patch([r.id], { deleted_at: new Date().toISOString() }); S.cur = null; S.mode = 'list'; render(); }));
    }
    if (r.inquiry_id && ctx.openInquiry) actions.push(btn('Open inquiry', function () { ctx.openInquiry(r.inquiry_id); }));
    kids(box, [
      h('button', { type: 'button', class: 'link-btn ib-back', onclick: function () { S.mode = 'list'; S.cur = null; render(); } }, '← Back to list'),
      h('h3', { class: 'ib-title', text: r.subject || '(no subject)' }),
      h('dl', { class: 'facts ib-facts' }, h('dt', { text: 'From' }), h('dd', { text: r.from_email }), h('dt', { text: 'To' }), h('dd', { text: r.to_email }), h('dt', { text: 'Date' }), h('dd', { text: when(r.created_at) }),
        r.direction === 'OUTBOUND' ? [h('dt', { text: 'Status' }), h('dd', null, statusPill(r))] : null),
      h('div', { class: 'row-actions' }, actions),
      h('div', { class: 'ib-confirm', id: 'ib-confirm', hidden: true }),
      h('div', { class: 'ib-body' }, body)]);
  }
  function confirmDelete(ids) {
    var c = $('ib-confirm'); if (!c) return; c.hidden = false;
    kids(c, [h('p', { text: 'Delete ' + (ids.length === 1 ? 'this message' : ids.length + ' messages') + ' permanently? This cannot be undone.' }),
      h('div', { class: 'row-actions' }, btn('Yes, delete permanently', function () { remove(ids); }, 'btn--danger'), btn('Cancel', function () { c.hidden = true; }))]);
  }

  /* ---------------------------------------------------------------- compose */
  function sigText() { return S.signature.trim() ? '\n\n' + S.signature.trim() : ''; }
  function finalBody() { return $('ib-c-body').value.replace(/\s+$/, '') + ($('ib-c-sig').checked ? sigText() : ''); }
  function wrap(before, after, placeholder) {
    var t = $('ib-c-body'), a = t.selectionStart, b = t.selectionEnd, sel = t.value.slice(a, b) || placeholder;
    t.value = t.value.slice(0, a) + before + sel + after + t.value.slice(b); t.focus(); t.setSelectionRange(a + before.length, a + before.length + sel.length); preview();
  }
  function linePrefix(prefix) {
    var t = $('ib-c-body'), a = t.selectionStart, start = t.value.lastIndexOf('\n', a - 1) + 1;
    t.value = t.value.slice(0, start) + prefix + t.value.slice(start); t.focus(); t.setSelectionRange(a + prefix.length, a + prefix.length); preview();
  }
  function preview() { var p = $('ib-c-preview'); if (!p.hidden) kids(p, frame(F.toHtml(finalBody()))); }
  function compose(opts) {
    opts = opts || {}; S.mode = 'compose'; S.reply = opts.parent || null;
    $('ib-c-to').value = opts.to || ''; $('ib-c-subject').value = opts.subject || ''; $('ib-c-body').value = ''; $('ib-c-sig').checked = !!S.signature.trim();
    $('ib-c-error').hidden = true; $('ib-c-preview').hidden = true; $('ib-c-toggle').textContent = 'Preview';
    $('ib-c-note').textContent = S.reply ? 'Replying keeps this message in the same thread.' : '';
    render(); $('ib-c-' + (opts.to ? 'body' : 'to')).focus();
  }
  function cErr(m) { var e = $('ib-c-error'); e.textContent = m; e.hidden = !m; }
  function send() {
    var to = $('ib-c-to').value.trim(), subject = $('ib-c-subject').value.trim(), body = finalBody().trim();
    if (!/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]{2,}$/.test(to)) { cErr('Enter one valid email address in To.'); $('ib-c-to').focus(); return; }
    if (!subject) { cErr('Add a subject.'); $('ib-c-subject').focus(); return; }
    if (!$('ib-c-body').value.trim()) { cErr('Write a message.'); $('ib-c-body').focus(); return; }
    cErr('');
    var b = $('ib-c-send'); b.disabled = true; b.classList.add('is-loading'); b.querySelector('.btn-label').textContent = 'Sending…';
    var done = function () { b.disabled = false; b.classList.remove('is-loading'); b.querySelector('.btn-label').textContent = 'Send'; };
    if (ctx.demo) {
      setTimeout(function () { done(); S.rows.unshift({ id: 'demo-' + Date.now(), created_at: new Date().toISOString(), direction: 'OUTBOUND', status: 'SENT', from_email: 'estimates@quantidawn.com', to_email: to, subject: subject, body_text: F.toPlain(body), body_html: F.toHtml(body), is_read: true, is_starred: false, is_archived: false, deleted_at: null });
        S.mode = 'list'; S.folder = 'sent'; render(); ctx.toast('Preview only: no email was sent.'); }, 500); return;
    }
    sb.auth.getSession().then(function (r) {
      var s = r.data && r.data.session; if (!s) throw { code: 401 };
      return fetch('/api/inbox-send', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + s.access_token },
        body: JSON.stringify({ to: to, subject: subject, body: body, parentId: S.reply ? S.reply.id : undefined }) });
    }).then(function (resp) {
      if (resp.ok) return resp.json().then(function (j) {
        ctx.toast(j && j.warning === 'logged_failed' ? 'Email sent, but it could not be saved to Sent. Refresh to check.' : 'Email sent to ' + to + '.');
        S.mode = 'list'; S.cur = null; S.folder = 'sent'; return load().then(function () { render(); if (ctx.afterSend) ctx.afterSend(); });
      });
      cErr(resp.status === 503 ? 'Email sending is not set up yet. Add the Resend settings in Vercel (see backend/README.md).'
        : resp.status === 401 || resp.status === 403 ? 'Your session has expired. Sign in again and retry.' : 'The email could not be sent. Check your connection and try again.');
    }).catch(function (e) { cErr(e && e.code === 401 ? 'Your session has expired. Sign in again and retry.' : 'The email could not be sent. Check your connection and try again.'); }).then(done);
  }

  /* ---------------------------------------------------------------- signature */
  function openSignature() { S.mode = 'signature'; $('ib-s-text').value = S.signature; $('ib-s-error').hidden = true; render(); $('ib-s-text').focus(); }
  function saveSignature() {
    var v = $('ib-s-text').value.replace(/\s+$/, '');
    var finish = function () { S.signature = v; S.mode = 'list'; render(); ctx.toast('Signature saved.'); };
    if (ctx.demo) return finish();
    sb.from('dashboard_settings').upsert({ key: 'email_signature', value: v, updated_at: new Date().toISOString() }).then(function (r) {
      if (r.error) { var e = $('ib-s-error'); e.textContent = 'Could not save the signature. Check your connection and try again.'; e.hidden = false; return; }
      finish();
    });
  }
  function loadSignature() {
    if (ctx.demo) { S.signature = 'Kind regards,\nThe QuantiDawn team'; return Promise.resolve(); }
    return sb.from('dashboard_settings').select('value').eq('key', 'email_signature').maybeSingle().then(function (r) { if (r.data) S.signature = r.data.value || ''; });
  }

  /* ---------------------------------------------------------------- render */
  function render() {
    if (!ctx || !$('inbox')) return;
    var root = $('inbox'), setup = S.error === 'setup';
    root.className = 'inbox' + (S.mode === 'read' ? ' is-reading' : '') + (S.mode === 'compose' || S.mode === 'signature' ? ' is-composing' : '');
    $('ib-error').hidden = !S.error; $('ib-error').textContent = setup ? 'The Inbox is not set up yet. Run backend/inbox.sql in the Supabase SQL editor, then reload this page.' : S.error ? 'Could not load email. Check your connection, then use Refresh.' : '';
    $('ib-compose-panel').hidden = S.mode !== 'compose'; $('ib-signature-panel').hidden = S.mode !== 'signature';
    renderFolders(); renderBulk();
    if (setup) { kids($('ib-list'), []); } else if (!S.loaded) { kids($('ib-list'), [1, 2, 3, 4].map(function () { return h('div', { class: 'skel skel-row', 'aria-hidden': 'true' }); })); } else renderList();
    renderDetail();
  }

  function initDom() {
    $('ib-search').addEventListener('input', function (e) { S.q = e.target.value; renderList(); });
    $('ib-compose').addEventListener('click', function () { compose(); });
    $('ib-sig').addEventListener('click', openSignature);
    $('ib-c-send').addEventListener('click', send);
    $('ib-c-cancel').addEventListener('click', function () { S.mode = S.cur ? 'read' : 'list'; render(); });
    $('ib-c-toggle').addEventListener('click', function () { var p = $('ib-c-preview'); p.hidden = !p.hidden; this.textContent = p.hidden ? 'Preview' : 'Edit'; $('ib-c-body').hidden = !p.hidden; if (!p.hidden) preview(); });
    $('ib-c-sig').addEventListener('change', preview);
    $('ib-c-body').addEventListener('keydown', function (e) {
      if (!(e.metaKey || e.ctrlKey)) return; var k = e.key.toLowerCase();
      if (k === 'b') { e.preventDefault(); wrap('**', '**', 'bold'); } else if (k === 'i') { e.preventDefault(); wrap('*', '*', 'italic'); } else if (k === 'k') { e.preventDefault(); wrap('[', '](https://)', 'link text'); }
    });
    [['ib-t-b', function () { wrap('**', '**', 'bold'); }], ['ib-t-i', function () { wrap('*', '*', 'italic'); }], ['ib-t-l', function () { wrap('[', '](https://)', 'link text'); }],
     ['ib-t-h', function () { linePrefix('# '); }], ['ib-t-u', function () { linePrefix('- '); }], ['ib-t-o', function () { linePrefix('1. '); }]].forEach(function (p) { $(p[0]).addEventListener('click', p[1]); });
    $('ib-s-save').addEventListener('click', saveSignature);
    $('ib-s-cancel').addEventListener('click', function () { S.mode = 'list'; render(); });
    $('ib-empty-trash').addEventListener('click', function () {
      var ids = S.rows.filter(inFolder.trash).map(function (r) { return r.id; }); if (!ids.length) return;
      if (window.confirm('Permanently delete ' + ids.length + ' message' + (ids.length === 1 ? '' : 's') + ' in Trash? This cannot be undone.')) remove(ids);
    });
  }

  window.QDInbox = {
    init: function (c) { if (ctx) return; ctx = c; sb = c.sb; initDom(); return Promise.all([load(), loadSignature()]).then(render); },
    show: function () { return load().then(render); },
    refresh: function () { return load().then(function () { if (ctx.active()) render(); }); },
    render: render,
    unread: unread
  };
})();
