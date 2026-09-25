/* Sends the emails for a new inquiry: a note to the team and a confirmation to the sender.
   Called by the quote form right after it saves the inquiry. The database only hands the details over once,
   for a real (non-spam) inquiry created in the last 10 minutes (see backend/email.sql). */
var mail = require('./_mail');

var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
var MARKET = { AU: 'Australia', US: 'United States', SG: 'Singapore', Other: 'Other' };
var TYPE = { residential: 'Residential', commercial: 'Commercial', civil: 'Civil & infrastructure', subcontractor: 'Subcontractor package' };
var INTEREST = { single: 'A single project', retainer: 'A monthly retainer' };
var TIMING = { asap: 'As soon as possible', week: 'Within a week', flexible: 'Flexible' };

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.statusCode = 405; return res.end(); }
  var body = mail.readJson(req);
  var id = body && typeof body.id === 'string' ? body.id : '';
  if (!UUID.test(id)) { res.statusCode = 400; return res.end(); }

  var cfg = mail.config();
  if (!cfg.ready) { res.statusCode = 503; return res.end(); }            // email not set up yet: the inquiry itself is safe in the database

  // claim the notification (works once, only for real inquiries)
  var claim;
  try {
    var r = await fetch(mail.SB_URL + '/rest/v1/rpc/claim_inquiry_notification', {
      method: 'POST',
      headers: { apikey: mail.SB_KEY, Authorization: 'Bearer ' + mail.SB_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_id: id })
    });
    if (!r.ok) { res.statusCode = 502; return res.end(); }
    claim = await r.json();
  } catch (e) { res.statusCode = 502; return res.end(); }
  if (!claim) { res.statusCode = 204; return res.end(); }               // already sent, spam, or too old

  console.log('reply-to source:', cfg.replySource);
  var first = mail.line(claim.name, 100).split(' ')[0] || 'there';
  var errors = 0;

  if (cfg.team.length) {
    var lines = [
      'New quote request',
      '',
      'Name: ' + mail.line(claim.name, 200),
      'Company: ' + mail.line(claim.company, 200),
      'Email: ' + mail.line(claim.email, 254),
      'Phone: ' + (mail.line(claim.phone, 40) || '-'),
      'Market: ' + (MARKET[claim.market] || mail.line(claim.market, 20)),
      'Project type: ' + (TYPE[claim.project_type] || mail.line(claim.project_type, 30)),
      'Interested in: ' + (INTEREST[claim.interest] || mail.line(claim.interest, 30)),
      'Timing: ' + (TIMING[claim.timing] || '-'),
      'Files: ' + (Number(claim.file_count) || 0),
      '',
      'Description:',
      mail.text(claim.description, 5000),
      '',
      'Open it in the dashboard: ' + mail.SITE + '/admin.html'
    ];
    try {
      var teamSubject = 'New inquiry: ' + mail.line(claim.name, 60) + ' (' + mail.line(claim.company, 60) + ', ' + (MARKET[claim.market] || claim.market) + ')';
      var teamSent = await mail.sendMail(cfg, { to: cfg.team, subject: teamSubject, text: lines.join('\n'), replyTo: claim.email }, 'team-' + id);
      await mail.logAutomatic({ resend_id: teamSent && teamSent.id ? String(teamSent.id) : null, from_email: mail.addressOf(cfg.from), to_email: cfg.team.join(', ').slice(0, 500),
        subject: teamSubject, body_text: lines.join('\n'), inquiry_id: id });
    } catch (e) { errors++; console.error('team email failed', e.message); }
  }

  try {
    var confirmText = [
        'Hi ' + first + ',',
        '',
        'Thanks for sending your project details to QuantiDawn. We have received your request for ' + mail.line(claim.company, 120) +
          ' and will come back to you with a quote within one business day.',
        '',
        'If you have extra drawings or scope notes, just reply to this email and attach them.',
        '',
        'Kind regards,',
        'QuantiDawn',
        mail.SITE
      ].join('\n');
    var confirmSubject = 'We received your QuantiDawn quote request';
    var confirmSent = await mail.sendMail(cfg, { to: [mail.line(claim.email, 254)], subject: confirmSubject, text: confirmText, replyTo: cfg.replyTo }, 'client-' + id);
    await mail.logAutomatic({ resend_id: confirmSent && confirmSent.id ? String(confirmSent.id) : null, from_email: mail.addressOf(cfg.from), to_email: mail.line(claim.email, 254),
      subject: confirmSubject, body_text: confirmText, inquiry_id: id });
  } catch (e) { errors++; console.error('confirmation email failed', e.message); }

  res.statusCode = errors ? 502 : 204;
  res.end();
};
