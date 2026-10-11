begin;
alter table public.club_notices drop constraint club_notices_tournament_id_fkey;
alter table public.club_notices add constraint club_notices_tournament_id_fkey foreign key(tournament_id) references public.tournaments(id) on delete set null;
create function vmgc_push.detach_deleted_tournament() returns trigger language plpgsql security definer set search_path='' as $$
begin
 update public.club_notices set destination='panel.html' where tournament_id=old.id;
 update vmgc_push.deliveries set status='cancelled',last_error='TOURNAMENT_DELETED'
 where status='pending' and notice_id in(select id from public.club_notices where tournament_id=old.id);
 return old;
end;$$;
revoke all on function vmgc_push.detach_deleted_tournament() from public,anon,authenticated;
create trigger tournament_push_detach before delete on public.tournaments for each row execute function vmgc_push.detach_deleted_tournament();
commit;
