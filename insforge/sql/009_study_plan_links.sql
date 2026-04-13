-- StudyFlow AI: utility links attached to study plans

create table if not exists public.study_plan_links (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.study_plans(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  nombre text not null,
  url text not null,
  site_name text,
  created_at timestamptz not null default now(),
  constraint study_plan_links_url_check
    check (url ~* '^https?://')
);

create index if not exists idx_study_plan_links_plan_id
  on public.study_plan_links(plan_id);

create index if not exists idx_study_plan_links_user_id
  on public.study_plan_links(user_id);

create index if not exists idx_study_plan_links_created_at
  on public.study_plan_links(created_at desc);

alter table public.study_plan_links enable row level security;

drop policy if exists study_plan_links_select_own on public.study_plan_links;
create policy study_plan_links_select_own
on public.study_plan_links
for select
using (auth.uid() = user_id);

drop policy if exists study_plan_links_insert_own on public.study_plan_links;
create policy study_plan_links_insert_own
on public.study_plan_links
for insert
with check (auth.uid() = user_id);

drop policy if exists study_plan_links_update_own on public.study_plan_links;
create policy study_plan_links_update_own
on public.study_plan_links
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists study_plan_links_delete_own on public.study_plan_links;
create policy study_plan_links_delete_own
on public.study_plan_links
for delete
using (auth.uid() = user_id);

grant select, insert, update, delete on public.study_plan_links to authenticated;
