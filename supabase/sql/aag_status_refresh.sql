-- Verifica todos los jueves el estado remoto de los torneos exportados a AAG.
-- pg_cron usa UTC: 15:00 UTC = 12:00 Argentina.

create or replace function public.run_refresh_aag_statuses()
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_cron_secret text;
begin
  select decrypted_secret
    into v_cron_secret
  from vault.decrypted_secrets
  where name = 'aag_cron_secret'
  limit 1;

  if v_cron_secret is null or btrim(v_cron_secret) = '' then
    raise exception 'No se encontró el secreto aag_cron_secret en Vault';
  end if;

  perform net.http_post(
    url := 'https://bnnfolhrqxgxjmobclrm.supabase.co/functions/v1/swift-worker',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', v_cron_secret
    ),
    body := jsonb_build_object('action', 'refresh_all_exports')
  );
end;
$function$;

revoke all on function public.run_refresh_aag_statuses() from public, anon, authenticated;
grant execute on function public.run_refresh_aag_statuses() to postgres, service_role;

-- Ejecutado en producción como trabajo: refresh-aag-export-statuses
-- schedule: 0 15 * * 4

