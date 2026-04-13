-- StudyFlow AI: persistent manual order for study documents

alter table public.study_documents
  add column if not exists display_order integer;

with ranked_documents as (
  select
    id,
    row_number() over (
      partition by plan_id
      order by created_at desc, id desc
    ) - 1 as computed_display_order
  from public.study_documents
)
update public.study_documents as documents
set display_order = ranked_documents.computed_display_order
from ranked_documents
where documents.id = ranked_documents.id
  and (documents.display_order is null or documents.display_order < 0);

update public.study_documents
set display_order = 0
where display_order is null
   or display_order < 0;

alter table public.study_documents
  alter column display_order set default 0,
  alter column display_order set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'study_documents_display_order_check'
      and conrelid = 'public.study_documents'::regclass
  ) then
    alter table public.study_documents
      add constraint study_documents_display_order_check
      check (display_order >= 0);
  end if;
end;
$$;

create index if not exists idx_study_documents_plan_display_order
  on public.study_documents(plan_id, display_order asc, created_at asc);
