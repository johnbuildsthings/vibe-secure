# Supabase row level security cookbook

Ready-to-adapt SQL for `check-database-rules` fixes. Replace `orders` and `user_id` with the real table and owner column. Put every fix in a **new** migration file; never edit a migration that may already have run.

How RLS works, in one paragraph: once row level security is on, Postgres hides every row unless a policy allows it. `using (…)` decides which existing rows a user can see, change or delete. `with check (…)` decides which rows a user can create, or what a row may look like after an update. `auth.uid()` is the id of the signed-in user, and is null for visitors who aren't signed in.

## 1. Owner-only table (each user sees and changes only their own rows)

```sql
alter table public.orders enable row level security;

-- Remove any open policy first (use the real policy name from the old migration).
drop policy if exists "allow all" on public.orders;

create policy "owners read their orders" on public.orders
  for select to authenticated using (auth.uid() = user_id);

create policy "owners create their orders" on public.orders
  for insert to authenticated with check (auth.uid() = user_id);

create policy "owners update their orders" on public.orders
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "owners delete their orders" on public.orders
  for delete to authenticated using (auth.uid() = user_id);
```

When the owner column is the primary key itself (a per-user table whose `id` references `auth.users`), use `auth.uid() = id`. Leave out the `insert` or `delete` policy if users should never create or delete rows themselves.

**May break:** browser queries that list other users' rows (admin screens, leaderboards, public profile pages) return nothing; inserts that don't set `user_id` are rejected. Admin views should move to a server route that uses the service-role key after checking the user is an admin.

## 2. Public read, owner-only write (posts, comments, public profiles)

```sql
alter table public.posts enable row level security;

create policy "anyone reads posts" on public.posts
  for select using (true);

create policy "authors create posts" on public.posts
  for insert to authenticated with check (auth.uid() = author_id);

create policy "authors update posts" on public.posts
  for update to authenticated using (auth.uid() = author_id) with check (auth.uid() = author_id);

create policy "authors delete posts" on public.posts
  for delete to authenticated using (auth.uid() = author_id);
```

Only do this when every column is fine to show to the world. If some columns are private (an email, a draft flag), either keep them in a separate owner-only table, or add a view with only the public columns, created `with (security_invoker = true)`, and make the table itself owner-only.

## 3. Protect privilege columns (role, is_admin, plan, credits)

A user who may update their own row can otherwise set `role = 'admin'` or `plan = 'pro'` on it. Pick one of these.

**a. Column grants (simplest).** Users may update only the listed columns:

```sql
revoke update on public.accounts from anon, authenticated;
grant update (display_name, avatar_url, bio) on public.accounts to authenticated;
```

**b. A trigger that rejects changes** (when the list of safe columns changes often):

```sql
create or replace function public.block_privilege_changes()
returns trigger language plpgsql as $$
begin
  if auth.role() <> 'service_role'
     and (new.role is distinct from old.role or new.plan is distinct from old.plan) then
    raise exception 'You can''t change this field';
  end if;
  return new;
end $$;

create trigger block_privilege_changes
  before update on public.accounts
  for each row execute function public.block_privilege_changes();
```

Also stop users from **creating** their row with a privilege already set: either don't allow `insert` (create the row with a trigger on `auth.users`), or grant insert only on the safe columns.

Privilege changes then happen only on the server, with the service-role key, after something trustworthy (a verified Stripe webhook, an admin action checked on the server).

**May break:** profile or settings forms that send the whole row (including `role` or `plan`) fail until they send only the editable fields.

## 4. Tables nobody should reach from the browser

For internal tables only the server uses:

```sql
alter table public.audit_log enable row level security;
-- No policies: the public API can't read or write it. The service-role key still can.
revoke all on public.audit_log from anon, authenticated;
```

## 5. Views

A view in `public` runs with its creator's rights and ignores the underlying table's RLS. Recreate it so it uses the caller's rights (Postgres 15+):

```sql
create or replace view public.order_summaries with (security_invoker = true) as
  select id, user_id, total from public.orders;
```

## Applying a fix

1. Save the SQL as `supabase/migrations/<YYYYMMDDHHMMSS>_<short_name>.sql`.
2. Run it: `supabase db push`, or open the Supabase dashboard → **SQL Editor** → paste → **Run**.
3. Check it: in the dashboard → **Table Editor** → the table → the RLS badge should say "RLS enabled", and **Authentication → Policies** should list the new policies.

## Dashboard checklist

Use these as `manual_steps` for `db.write-unverified` (the tables live only in the dashboard, so the code can't show their rules):

1. Open supabase.com/dashboard and choose your project.
2. Go to **Database → Tables** (or **Table Editor**). For every table in the `public` schema, check that it shows "RLS enabled". A table marked "RLS disabled" (or "Unrestricted") can be read and changed by anyone with your public key.
3. Go to **Authentication → Policies**. For each table that holds user data, check that no policy uses `true` as its condition, and that read/update/delete policies compare the owner column to `auth.uid()`.
4. For tables with columns like `role`, `is_admin` or `plan`, check that users can't update those columns (column grants or a trigger).
5. Go to **Advisors → Security Advisor** and fix every "RLS disabled in public" or "Security definer view" warning.
6. Optional but recommended: run `supabase db pull` to save your current schema and policies as a migration, so the next audit can check them.
