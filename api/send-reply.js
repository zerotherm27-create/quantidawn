/* Sends a reply to an inquiry from the dashboard, through Resend.
   Only a signed-in admin can use it: the caller's own Supabase access token is used to read and update the
   inquiry, and Row Level Security lets only admins do that. The email always goes to the address stored on
   the inquiry, never to an address supplied by the caller. */
var mail = require('./_mail');

var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  function done(status, obj) { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(obj || {})); }
  if (req.method !== 'POST') return done(405);

  var auth = String(req.headers.authorization || '');
  var token = /^Bearer (.+)$/.exec(auth);
  if (!token) return done(401, { error: 'not_signed_in' });
  var user = { apikey: mail.SB_KEY, Authorization: 'Bearer ' + token[1], 'Content-Type': 'application/json' };

  var body = mail.readJson(req);
  var id = body && typeof body.id === 'string' ? body.id : '';
  var subject = mail.line(body && body.subject, 200), message = mail.text(body && body.body, 10000).trim();
  if (!UUID.test(id) || !subject || !message) return done(400, { error: 'bad_request' });

  var cfg = mail.config();
  if (!cfg.ready) return done(503, { error: 'email_not_configured' });

  // read the inquiry as the caller: only an admin gets a row back
  var row;
  try {
    var r = await fetch(mail.SB_URL + '/rest/v1/quote_requests?id=eq.' + id + '&select=id,email,status,first_response_at', { headers: user });
    if (r.status === 401) return done(401, { error: 'not_signed_in' });
    var rows = r.ok ? await r.json() : [];
    row = rows && rows[0];
  } catch (e) { return done(502, { error: 'lookup_failed' }); }
  if (!row) return done(403, { error: 'not_allowed' });

  try {
    await mail.sendMail(cfg, { to: [row.email], subject: subject, text: message, replyTo: cfg.replyTo }, null);
  } catch (e) { console.error('reply email failed', e.message); return done(502, { error: 'send_failed' }); }

  // record the reply (first response time, and move a new inquiry to "contacted")
  var patch = {};
  if (!row.first_response_at) patch.first_response_at = new Date().toISOString();
  if (row.status === 'new') patch.status = 'contacted';
  var saved = true;
  if (Object.keys(patch).length) {
    try {
      var p = await fetch(mail.SB_URL + '/rest/v1/quote_requests?id=eq.' + id, { method: 'PATCH', headers: Object.assign({ Prefer: 'return=minimal' }, user), body: JSON.stringify(patch) });
      saved = p.ok;
    } catch (e) { saved = false; }
  }
  return done(200, { sent: true, recorded: saved });
};
