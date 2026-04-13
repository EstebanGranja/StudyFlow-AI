-- StudyFlow AI: ensure optional exam date exists in study plans

alter table public.study_plans
  add column if not exists fecha_examen timestamptz;