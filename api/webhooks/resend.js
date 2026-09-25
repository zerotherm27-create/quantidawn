/* Resend webhook: stores inbound mail and updates delivery status in public.email_messages.
   Resend signs every call (Svix). The signature is checked against the RAW body before anything else, so an
   unsigned request can do nothing. Writes use the service-role key because a webhook has no user session.
   Env: RESEND_WEBHOOK_SECRET (whsec_...), RESEND_API_KEY (Full access, to read received mail),
        SUPABASE_SERVICE_ROLE_KEY.  Point Resend at https://www.quantidawn.com/api/webhooks/resend  (must be www). */
var crypto = require('crypto');
var SB_URL = 'https://bkgyweosuoskpgwenpaq.supabase.co';
var FIVE_MIN = 5 * 60;

async function rawBody(req) {
  var chunks = [];
  try { for await (var c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)); } catch (e) {}
  if (chunks.length) return Buffer.concat(chunks).toString('utf8');
  var b = req.body;                                   // the platform already consumed the stream
  if (typeof b === 'string') return b;
  if (Buffer.isBuffer(b)) return b.toString('utf8');
  return b ? JSON.stringify(b) : '';
}

function verify(secret, headers, body) {
  var id = headers['svix-id'], ts = headers['svix-timestamp'], sigs = String(headers['svix-signature'] || '');
  if (!id || !ts || !sigs) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - Number(ts)) > FIVE_MIN) return false;
  var key = Buffer.from(String(secret).replace(/^whsec_/, ''), 'base64');
  var expected = crypto.createHmac('sha256', key).update(id + '.' + ts + '.' + body).digest();
  return sigs.split(' ').some(function (part) {
    var pair = part.split(',');
    if (pair[0] !== 'v1' || !pair[1]) return false;
    var got = Buffer.from(pair[1], 'base64');
    return got.length === expected.length && crypto.timingSafeEqual(got, expected);
  });
}

function addr(v) {                                   // "Name <a@b.co>" -> a@b.co
  var s = Array.isArray(v) ? v[0] : v;
  var m = /<([^>]+)>/.exec(String(s || ''));
  return String(m ? m[1] : s || '').trim().slice(0, 254);
}
function header(headers, name) {                     // headers may be an object or a list of {name,value}
  if (!headers) return null;
  if (Array.isArray(headers)) { var h = headers.filter(function (x) { return x && String(x.name).toLowerCase() === name; })[0]; return h ? String(h.value) : null; }
  var k = Object.keys(headers).filter(function (x) { return x.toLowerCase() === name; })[0];
  return k ? String(headers[k]) : null;
}
function clip(v, n) { return v == null ? null : String(v).slice(0, n); }

async function handler(req, res) {
  function done(status, msg) { res.statusCode = status; res.end(msg || ''); }
  if (req.method !== 'POST') return done(405);

  var secret = process.env.RESEND_WEBHOOK_SECRET, service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret || !service) return done(503, 'not configured');

  var body = await rawBody(req);
  if (!verify(secret, req.headers, body)) return done(401, 'bad signature');

  var event;
  try { event = JSON.parse(body); } catch (e) { return done(400); }
  var data = event && event.data ? event.data : {};
  var db = { apikey: service, Authorization: 'Bearer ' + service, 'Content-Type': 'application/json' };
  var rest = SB_URL + '/rest/v1/';

  try {
    if (event.type === 'email.received') {
      var key = process.env.RESEND_API_KEY;
      if (!key) return done(503, 'no resend key');
      var fr = await fetch('https://api.resend.com/emails/receiving/' + encodeURIComponent(data.email_id), { headers: { Authorization: 'Bearer ' + key } });
      if (!fr.ok) return done(502, 'fetch failed');            // Resend retries
      var full = await fr.json();

      var from = addr(full.from || data.from).toLowerCase();
      var inquiryId = null;
      if (from) {
        var ir = await fetch(rest + 'quote_requests?email=ilike.' + encodeURIComponent(from.replace(/[%*_,()\\]/g, '*')) + '&select=id,email&order=created_at.desc&limit=5', { headers: db });
        var found = ir.ok ? await ir.json() : [];
        var hit = (found || []).filter(function (r) { return String(r.email).toLowerCase() === from; })[0];
        inquiryId = hit ? hit.id : null;
      }
      var row = {
        direction: 'INBOUND', status: 'RECEIVED', resend_id: String(data.email_id),
        message_id: clip(full.message_id || data.message_id || header(full.headers, 'message-id'), 300),
        in_reply_to: clip(header(full.headers, 'in-reply-to'), 300),
        from_email: from || 'unknown', to_email: addr(full.to || data.to) || 'unknown',
        subject: clip(full.subject || data.subject || '', 500) || '',
        body_text: clip(full.text, 500000), body_html: clip(full.html, 500000),
        inquiry_id: inquiryId, is_read: false
      };
      var ur = await fetch(rest + 'email_messages?on_conflict=resend_id', {
        method: 'POST', headers: Object.assign({ Prefer: 'resolution=ignore-duplicates,return=minimal' }, db), body: JSON.stringify(row)
      });
      return ur.ok ? done(200) : done(502, 'store failed');
    }

    var map = { 'email.delivered': ['DELIVERED', ['SENT']], 'email.bounced': ['BOUNCED', ['SENT', 'DELIVERED']], 'email.failed': ['FAILED', ['SENT']] };
    if (map[event.type]) {
      var m = map[event.type];
      var pr = await fetch(rest + 'email_messages?resend_id=eq.' + encodeURIComponent(data.email_id) + '&status=in.(' + m[1].join(',') + ')', {
        method: 'PATCH', headers: Object.assign({ Prefer: 'return=representation' }, db), body: JSON.stringify({ status: m[0] })
      });
      if (!pr.ok) return done(502, 'update failed');
      var changed = await pr.json();
      // the dashboard logs a sent email a moment AFTER Resend accepts it; retry briefly if the event beat the insert
      var age = (Date.now() - Date.parse(event.created_at || '')) / 1000;
      if (!changed.length && age >= 0 && age < 120) return done(503, 'not logged yet');
      return done(200);
    }

    if (event.type === 'email.sent' && data.email_id) {         // backfill the Message-ID used for threading
      var mid = clip(data.message_id || header(data.headers, 'message-id'), 300);
      if (mid) await fetch(rest + 'email_messages?resend_id=eq.' + encodeURIComponent(data.email_id) + '&message_id=is.null', { method: 'PATCH', headers: Object.assign({ Prefer: 'return=minimal' }, db), body: JSON.stringify({ message_id: mid }) });
      return done(200);
    }
    return done(200);                                            // events we do not use
  } catch (e) {
    console.error('resend webhook error', e.message);
    return done(500);
  }
}

module.exports = handler;
module.exports.config = { api: { bodyParser: false } };   // Svix signs the raw body
