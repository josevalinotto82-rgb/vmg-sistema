
create table public.club_notice_hidden(user_id uuid not null references public.profiles(id) on delete cascade,notice_id uuid not null references public.club_notices(id) on delete cascade,primary key(user_id,notice_id));
create table public.club_notice_inbox_state(user_id uuid primary key references public.profiles(id) on delete cascade,cleared_at timestamptz not null default '-infinity');
alter table public.club_notice_hidden enable row level security;
alter table public.club_notice_inbox_state enable row level security;
grant select,insert,update on public.club_notice_hidden,public.club_notice_inbox_state to authenticated;
create policy own_hidden_read on public.club_notice_hidden for select to authenticated using(user_id=(select auth.uid()));
create policy own_hidden_insert on public.club_notice_hidden for insert to authenticated with check(user_id=(select auth.uid()));
create policy own_hidden_update on public.club_notice_hidden for update to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
create policy own_state_read on public.club_notice_inbox_state for select to authenticated using(user_id=(select auth.uid()));
create policy own_state_insert on public.club_notice_inbox_state for insert to authenticated with check(user_id=(select auth.uid()));
create policy own_state_update on public.club_notice_inbox_state for update to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
create function public.club_notice_inbox() returns setof public.club_notices language sql stable security invoker set search_path='' as $$
select n.* from public.club_notices n where n.created_at>coalesce((select cleared_at from public.club_notice_inbox_state where user_id=(select auth.uid())),'-infinity'::timestamptz)
and not exists(select 1 from public.club_notice_hidden h where h.user_id=(select auth.uid()) and h.notice_id=n.id)
order by n.created_at desc,n.id limit 50;$$;
create function public.club_notice_clear() returns void language sql security invoker set search_path='' as $$
insert into public.club_notice_inbox_state(user_id,cleared_at) values((select auth.uid()),now()) on conflict(user_id) do update set cleared_at=excluded.cleared_at;$$;
revoke all on function public.club_notice_inbox(),public.club_notice_clear() from public,anon;
grant execute on function public.club_notice_inbox(),public.club_notice_clear() to authenticated;
create or replace function vmgc_push.tournament_notice() returns trigger language plpgsql security definer set search_path='' as $$
begin
if new.data_schema_version=2 and new.published then
if new.status='open' and (old.status is distinct from 'open' or not old.published) then
insert into public.club_notices(title,body,destination,kind,tournament_id)
values('Inscripción abierta',left('Ya podés anotarte en '||new.name||'.',1000),'grilla_interactiva.html?torneo_id='||new.id,'registration',new.id)
on conflict(tournament_id,kind) do nothing;
elsif new.status='officialized' and (old.status is distinct from 'officialized' or not old.published) then
insert into public.club_notices(title,body,destination,kind,tournament_id)
values('Torneo disponible',left(new.name||' ya está disponible. Consultá el torneo y sus resultados disponibles.',1000),'torneos.html?id='||new.id,'officialized',new.id)
on conflict(tournament_id,kind) do nothing;
end if;end if;return new;end;$$;
update public.club_notices set title='Torneo disponible',body=replace(body,' ya fue oficializado.',' ya está disponible.') where kind='officialized';

