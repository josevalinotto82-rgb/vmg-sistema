create function public.push_device_current(p_token text,p_user uuid) returns boolean language sql security definer set search_path='' as $$select exists(select 1 from vmgc_push.devices where token=p_token and user_id=p_user and enabled);$$;
revoke all on function public.push_device_current(text,uuid) from public,anon,authenticated;
grant execute on function public.push_device_current(text,uuid) to service_role;
grant all on public.club_notices to service_role;
create or replace function public.push_finish(p_id bigint,p_success boolean,p_error text,p_invalid boolean default false) returns void language plpgsql security definer set search_path='' as $$
begin
update vmgc_push.deliveries set status=case when p_success then 'sent' when p_invalid or p_error='DEVICE_CHANGED' or attempts>=5 then 'failed' else 'pending' end,
last_error=left(p_error,100),available_at=now()+interval '3 minutes' where id=p_id;
if p_invalid then update vmgc_push.devices set enabled=false where token=(select token from vmgc_push.deliveries where id=p_id);end if;end;$$;
-- Tarea instalada en Supabase (referencia; no ejecutar de nuevo).
select cron.schedule('vmgc-club-notifications','* * * * *',$cron$select net.http_post(url:='https://bnnfolhrqxgxjmobclrm.supabase.co/functions/v1/club-notifications',headers:=jsonb_build_object('Content-Type','application/json','x-dispatch-key',(select decrypted_secret from vault.decrypted_secrets where name='vmgc_push_dispatch')),body:='{"action":"dispatch"}'::jsonb,timeout_milliseconds:=20000);$cron$);
