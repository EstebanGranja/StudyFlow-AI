-- StudyFlow AI MVP: plan metadata and processing status

alter table public.study_plans add column if not exists description text;
alter table public.study_plans add column if not exists nivel text;
alter table public.study_plans add column if not exists status text not null default 'processing';

update public.study_plans
set status = 'processing'
where status is null
   or status not in ('processing', 'done', 'error');

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'study_plans_status_check'
      and conrelid = 'public.study_plans'::regclass
  ) then
    alter table public.study_plans
      add constraint study_plans_status_check
      check (status in ('processing', 'done', 'error'));
  end if;
end;
$$;

create index if not exists idx_study_plans_status on public.study_plans(status);
create index if not exists idx_study_plans_user_status on public.study_plans(user_id, status);
