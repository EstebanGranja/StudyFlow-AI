-- StudyFlow AI: reading progress by document pages

alter table public.study_documents
  add column if not exists pages_read integer;

update public.study_documents
set pages_read = 0
where pages_read is null
   or pages_read < 0;

alter table public.study_documents
  alter column pages_read set default 0,
  alter column pages_read set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'study_documents_pages_read_check'
      and conrelid = 'public.study_documents'::regclass
  ) then
    alter table public.study_documents
      add constraint study_documents_pages_read_check
      check (pages_read >= 0);
  end if;
end;
$$;

create index if not exists idx_study_documents_pages_read
  on public.study_documents(pages_read);
