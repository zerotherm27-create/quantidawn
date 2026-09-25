/* Shared helpers for the email functions (files starting with "_" are not exposed as routes).
   Configuration comes from Vercel environment variables, never from the code:
     RESEND_API_KEY  secret API key from resend.com
     MAIL_FROM       e.g. QuantiDawn <estimates@quantidawn.com>  (domain must be verified in Resend)
     TEAM_EMAILS     comma-separated inboxes that get a note for every new inquiry
     REPLY_TO        address clients reply to. To see replies in the dashboard Inbox it must be an address Resend
                  receives mail for (see backend/README.md); otherwise it defaults to the first TEAM_EMAILS entry
   Supabase URL and PUBLISHABLE key are the same public values config.js ships to every browser. */
var SB_URL = 'https://bkgyweosuoskpgwenpaq.supabase.co';
var SB_KEY = 'sb_publishable_D9l8UY0DwJTZilTk-Yhd_g_pH41XWf_';
var SITE = 'https://www.quantidawn.com';

function line(v, max) {                      // single line, no header injection
  return String(v == null ? '' : v).replace(/[\r\n\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max || 200);
}
function text(v, max) {
  return String(v == null ? '' : v).replace(/\u0000/g, '').slice(0, max || 10000);
}
function list(v) {                            // accepts "a@b.co" and "Name <a@b.co>", comma separated; returns bare addresses
  return String(v || '').split(',').map(function (x) { var m = /<([^<>]+)>/.exec(x); return (m ? m[1] : x).trim(); })
    .filter(function (x) { return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]{2,}$/.test(x); });
}
function config() {
  var team = list(process.env.TEAM_EMAILS);
  var key = process.env.RESEND_API_KEY, from = process.env.MAIL_FROM;
  var rt = list(process.env.REPLY_TO)[0];
  var replySource = rt ? 'REPLY_TO' : process.env.REPLY_TO ? 'INVALID REPLY_TO (falls back to TEAM_EMAILS)' : team[0] ? 'REPLY_TO unset (falls back to TEAM_EMAILS)' : 'none';
  return {
    replySource: replySource,
    ready: !!(key && from),
    key: key, from: from, team: team,
    replyTo: list(process.env.REPLY_TO)[0] || team[0] || null
  };
}

/* Send one email through Resend. `idempotencyKey` makes a retry safe (Resend ignores duplicates). */
async function sendMail(cfg, msg, idempotencyKey) {
  var headers = { Authorization: 'Bearer ' + cfg.key, 'Content-Type': 'application/json' };
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  var body = { from: cfg.from, to: msg.to, subject: line(msg.subject, 200), text: text(msg.text) };
  if (msg.html) body.html = text(msg.html, 200000);
  if (msg.headers) body.headers = msg.headers;
  if (msg.replyTo) body.reply_to = msg.replyTo;
  var r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: headers, body: JSON.stringify(body) });
  if (!r.ok) {
    var detail = ''; try { detail = (await r.text()).slice(0, 300); } catch (e) {}
    var err = new Error('resend_' + r.status + ' ' + detail); err.status = r.status; throw err;
  }
  return r.json();
}

/* Record an automatic email in the dashboard Inbox (public.email_messages). Uses the service-role key because there is
   no signed-in user here. Best effort: a failure is logged and never blocks or fails the email itself. */
async function logAutomatic(row) {
  var key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return;
  try {
    var r = await fetch(SB_URL + '/rest/v1/email_messages?on_conflict=resend_id', {
      method: 'POST',
      headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', Prefer: 'resolution=ignore-duplicates,return=minimal' },
      body: JSON.stringify(Object.assign({ direction: 'OUTBOUND', status: 'SENT', is_read: true }, row))
    });
    if (!r.ok) console.error('inbox log failed', r.status);
  } catch (e) { console.error('inbox log failed', e.message); }
}
function addressOf(from) { var m = /<([^>]+)>/.exec(from || ''); return (m ? m[1] : String(from || '')).trim(); }

function readJson(req) {
  var b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = null; } }
  return b && typeof b === 'object' ? b : null;
}

module.exports = { logAutomatic: logAutomatic, addressOf: addressOf, SB_URL: SB_URL, SB_KEY: SB_KEY, SITE: SITE, line: line, text: text, config: config, sendMail: sendMail, readJson: readJson };
