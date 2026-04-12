-- StudyFlow AI MVP study model (plans -> documents -> topics)

create table if not exists public.study_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  nombre text not null,
  fecha_examen timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.study_documents (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.study_plans(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  nombre text not null,
  file_url text not null,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  constraint study_documents_status_check
    check (status in ('pending', 'processing', 'done', 'error'))
);

-- Compatibility layer for legacy study_documents schema from 001_auth_and_user_data.sql
alter table public.study_documents add column if not exists plan_id uuid;
alter table public.study_documents add column if not exists nombre text;
alter table public.study_documents add column if not exists file_url text;
alter table public.study_documents add column if not exists status text not null default 'pending';
alter table public.study_documents add column if not exists created_at timestamptz not null default now();

update public.study_documents
set nombre = coalesce(nombre, title)
where nombre is null;

update public.study_documents
set file_url = coalesce(file_url, storage_path, source_file_name)
where file_url is null;

update public.study_documents
set status = 'pending'
where status is null
  or status not in ('pending', 'processing', 'done', 'error');

alter table public.study_documents
  alter column status set default 'pending',
  alter column created_at set default now(),
  alter column nombre set not null,
  alter column file_url set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'study_documents_plan_id_fkey'
      and conrelid = 'public.study_documents'::regclass
  ) then
    alter table public.study_documents
      add constraint study_documents_plan_id_fkey
      foreign key (plan_id)
      references public.study_plans(id)
      on delete cascade;
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'study_documents_status_check'
      and conrelid = 'public.study_documents'::regclass
  ) then
    alter table public.study_documents
      add constraint study_documents_status_check
      check (status in ('pending', 'processing', 'done', 'error'));
  end if;
end;
$$;

create table if not exists public.topics (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.study_documents(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  titulo text not null,
  resumen text,
  puntos_clave jsonb not null default '[]'::jsonb,
  orden integer not null default 0,
  estado text not null default 'pendiente',
  created_at timestamptz not null default now(),
  constraint topics_estado_check
    check (estado in ('pendiente', 'completado'))
);

create index if not exists idx_study_plans_user_id on public.study_plans(user_id);
create index if not exists idx_study_plans_created_at on public.study_plans(created_at desc);

create index if not exists idx_study_documents_user_id on public.study_documents(user_id);
create index if not exists idx_study_documents_plan_id on public.study_documents(plan_id);
create index if not exists idx_study_documents_status on public.study_documents(status);
create index if not exists idx_study_documents_created_at on public.study_documents(created_at desc);

create index if not exists idx_topics_user_id on public.topics(user_id);
create index if not exists idx_topics_document_id on public.topics(document_id);
create index if not exists idx_topics_document_order on public.topics(document_id, orden);
create index if not exists idx_topics_estado on public.topics(estado);
create index if not exists idx_topics_created_at on public.topics(created_at desc);

alter table public.study_plans enable row level security;
alter table public.study_documents enable row level security;
alter table public.topics enable row level security;

drop policy if exists study_plans_select_own on public.study_plans;
create policy study_plans_select_own
on public.study_plans
for select
using (auth.uid() = user_id);

drop policy if exists study_plans_insert_own on public.study_plans;
create policy study_plans_insert_own
on public.study_plans
for insert
with check (auth.uid() = user_id);

drop policy if exists study_plans_update_own on public.study_plans;
create policy study_plans_update_own
on public.study_plans
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists study_plans_delete_own on public.study_plans;
create policy study_plans_delete_own
on public.study_plans
for delete
using (auth.uid() = user_id);

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

drop policy if exists topics_select_own on public.topics;
create policy topics_select_own
on public.topics
for select
using (auth.uid() = user_id);

drop policy if exists topics_insert_own on public.topics;
create policy topics_insert_own
on public.topics
for insert
with check (auth.uid() = user_id);

drop policy if exists topics_update_own on public.topics;
create policy topics_update_own
on public.topics
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists topics_delete_own on public.topics;
create policy topics_delete_own
on public.topics
for delete
using (auth.uid() = user_id);

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.study_plans to authenticated;
grant select, insert, update, delete on public.study_documents to authenticated;
grant select, insert, update, delete on public.topics to authenticated;
