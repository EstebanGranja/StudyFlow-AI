-- StudyFlow AI user profile background theme support
alter table if exists public.user_settings
add column if not exists background_theme text;

update public.user_settings
set background_theme = 'celeste'
where background_theme is null or trim(background_theme) = '';

alter table if exists public.user_settings
alter column background_theme set default 'celeste';

alter table if exists public.user_settings
alter column background_theme set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'user_settings_background_theme_check'
  ) then
    alter table public.user_settings
    add constraint user_settings_background_theme_check
    check (background_theme in ('celeste', 'rojo', 'amarillo', 'violeta'));
  end if;
end
$$;
