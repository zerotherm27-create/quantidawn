/* Sends an email from the dashboard through Resend and logs it in the Inbox (public.email_messages).
   Admin-only: the caller's own Supabase access token is used for every database call, so Row Level Security
   decides. Body is light markup (see assets/email-format.js) sent as HTML plus a plain-text alternative. */
var mail = require('./_mail');
var fmt = require('../assets/email-format.js');

var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
var EMAIL = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]{2,}$/;
var MSGID = /^<[^\s<>]{1,200}>$/;

function fromAddress(from) {                       // "Name <a@b.co>" -> a@b.co
  var m = /<([^>]+)>/.exec(from || '');
  return (m ? m[1] : String(from || '')).trim();
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  function done(status, obj) { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(obj || {})); }
  if (req.method !== 'POST') return done(405);

  var token = /^Bearer (.+)$/.exec(String(req.headers.authorization || ''));
  if (!token) return done(401, { error: 'not_signed_in' });
  var user = { apikey: mail.SB_KEY, Authorization: 'Bearer ' + token[1], 'Content-Type': 'application/json' };
  var rest = mail.SB_URL + '/rest/v1/';

  var body = mail.readJson(req);
  var to = mail.line(body && body.to, 254), subject = mail.line(body && body.subject, 200), message = mail.text(body && body.body, 20000).trim();
  var parentId = body && typeof body.parentId === 'string' && UUID.test(body.parentId) ? body.parentId : null;
  var inquiryId = body && typeof body.inquiryId === 'string' && UUID.test(body.inquiryId) ? body.inquiryId : null;
  if (!EMAIL.test(to) || !subject || !message) return done(400, { error: 'bad_request' });

  var cfg = mail.config();
  if (!cfg.ready) return done(503, { error: 'email_not_configured' });

  // prove the caller is an admin. Ask the database (public.is_admin() runs as the caller): an empty-but-successful
  // query is NOT proof, because Row Level Security returns 200 with no rows to a signed-in non-admin.
  var headers = {}, parent = null, inquiry = null;
  try {
    var probe = await fetch(rest + 'rpc/is_admin', { method: 'POST', headers: user, body: '{}' });
    if (probe.status === 401) return done(401, { error: 'not_signed_in' });
    var isAdmin = probe.ok ? await probe.json() : null;
    if (isAdmin !== true) return done(403, { error: 'not_allowed' });

    if (parentId) {
      var pr = await fetch(rest + 'email_messages?id=eq.' + parentId + '&select=id,message_id,inquiry_id,subject', { headers: user });
      parent = pr.ok ? (await pr.json())[0] : null;
      if (parent && parent.message_id && MSGID.test(parent.message_id)) {
        headers['In-Reply-To'] = parent.message_id; headers['References'] = parent.message_id;
      }
      if (parent && parent.inquiry_id && !inquiryId) inquiryId = parent.inquiry_id;
    }
    // link to the inquiry from that person, if one exists (wildcards widen the database match; the exact check is in JS)
    var iq = inquiryId
      ? await fetch(rest + 'quote_requests?id=eq.' + inquiryId + '&select=id,status,first_response_at,email', { headers: user })
      : await fetch(rest + 'quote_requests?email=ilike.' + encodeURIComponent(to.replace(/[%*_,()\\]/g, '*')) + '&select=id,status,first_response_at,email&order=created_at.desc&limit=5', { headers: user });
    var found = iq.ok ? await iq.json() : [];
    inquiry = (found || []).filter(function (r) { return inquiryId || String(r.email).toLowerCase() === to.toLowerCase(); })[0] || null;
  } catch (e) { return done(502, { error: 'lookup_failed' }); }

  var sent;
  try {
    sent = await mail.sendMail(cfg, {
      to: [to], subject: subject,
      text: fmt.toPlain(message), html: fmt.toHtml(message),
      headers: Object.keys(headers).length ? headers : null,
      replyTo: cfg.replyTo
    }, null);
  } catch (e) { console.error('send failed', e.message); return done(502, { error: 'send_failed' }); }

  // log it (a failure here must not make the admin retry an email that already went out)
  var warning = null;
  try {
    var row = {
      direction: 'OUTBOUND', status: 'SENT', resend_id: sent && sent.id ? String(sent.id) : null,
      in_reply_to: parent && parent.message_id ? parent.message_id : null,
      from_email: fromAddress(cfg.from), to_email: to, subject: subject,
      body_text: fmt.toPlain(message), body_html: fmt.toHtml(message),
      inquiry_id: inquiry ? inquiry.id : null, is_read: true
    };
    var lr = await fetch(rest + 'email_messages', { method: 'POST', headers: Object.assign({ Prefer: 'return=minimal' }, user), body: JSON.stringify(row) });
    if (!lr.ok) warning = 'logged_failed';
  } catch (e) { warning = 'logged_failed'; }

  // a reply to an inquiry counts as the first response
  if (inquiry) {
    var patch = {};
    if (!inquiry.first_response_at) patch.first_response_at = new Date().toISOString();
    if (inquiry.status === 'new') patch.status = 'contacted';
    if (Object.keys(patch).length) {
      try { await fetch(rest + 'quote_requests?id=eq.' + inquiry.id, { method: 'PATCH', headers: Object.assign({ Prefer: 'return=minimal' }, user), body: JSON.stringify(patch) }); } catch (e) { warning = warning || 'inquiry_not_updated'; }
    }
  }
  return done(200, { sent: true, warning: warning });
};
