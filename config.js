/* QuantiDawn backend settings: the ONE place to connect the quote form and the dashboard.
   Fill in the Supabase project URL and its PUBLISHABLE (anon) key. Both are safe to expose,
   because Row Level Security decides what each visitor can do. Never put a secret or
   service_role key here. While `url` is empty, the quote form only simulates sending and
   the dashboard shows sample data. */
window.QUANTIDAWN_BACKEND = Object.assign({
  url: 'https://bkgyweosuoskpgwenpaq.supabase.co',
  key: 'sb_publishable_D9l8UY0DwJTZilTk-Yhd_g_pH41XWf_'
}, window.QUANTIDAWN_BACKEND);
