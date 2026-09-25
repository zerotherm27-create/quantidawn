/* QuantiDawn analytics collector (Vercel Function).
   Receives one small event from track.js, adds the visitor's country/region from Vercel's edge
   headers, and stores it in Supabase. It never stores the IP address.
   The Supabase key below is the PUBLISHABLE key (same one config.js ships to every browser):
   Row Level Security only lets it INSERT into page_events, never read anything. */
var SB_URL = 'https://bkgyweosuoskpgwenpaq.supabase.co';
var SB_KEY = 'sb_publishable_D9l8UY0DwJTZilTk-Yhd_g_pH41XWf_';

var TYPES = { pageview: 1, click: 1, leave: 1, conversion: 1 };
var BOT = /bot|crawl|spider|slurp|headless|lighthouse|pagespeed|preview|monitor|uptime|curl|wget|python|node-fetch|axios|go-http/i;
var OWN_HOSTS = /(^|\.)quantidawn\.com$|\.vercel\.app$|^localhost$/;

function clean(v, max) {
  if (typeof v !== 'string') return null;
  v = v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  return v || null;
}
function int(v, lo, hi) {
  v = Math.round(Number(v));
  return isFinite(v) && v >= lo && v <= hi ? v : null;
}
function hostOf(v) { try { return new URL(v).hostname; } catch (e) { return null; } }

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.statusCode = 405; return res.end(); }

  var ua = String(req.headers['user-agent'] || '');
  var originHost = req.headers.origin ? hostOf(req.headers.origin) : null;
  if (!ua || BOT.test(ua) || (originHost && !OWN_HOSTS.test(originHost))) { res.statusCode = 204; return res.end(); }

  var body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
  if (!body || typeof body !== 'object' || !TYPES[body.t]) { res.statusCode = 400; return res.end(); }

  var sid = clean(body.s, 40), path = clean(body.p, 200);
  if (!sid || sid.length < 16 || !path || path.charAt(0) !== '/') { res.statusCode = 400; return res.end(); }

  var country = String(req.headers['x-vercel-ip-country'] || '').toUpperCase();
  var region = String(req.headers['x-vercel-ip-country-region'] || '').toUpperCase();
  var referrer = clean(body.r, 120);
  if (referrer && OWN_HOSTS.test(referrer)) referrer = null;

  var row = {
    session_id: sid,
    type: body.t,
    path: path,
    referrer: referrer,
    utm_source: clean(body.u, 60),
    country: /^[A-Z]{2}$/.test(country) ? country : null,
    region: /^[A-Z0-9-]{1,6}$/.test(region) ? region : null,
    device: /iPad|Tablet/i.test(ua) ? 'tablet' : /Mobi|Android|iPhone/i.test(ua) ? 'mobile' : 'desktop',
    label: body.t === 'click' || body.t === 'conversion' ? clean(body.l, 100) : null,
    duration_ms: body.t === 'leave' ? int(body.d, 0, 1800000) : null,
    scroll_pct: body.t === 'leave' ? int(body.c, 0, 100) : null
  };

  try {
    var r = await fetch(SB_URL + '/rest/v1/page_events', {
      method: 'POST',
      headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify(row)
    });
    res.statusCode = r.ok ? 204 : 502;
  } catch (e) {
    res.statusCode = 502;
  }
  res.end();
};
