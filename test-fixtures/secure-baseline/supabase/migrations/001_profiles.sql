create table public.profiles (
  id uuid primary key references auth.users (id),
  name text,
  bio text,
  plan text default 'free'
);

alter table public.profiles enable row level security;

create policy "read own profile" on public.profiles
  for select using (auth.uid() = id);

create policy "update own profile" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- Users may edit their own name and bio, but never their plan.
revoke update on public.profiles from anon, authenticated;
grant update (name, bio) on public.profiles to authenticated;
