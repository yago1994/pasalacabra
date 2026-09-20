# Setting up Supabase for Pasalacabra

Everything the accounts + stats feature needs, start to finish. Takes about
30–40 minutes, most of it waiting on Google's OAuth screens.

Until step 6 is done the app runs exactly as before: no sign-in entry points,
results in `localStorage`. Nothing here is destructive to the live site.

Dashboard menu names move around between Supabase releases; where a label has
changed recently both names are given.

---

## 1. Create the project

1. Go to <https://supabase.com/dashboard> and **New project**.
2. Organisation: your own. Name: `pasalacabra`.
3. **Database password**: generate one and put it in your password manager. You
   will not need it for the app (the app only uses the anon key), but you cannot
   recover it later.
4. **Region**: pick the one closest to the players — `West EU (Ireland)` or
   `Central EU (Frankfurt)` for a mostly-Spanish audience. This cannot be
   changed afterwards without recreating the project.
5. Plan: the free tier is enough. It pauses a project after ~1 week with zero
   requests, which matters for a staging project you touch rarely — a paused
   project resumes from the dashboard.

Wait for provisioning (~2 min).

> **One project or two?** One is fine to start: prod and staging share the data.
> If you want them separate, repeat this whole guide for a `pasalacabra-staging`
> project and give the staging build its own env vars. Two projects means two
> sets of Google OAuth credentials too.

---

## 2. Create the tables

1. **SQL Editor** → **New query**.
2. Paste the whole of [`schema.sql`](./schema.sql) and **Run**.
3. It should finish with "Success. No rows returned".

The script is re-runnable: running it again after you edit it will not drop
data. It creates:

| Object | What it is |
|---|---|
| `public.profiles` | One row per user: display name, subscription flags. |
| `public.game_results` | One row per rosco played. |
| `handle_new_user()` + trigger | Makes the profile row on sign-up. |
| `set_subscription_stub()` | Temporary, dev-only subscription switch. |
| RLS policies | Each user can read and write only their own rows. |

### Check it landed

**Table Editor** should list `profiles` and `game_results`, each with a green
**RLS enabled** badge. If a table says RLS is *disabled*, stop and re-run the
script — without it, anyone with the anon key can read every player's data.

Also confirm the browser cannot promote itself to subscriber:

```sql
-- Should return only display_name.
select column_name
from information_schema.column_privileges
where grantee = 'authenticated'
  and table_name = 'profiles'
  and privilege_type = 'UPDATE';
```

---

## 3. Turn on email sign-in (magic link)

1. **Authentication** → **Providers** (newer dashboards: **Sign In / Providers**).
2. **Email** is on by default. Open it and make sure:
   - **Enable Email provider**: on.
   - **Confirm email**: on.
   - **Enable email OTP / magic link**: on. The app calls `signInWithOtp`, so
     this is the one that matters; password sign-in is unused.
3. Leave **Secure email change** and the other defaults alone.

> **Before you launch**: Supabase's built-in email sender is heavily rate
> limited (a handful of messages per hour) and meant for development. Set up
> custom SMTP under **Project Settings → Authentication → SMTP Settings** with
> Resend, Postmark, SES or similar, using a sender address on your own domain.
> Without it, real players will silently not receive their link.

---

## 4. Turn on Google sign-in

### 4a. In Google Cloud

1. <https://console.cloud.google.com> → create a project (`pasalacabra`).
2. **APIs & Services** → **OAuth consent screen**:
   - User type **External**, then **Create**.
   - App name `Pasalacabra`, your support email, your contact email.
   - Scopes: the defaults (`email`, `profile`, `openid`) are all you need.
   - While the app is in **Testing**, only the test users you list can sign in.
     Add your own address. **Publish** the app when you are ready for players —
     with only those three scopes it does not need Google verification.
3. **APIs & Services** → **Credentials** → **Create credentials** → **OAuth
   client ID**:
   - Application type: **Web application**.
   - Name: `Pasalacabra web`.
   - **Authorised redirect URIs**: add exactly this, with your project ref:

     ```
     https://<project-ref>.supabase.co/auth/v1/callback
     ```

     The project ref is the subdomain in your project URL (Project Settings →
     API → Project URL). This is Supabase's callback, *not* your site.
4. Copy the **Client ID** and **Client secret**.

### 4b. In Supabase

1. **Authentication** → **Providers** → **Google** → enable.
2. Paste the client ID and secret. Save.

---

## 5. Set the redirect URLs

**Authentication** → **URL Configuration**.

- **Site URL**: `https://pasalacabra.com/`
- **Redirect URLs** — add each of these:

  ```
  https://pasalacabra.com/**
  https://yago1994.github.io/pasalacabra/**
  http://localhost:5173/**
  ```

The second line only matters if you open the GitHub Pages URL directly rather
than the custom domain; the staging build lives under `/staging/`, which the
`**` covers. The app computes its own redirect from `location.origin` plus the
Vite base path (`getAuthRedirectUrl` in `src/lib/supabase.ts`), so the staging
build returns to `/staging/` and local dev to `localhost:5173`.

