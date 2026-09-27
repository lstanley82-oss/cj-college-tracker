# CJ's College Tracker: Live Build

Black Track Editorial front end + Supabase shared database + GitHub Pages hosting.

## Architecture

- GitHub Pages: static HTML/CSS/JS hosting
- Supabase Auth: individual family logins
- Supabase Postgres: shared family data
- Supabase Row Level Security: only family members can read/write tracker data

## Security rule

`config.js` uses the public Supabase publishable key. That is normal for browser apps when RLS is enabled.

**Never put the Supabase `secret` key in GitHub or browser code.**

## Setup order

1. Create a NEW Supabase project.
2. Run `supabase_schema.sql` in Supabase SQL Editor.
3. In Supabase Authentication settings, enable Email/Password.
4. Create or invite the three users.
5. Copy their Auth user UUIDs.
6. Insert those UUIDs into `public.family_members` using the example at the bottom of the SQL file.
7. In Supabase Connect dialog or Settings > API Keys, copy:
   - Project URL
   - publishable key
8. Paste them into `config.js`.
9. Create a GitHub repository such as `cj-college-tracker`.
10. Upload the contents of this folder to the repository root.
11. In GitHub: Settings > Pages > Deploy from a branch > `main` > `/ (root)`.
12. Open the GitHub Pages URL and sign in.

## First release scope

Working now:
- Login
- Shared family access
- Dashboard
- Add tasks
- Add colleges
- Add recruiting contacts
- Add scholarships
- Financial comparison from college cost data

Next release:
- Edit/delete records
- Task comments
- Recruiting communication log
- College rating details
- Automatic follow-up task creation
- Activity log writes
- Essay/recommendation/test/document sections
- Better mobile action flow

The goal of this package is to prove the live architecture before adding every feature.
