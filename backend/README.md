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

## Adding or removing a teammate
Create their user (step 3), then run the `insert into public.admins ...` line with their email (step 4).
To remove access, delete their row from `public.admins`.

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
