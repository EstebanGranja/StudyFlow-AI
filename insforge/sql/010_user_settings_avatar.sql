-- StudyFlow AI user profile avatar support
alter table if exists public.user_settings
add column if not exists avatar_url text;
