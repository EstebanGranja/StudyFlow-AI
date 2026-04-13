-- StudyFlow AI: expose aggregated study progress per plan for public profiles
-- without exposing full study_documents rows.

create or replace function public.get_user_plan_progress_summary(target_user_id uuid)
returns table (
  plan_id uuid,
  progress_percent integer
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'UNAUTHORIZED';
  end if;

  return query
  with progress_base as (
    select
      d.plan_id,
      sum(
        case
          when d.page_count is not null and d.page_count > 0 then d.page_count
          else 0
        end
      ) as total_pages,
      sum(
        case
          when d.page_count is not null and d.page_count > 0 then least(greatest(d.pages_read, 0), d.page_count)
          else 0
        end
      ) as read_pages
    from public.study_documents d
    where d.user_id = target_user_id
      and d.plan_id is not null
    group by d.plan_id
  )
  select
    progress_base.plan_id,
    case
      when progress_base.total_pages <= 0 then 0
      else least(
        100,
        greatest(
          0,
          round((progress_base.read_pages::numeric / progress_base.total_pages::numeric) * 100)::integer
        )
      )
    end as progress_percent
  from progress_base;
end;
$$;

revoke all on function public.get_user_plan_progress_summary(uuid) from public;
grant execute on function public.get_user_plan_progress_summary(uuid) to authenticated;
