-- StudyFlow AI: basic metadata for uploaded PDFs

alter table public.study_documents
  add column if not exists page_count integer;

alter table public.study_documents
  add column if not exists file_size_bytes bigint;

create index if not exists idx_study_documents_file_size
  on public.study_documents(file_size_bytes)
  where file_size_bytes is not null;
