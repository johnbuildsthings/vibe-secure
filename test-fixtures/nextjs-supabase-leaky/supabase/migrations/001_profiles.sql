create table public.profiles (
  id uuid primary key references auth.users (id),
  name text,
  email text,
  bio text,
  plan text default 'free'
);

alter table public.profiles disable row level security;
