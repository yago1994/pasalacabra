-- Pasalacabra — accounts, stats and (stubbed) subscriptions.
--
-- Run this once in the Supabase SQL editor (or `supabase db push`).
-- It is written to be re-runnable: every object is created if missing.

-- ---------------------------------------------------------------------------
-- profiles: one row per auth user, created automatically on sign-up.
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  -- Subscription. Stripe is not wired yet: `is_subscriber` is flipped by hand
  -- (or by the dev switch in the app when VITE_ALLOW_SUB_STUB is on) until the
  -- Stripe webhook lands and starts writing these columns itself.
  is_subscriber boolean not null default false,
  subscription_source text not null default 'none'
    check (subscription_source in ('none', 'stub', 'stripe')),
  subscription_status text,
  subscription_period_end timestamptz,
  stripe_customer_id text
);

alter table public.profiles enable row level security;

drop policy if exists "profiles are readable by their owner" on public.profiles;
create policy "profiles are readable by their owner"
  on public.profiles for select
  using (auth.uid() = id);

drop policy if exists "profiles are updatable by their owner" on public.profiles;
create policy "profiles are updatable by their owner"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- A user must never be able to make themselves a subscriber from the browser.
-- The anon/authenticated roles get every column except the subscription ones.
revoke update on public.profiles from anon, authenticated;
grant update (display_name) on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- game_results: one row per rosco played.
--
-- `attempt` is 1 for the first time a user plays a given rosco and grows on
-- replays. Stats only ever count attempt = 1 so that replaying an old rosco
-- cannot inflate your averages.
-- ---------------------------------------------------------------------------
create table if not exists public.game_results (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  game_no integer not null,
  attempt integer not null default 1,
  played_at timestamptz not null default now(),
  set_id text not null default 'set_01',
  difficulty text not null default 'medio',
  correct_count integer not null default 0,
  wrong_count integer not null default 0,
  passed_count integer not null default 0,
  unanswered_count integer not null default 0,
  seconds_used integer,
  -- { "A": "correct" | "wrong" | "passed" | "pending", ... } — 25 Spanish letters.
  letters jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (user_id, game_no, attempt)
);

create index if not exists game_results_user_game_idx
  on public.game_results (user_id, game_no desc);

alter table public.game_results enable row level security;

drop policy if exists "results are readable by their owner" on public.game_results;
create policy "results are readable by their owner"
  on public.game_results for select
  using (auth.uid() = user_id);

drop policy if exists "results are insertable by their owner" on public.game_results;
create policy "results are insertable by their owner"
  on public.game_results for insert
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Create the profile row the moment a user signs up.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name',
      split_part(new.email, '@', 1)
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Subscription stub.
--
-- Until Stripe is wired, this is how a user becomes a subscriber. The app calls
-- it only when VITE_ALLOW_SUB_STUB is set at build time (staging / local), and
-- the function refuses to run for anyone but the caller themselves.
-- Drop this function the day the Stripe webhook goes live.
-- ---------------------------------------------------------------------------
create or replace function public.set_subscription_stub(active boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;

  update public.profiles
  set is_subscriber = active,
      subscription_source = case when active then 'stub' else 'none' end,
      subscription_status = case when active then 'active' else null end,
      subscription_period_end = case when active then now() + interval '30 days' else null end
  where id = auth.uid();
end;
$$;

grant execute on function public.set_subscription_stub(boolean) to authenticated;
