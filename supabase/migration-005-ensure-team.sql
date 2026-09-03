-- Estudio migration 005. Bootstrapping a team without depending on client side policies.
--
-- Creating your very first team is a chicken and egg problem: the read policy asks whether
-- you are a member, and you cannot be a member of a team that does not exist yet. Doing it
-- from the client means threading that needle through several policies at once.
--
-- So the client stops inserting into teams entirely and calls this instead. It runs as the
-- function owner, which owns the tables, so row level security does not apply inside it.
-- Safe to run more than once.

create or replace function public.ensure_team(team_name text default 'My team')
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  my_email text;
  existing uuid;
  fresh uuid;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;

  -- Any pending invitation for this address becomes a real membership first.
  perform public.claim_invites();

  select team_id into existing
  from team_members
  where user_id = uid
  order by created_at
  limit 1;

  if existing is not null then
    return existing;
  end if;

  select email into my_email from auth.users where id = uid;

  insert into teams (name, created_by) values (team_name, uid) returning id into fresh;

  insert into team_members (team_id, user_id, email, role)
  values (fresh, uid, my_email, 'owner')
  on conflict (team_id, user_id) do nothing;

  return fresh;
end;
$$;

revoke all on function public.ensure_team(text) from public;
grant execute on function public.ensure_team(text) to authenticated;
grant execute on function public.claim_invites() to authenticated;

-- Reading a team you created must not depend on the membership row existing yet.
drop policy if exists "teams read" on teams;
create policy "teams read" on teams
  for select to authenticated
  using (created_by = auth.uid() or is_team_member(id));
