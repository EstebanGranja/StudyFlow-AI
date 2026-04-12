-- StudyFlow AI: async queue for document processing

create table if not exists public.study_document_jobs (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.study_documents(id) on delete cascade,
  plan_id uuid references public.study_plans(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'queued',
  attempt_count integer not null default 0,
  max_attempts integer not null default 5,
  available_at timestamptz not null default now(),
  leased_at timestamptz,
  lease_expires_at timestamptz,
  worker_id text,
  last_error text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint study_document_jobs_status_check
    check (status in ('queued', 'processing', 'done', 'error')),
  constraint study_document_jobs_attempt_count_check
    check (attempt_count >= 0),
  constraint study_document_jobs_max_attempts_check
    check (max_attempts >= 1)
);

create index if not exists idx_study_document_jobs_user_status_available
  on public.study_document_jobs(user_id, status, available_at);

create index if not exists idx_study_document_jobs_document_id
  on public.study_document_jobs(document_id);

create index if not exists idx_study_document_jobs_plan_id
  on public.study_document_jobs(plan_id);

create unique index if not exists idx_study_document_jobs_one_active_per_document
  on public.study_document_jobs(document_id)
  where status in ('queued', 'processing');

insert into public.study_document_jobs (document_id, plan_id, user_id, status, available_at)
select d.id, d.plan_id, d.user_id, 'queued', now()
from public.study_documents d
where d.status in ('pending', 'processing')
  and not exists (
    select 1
    from public.study_document_jobs j
    where j.document_id = d.id
      and j.status in ('queued', 'processing')
  );

alter table public.study_document_jobs enable row level security;

drop policy if exists study_document_jobs_select_own on public.study_document_jobs;
create policy study_document_jobs_select_own
on public.study_document_jobs
for select
using (auth.uid() = user_id);

drop policy if exists study_document_jobs_insert_own on public.study_document_jobs;
create policy study_document_jobs_insert_own
on public.study_document_jobs
for insert
with check (auth.uid() = user_id);

drop policy if exists study_document_jobs_update_own on public.study_document_jobs;
create policy study_document_jobs_update_own
on public.study_document_jobs
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists study_document_jobs_delete_own on public.study_document_jobs;
create policy study_document_jobs_delete_own
on public.study_document_jobs
for delete
using (auth.uid() = user_id);

grant select, insert, update, delete on public.study_document_jobs to authenticated;