A URL that is not on this list fails with `redirect_to is not allowed` after
the user has already authenticated — the most common setup mistake.

---

## 6. Wire the keys into the app

**Project Settings** → **API** (newer dashboards: **API Keys**). You need:

- **Project URL** → `VITE_SUPABASE_URL`
- **anon / public** key → `VITE_SUPABASE_ANON_KEY`

Never the **service_role** key. It bypasses RLS, and anything in a `VITE_`
variable is compiled into the JavaScript bundle and readable by everyone. The
anon key is *designed* to be public — RLS is what protects the data.

### Local

```bash
cp .env.example .env.local
```

Fill in the two values (plus `VITE_SPEECH_TOKEN_URL` if you want speech
locally). `.env.local` is gitignored.

### Deploys

GitHub → **Settings** → **Secrets and variables** → **Actions** → **Variables**
tab → **New repository variable**, twice:

| Name | Value |
|---|---|
| `VITE_SUPABASE_URL` | `https://<project-ref>.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | the anon key |

Repository *variables*, not secrets — GitHub masks secrets in logs, which is
pointless here and makes debugging a build harder. `.github/workflows/deploy.yml`
already reads both, and sets `VITE_ALLOW_SUB_STUB=true` on the `staging` branch
only.

Push to `staging` (or re-run the deploy workflow) to pick them up.

---

## 7. Check it end to end

```bash
npm run dev
```

1. **Sign in.** Home → "Tus estadísticas" → "Entrar" → Google. You should come
   back to `localhost:5173` already signed in. In the dashboard, **Table
   Editor → profiles** now has your row, with `display_name` filled from your
   Google name.
2. **Migration.** If you had played roscos on that browser before signing in,
   the profile shows "He añadido las N partidas que tenías en este móvil" and
   `game_results` has those rows.
3. **A new game.** Play the daily rosco to the end (needs
   `VITE_SPEECH_TOKEN_URL`, mic and camera permission — easier on staging than
   locally). A row appears in `game_results` with `attempt = 1`, the per-letter
   `letters` object, and `seconds_used`.
4. **Isolation.** Sign in as a second account and confirm it sees none of the
   first one's roscos. This is the test that actually proves RLS works.

---

## 8. Give yourself a subscription (while Stripe is stubbed)

On staging or local (`VITE_ALLOW_SUB_STUB=true`), the "Suscribirme" button in
"Roscos anteriores" calls `set_subscription_stub()` and flips your own flag.

On production, do it by hand:

```sql
update public.profiles
set is_subscriber = true,
    subscription_source = 'stub',
    subscription_status = 'active',
    subscription_period_end = now() + interval '30 days'
where id = (select id from auth.users where email = 'tu@correo.com');
```

To take it away, set `is_subscriber = false` and `subscription_source = 'none'`.

When Stripe lands: a webhook (Supabase Edge Function) writes those same columns
with `subscription_source = 'stripe'`, `VITE_ALLOW_SUB_STUB` goes away, and
`set_subscription_stub()` gets dropped:

```sql
drop function if exists public.set_subscription_stub(boolean);
```

---

## 9. Backups

**Database** → **Backups**. The free tier keeps daily backups for 7 days and has
no point-in-time recovery. Before any schema change on a project with real
players, take a manual snapshot:

```bash
npx supabase db dump --db-url "postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres" -f backup.sql
```

---

## Troubleshooting

**"Las cuentas no están configuradas."** — The build has no
`VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`. Vite only reads env vars at
build time: restart `npm run dev` after editing `.env.local`, and re-run the
deploy workflow after adding the repository variables.

**`redirect_to is not allowed`** — The URL is missing from step 5. Add the exact
origin with `/**`.

**Google says `redirect_uri_mismatch`** — Step 4a's redirect URI must be the
Supabase callback (`https://<ref>.supabase.co/auth/v1/callback`), not
`pasalacabra.com`.

**Google sign-in works for you, nobody else** — The consent screen is still in
**Testing**. Publish it.

**The magic link never arrives** — Built-in SMTP rate limit (step 3). Check
**Authentication → Logs**, and set up custom SMTP.

**The magic link opens a signed-out page** — It was opened on a different
device or browser than the one that requested it. The session lands wherever
the link is opened; that is expected, they just need to use the same phone.

**Signed in, but no stats** — Check the browser console for a Supabase error.
An empty read with no error usually means RLS: confirm `auth.uid() = user_id`
policies exist on `game_results` (step 2).

**Results stop saving after a while** — The free tier pauses a project after a
week of inactivity. Resume it from the dashboard. Note that when saving fails
the game itself is unaffected: the write is fire-and-forget by design, so a
rosco is never blocked by the network.

**A player's games vanished after signing in on a second device** — They should
not: the device list is only pushed once and then cleared, and duplicates are
skipped by the `(user_id, game_no, attempt)` unique constraint. If you see it,
grab the console output — that is a bug worth reporting.
