# Connecting QuantiDawn to Supabase (quote inbox + team dashboard)

The public quote form saves inquiries to a Supabase project, and `admin.html` is the private
dashboard where your team reads them. Until `config.js` has a project URL, the form only
simulates sending and the dashboard shows sample data ("Preview mode").

## One-time setup (about 10 minutes)

1. **Create a Supabase project** for QuantiDawn (a separate project from any other business).
2. **Run the two SQL files** in the project's SQL editor, in this order:
   1. `backend/quote-inbox.sql` - the leads table and the private bucket for uploaded plans.
   2. `backend/admin-dashboard.sql` - the admin accounts, extra dashboard fields and access rules.
3. **Create your login:** Authentication > Users > Add user > Create new user. Enter your email and a
   strong password and tick **Auto Confirm User**.
4. **Make that user an admin** (SQL editor; change the email):
   ```sql
   insert into public.admins (user_id, email)
   select id, email from auth.users where email = 'you@example.com'
   on conflict (user_id) do nothing;
   ```
5. **Turn off public sign-ups:** Authentication > Sign In / Providers > switch off "Allow new users to sign up".
6. **Connect the site:** open `config.js` and set `url` (Project Settings > API > Project URL) and `key`
   (the **publishable** key, `sb_publishable_...`, or the legacy `anon` key). Never use the `service_role` /
   secret key in this file.
7. **Test:** send a test inquiry from `get-a-quote.html`, then sign in at `admin.html`. You should see it in
   the Inquiries tab, and open the uploaded file from its detail panel.

## Spam protection
Run `backend/spam-guard.sql` once. It adds rules inside the database (so they cannot be bypassed by calling the
API directly): a fourth request from one email in an hour, or more than 40 requests in ten minutes, is refused;
requests with 3 or more links, spam wording, a disposable email address or text copied from another sender are
still saved but marked **Spam** with the reason in Notes; plan files can only be uploaded to the expected path.
Review the **Spam** filter in the Inquiries tab now and then, and set the status back to restore a real lead.
The form also has a hidden honeypot field and a 4-second time trap.

## Email with Resend (notifications + Inbox)
Run `backend/email.sql` and `backend/inbox.sql` once in the SQL editor.

**1. Resend.** Create an account, add the domain `quantidawn.com`, add the DNS records Resend shows, wait for
"Verified", and create an API key with **Full access** (needed to read received mail).

**2. Receiving.** Resend gives you a receiving address like `anything@<your-id>.resend.app` (no DNS needed; find
it in Resend > Emails > Receiving). Use it as `REPLY_TO` so client replies land in the dashboard **Inbox**. Do not
point Resend receiving at the root domain if it already has MX records for another mail provider.

**3. Webhook.** In Resend > Webhooks add `https://www.quantidawn.com/api/webhooks/resend` (it **must** be `www`:
the bare domain redirects and Resend does not follow redirects). Tick `email.received`, `email.sent`,
`email.delivered`, `email.bounced`, `email.failed`. Copy the signing secret (`whsec_...`).

**4. Vercel** (Project > Settings > Environment Variables, Production), then redeploy:

| Name | Example | What it does |
|------|---------|--------------|
| `RESEND_API_KEY` | `re_...` | Resend key, Full access (secret) |
| `MAIL_FROM` | `QuantiDawn <estimates@quantidawn.com>` | sender; must be on the verified domain |
| `TEAM_EMAILS` | `you@quantidawn.com, ops@quantidawn.com` | inboxes that get a note for every new inquiry |
| `REPLY_TO` | `inbox@<your-id>.resend.app` | where replies go; must be an address Resend receives for |
| `RESEND_WEBHOOK_SECRET` | `whsec_...` | verifies webhook calls are really from Resend (secret) |
| `SUPABASE_SERVICE_ROLE_KEY` | `eyJ...` | lets the webhook write received mail; Supabase > Project Settings > API (secret, server only) |

**What you get.** New real inquiries email the team and send the sender a confirmation. In the dashboard, the
**Inbox** tab has Inbox, Sent, Starred, Archive, Trash and All mail, search, bulk actions, reply in the same thread,
delivery status (Sent, Delivered, Bounced, Failed), a saved signature and a formatting toolbar. Delete moves to
Trash; only "Delete forever" or "Empty Trash" removes a message. **Send from dashboard** in an inquiry emails the
client and logs it in the Inbox too. Received HTML is shown in a locked-down sandbox and never runs scripts.

**Limits.** Attachments are not stored or shown. The automatic team note and client confirmation are not recorded in
the Inbox (only mail sent from the dashboard and mail received are). Search covers sender, recipient and subject of
the latest 500 messages. Trash is never purged automatically. Without the settings above the site works as before
and the dashboard explains that email is not set up.

## Traffic analytics (optional)
Run `backend/analytics.sql` in the SQL editor to turn on the dashboard's **Traffic** tab. The public pages
load `track.js`, which sends page views, clicks, time on page and scroll depth to the `/api/collect` Vercel
Function; that adds the visitor's country and stores the event in `public.page_events`. Nothing personal is
stored (no IP, no cookies), and only admins can read it. To keep 13 months of data, run
`delete from public.page_events where created_at < now() - interval '13 months';` now and then.

## Adding or removing a teammate
Run `backend/manage-admins.sql` once to turn on the **Team** panel in Tools, where you can see
everyone with dashboard access, add someone by email, and remove someone - all without opening
the SQL editor again. Adding still needs their account to exist first: have them sign in with
Google once, or create their login yourself (step 3) for an email/password teammate.

Without `manage-admins.sql`, or to remove your own access (the dashboard won't let you do that,
to prevent locking everyone out by accident), use the SQL editor: create their user (step 3), then
run the `insert into public.admins ...` line with their email (step 4); to remove access, delete
their row from `public.admins`.

## How it is protected
* The website can only **add** new inquiries and **upload** plans. With the public key it cannot read,
  change or delete anything.
* Only signed-in users listed in `public.admins` can read, edit or delete inquiries or open plans. This is
  enforced in the database (Row Level Security), so it holds even if someone finds `admin.html`.
* `admin.html` is marked `noindex`, is not in the sitemap and is not linked anywhere on the site.
* Text from the public form is shown in the dashboard as plain text only, so a hostile submission cannot run code.

## Things to know
* **Free plan projects pause after about a week without activity**, which would stop the form from saving
  leads. Use a paid plan for a live site.
* **Email alerts for new inquiries are not included.** Add a database webhook plus an email service (for
  example Resend) if you want an email per inquiry.
* **Dashboard settings and reply-template edits** are stored in the browser you use, not shared between teammates.
* Update the Privacy Policy and Cookie Policy if you add analytics or any other tracking.
