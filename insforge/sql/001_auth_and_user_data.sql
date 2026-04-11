-- StudyFlow AI auth and user-owned data schema
create table if not exists public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  onboarding_completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.study_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  source_file_name text not null,
  storage_path text,
  extracted_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_study_documents_user_id on public.study_documents(user_id);
create index if not exists idx_study_documents_created_at on public.study_documents(created_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as 'begin new.updated_at = now(); return new; end;';

drop trigger if exists set_user_settings_updated_at on public.user_settings;
create trigger set_user_settings_updated_at
before update on public.user_settings
for each row
execute function public.set_updated_at();

drop trigger if exists set_study_documents_updated_at on public.study_documents;
create trigger set_study_documents_updated_at
before update on public.study_documents
for each row
execute function public.set_updated_at();

alter table public.user_settings enable row level security;
alter table public.study_documents enable row level security;

drop policy if exists user_settings_select_own on public.user_settings;
create policy user_settings_select_own
on public.user_settings
for select
using (auth.uid() = user_id);

drop policy if exists user_settings_insert_own on public.user_settings;
create policy user_settings_insert_own
on public.user_settings
for insert
with check (auth.uid() = user_id);

drop policy if exists user_settings_update_own on public.user_settings;
create policy user_settings_update_own
on public.user_settings
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists study_documents_select_own on public.study_documents;
create policy study_documents_select_own
on public.study_documents
for select
using (auth.uid() = user_id);

drop policy if exists study_documents_insert_own on public.study_documents;
create policy study_documents_insert_own
on public.study_documents
for insert
with check (auth.uid() = user_id);

drop policy if exists study_documents_update_own on public.study_documents;
create policy study_documents_update_own
on public.study_documents
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists study_documents_delete_own on public.study_documents;
create policy study_documents_delete_own
on public.study_documents
for delete
using (auth.uid() = user_id);

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.user_settings to authenticated;
grant select, insert, update, delete on public.study_documents to authenticated;

-- Note: InsForge blocks trigger management on auth schema.
-- The app creates missing user_settings rows right after sign-up/sign-in.
