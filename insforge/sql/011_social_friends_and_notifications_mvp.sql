-- StudyFlow AI social graph MVP: searchable profiles, friend requests and friendships.

create table if not exists public.user_public_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text not null,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_user_public_profiles_email_ci
  on public.user_public_profiles (lower(email));

create index if not exists idx_user_public_profiles_display_name_ci
  on public.user_public_profiles (lower(display_name));

drop trigger if exists set_user_public_profiles_updated_at on public.user_public_profiles;
create trigger set_user_public_profiles_updated_at
before update on public.user_public_profiles
for each row
execute function public.set_updated_at();

insert into public.user_public_profiles (user_id, email, display_name, avatar_url)
select
  users.id,
  coalesce(nullif(trim(users.email), ''), concat('usuario-', left(users.id::text, 8), '@sin-email.local')),
  coalesce(
    nullif(trim(settings.display_name), ''),
    split_part(coalesce(nullif(trim(users.email), ''), 'usuario'), '@', 1)
  ),
  settings.avatar_url
from auth.users as users
left join public.user_settings as settings
  on settings.user_id = users.id
on conflict (user_id)
do update set
  email = excluded.email,
  display_name = excluded.display_name,
  avatar_url = coalesce(excluded.avatar_url, public.user_public_profiles.avatar_url),
  updated_at = now();

alter table public.user_public_profiles enable row level security;

drop policy if exists user_public_profiles_select_authenticated on public.user_public_profiles;
create policy user_public_profiles_select_authenticated
on public.user_public_profiles
for select
using (auth.uid() is not null);

drop policy if exists user_public_profiles_insert_own on public.user_public_profiles;
create policy user_public_profiles_insert_own
on public.user_public_profiles
for insert
with check (auth.uid() = user_id);

drop policy if exists user_public_profiles_update_own on public.user_public_profiles;
create policy user_public_profiles_update_own
on public.user_public_profiles
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists user_public_profiles_delete_own on public.user_public_profiles;
create policy user_public_profiles_delete_own
on public.user_public_profiles
for delete
using (auth.uid() = user_id);

grant select, insert, update, delete on public.user_public_profiles to authenticated;

create table if not exists public.friend_requests (
  id uuid primary key default gen_random_uuid(),
  sender_user_id uuid not null references auth.users(id) on delete cascade,
  receiver_user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  constraint friend_requests_status_check
    check (status in ('pending', 'accepted', 'rejected', 'cancelled')),
  constraint friend_requests_distinct_users_check
    check (sender_user_id <> receiver_user_id)
);

create index if not exists idx_friend_requests_sender_status
  on public.friend_requests(sender_user_id, status, created_at desc);

create index if not exists idx_friend_requests_receiver_status
  on public.friend_requests(receiver_user_id, status, created_at desc);

create unique index if not exists idx_friend_requests_pending_pair
  on public.friend_requests (
    least(sender_user_id, receiver_user_id),
    greatest(sender_user_id, receiver_user_id)
  )
  where status = 'pending';

create or replace function public.set_friend_request_responded_at()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'pending' then
    new.responded_at = null;
  elsif old.status is distinct from new.status then
    new.responded_at = now();
  end if;

  return new;
end;
$$;

drop trigger if exists set_friend_request_responded_at on public.friend_requests;
create trigger set_friend_request_responded_at
before update on public.friend_requests
for each row
execute function public.set_friend_request_responded_at();

alter table public.friend_requests enable row level security;

drop policy if exists friend_requests_select_related on public.friend_requests;
create policy friend_requests_select_related
on public.friend_requests
for select
using (auth.uid() = sender_user_id or auth.uid() = receiver_user_id);

drop policy if exists friend_requests_insert_sender on public.friend_requests;
create policy friend_requests_insert_sender
on public.friend_requests
for insert
with check (auth.uid() = sender_user_id);

drop policy if exists friend_requests_update_receiver on public.friend_requests;
create policy friend_requests_update_receiver
on public.friend_requests
for update
using (auth.uid() = receiver_user_id)
with check (auth.uid() = receiver_user_id);

grant select, insert, update on public.friend_requests to authenticated;

create table if not exists public.friendships (
  id uuid primary key default gen_random_uuid(),
  user_a_id uuid not null references auth.users(id) on delete cascade,
  user_b_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint friendships_distinct_users_check
    check (user_a_id <> user_b_id),
  constraint friendships_ordered_pair_check
    check (user_a_id < user_b_id),
  constraint friendships_unique_pair
    unique (user_a_id, user_b_id)
);

create index if not exists idx_friendships_user_a_id on public.friendships(user_a_id);
create index if not exists idx_friendships_user_b_id on public.friendships(user_b_id);

alter table public.friendships enable row level security;

drop policy if exists friendships_select_related on public.friendships;
create policy friendships_select_related
on public.friendships
for select
using (auth.uid() = user_a_id or auth.uid() = user_b_id);

drop policy if exists friendships_insert_related on public.friendships;
create policy friendships_insert_related
on public.friendships
for insert
with check (auth.uid() = user_a_id or auth.uid() = user_b_id);

grant select, insert on public.friendships to authenticated;

-- Social profile viewing: allow authenticated users to read study plans.
drop policy if exists study_plans_select_own on public.study_plans;
drop policy if exists study_plans_select_authenticated on public.study_plans;
create policy study_plans_select_authenticated
on public.study_plans
for select
using (auth.uid() is not null);
