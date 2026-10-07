
create schema if not exists vmgc_push;
revoke all on schema vmgc_push from public,anon,authenticated;
create table if not exists public.club_notices(
 id uuid primary key default gen_random_uuid(),title text not null check(length(title) between 1 and 100),
 body text not null check(length(body) between 1 and 1000), image_url text,
 destination text not null default 'panel.html',kind text not null check(kind in ('manual','registration','officialized')),
 tournament_id uuid references public.tournaments(id) on delete set null,created_by uuid references public.profiles(id),
 created_at timestamptz not null default now(), unique(tournament_id,kind)
);
alter table public.club_notices enable row level security;
grant select on public.club_notices to authenticated;
revoke all on public.club_notices from anon;
create policy club_notices_read on public.club_notices for select to authenticated
 using (exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.active));
create table vmgc_push.devices(token text primary key,user_id uuid not null references public.profiles(id) on delete cascade,
 updated_at timestamptz not null default now(),enabled boolean not null default true);
create index push_device_user on vmgc_push.devices(user_id);
create table vmgc_push.deliveries(id bigint generated always as identity primary key,
 notice_id uuid not null references public.club_notices(id) on delete cascade,
 token text not null,user_id uuid not null references public.profiles(id) on delete cascade,
 attempts int not null default 0,available_at timestamptz not null default now(),
 status text not null default 'pending',last_error text,unique(notice_id,token));
alter table vmgc_push.devices enable row level security;
alter table vmgc_push.deliveries enable row level security;
grant usage on schema vmgc_push to service_role;
grant all on all tables in schema vmgc_push to service_role;
grant usage,select on all sequences in schema vmgc_push to service_role;
create function public.push_register(p_user uuid,p_token text) returns void
 language sql security definer set search_path='' as $$
 insert into vmgc_push.devices(token,user_id) values(p_token,p_user)
 on conflict(token) do update set user_id=excluded.user_id,enabled=true,updated_at=now(); $$;
create function public.push_unregister(p_user uuid,p_token text) returns void
 language sql security definer set search_path='' as $$
 delete from vmgc_push.devices where token=p_token and user_id=p_user; $$;
create function vmgc_push.queue_notice() returns trigger language plpgsql security definer set search_path='' as $$
 begin
 insert into vmgc_push.deliveries(notice_id,token,user_id)
 select new.id,d.token,d.user_id from vmgc_push.devices d join public.profiles p on p.id=d.user_id
 where d.enabled and p.active;
 return new;end; $$;
create trigger club_notice_queue after insert on public.club_notices for each row execute function vmgc_push.queue_notice();
create function vmgc_push.tournament_notice() returns trigger language plpgsql security definer set search_path='' as $$
 begin
 if new.data_schema_version=2 and new.published then
 if new.status='open' and (old.status is distinct from 'open' or not old.published) then
 insert into public.club_notices(title,body,destination,kind,tournament_id)
 values('Inscripción abierta',left('Ya podés anotarte en '||new.name||'.',1000),'grilla_interactiva.html?torneo_id='||new.id,'registration',new.id)
 on conflict(tournament_id,kind) do nothing;
 elsif new.status='officialized' and (old.status is distinct from 'officialized' or not old.published) then
 insert into public.club_notices(title,body,destination,kind,tournament_id)
 values('Torneo oficializado',left(new.name||' ya fue oficializado. Consultá el torneo y sus resultados disponibles.',1000),
 'torneos.html?id='||new.id,'officialized',new.id)
 on conflict(tournament_id,kind) do nothing;
 end if;end if;return new;end; $$;
create trigger tournament_push_notice after update of status,published on public.tournaments
 for each row execute function vmgc_push.tournament_notice();
create function public.push_claim() returns table(delivery_id bigint,notice_id uuid,token text,user_id uuid,title text,body text,image_url text,destination text)
 language sql security definer set search_path='' as $$
 with picked as(select d.id from vmgc_push.deliveries d where d.status='pending' and d.available_at<=now()
 and d.attempts<5 order by d.id limit 40 for update skip locked),
 claimed as(update vmgc_push.deliveries d set attempts=attempts+1,available_at=now()+interval '3 minutes'
 from picked where d.id=picked.id returning d.*)
 select c.id,n.id,c.token,c.user_id,n.title,n.body,n.image_url,n.destination from claimed c join public.club_notices n on n.id=c.notice_id; $$;
create function public.push_finish(p_id bigint,p_success boolean,p_error text,p_invalid boolean default false) returns void
 language plpgsql security definer set search_path='' as $$
 begin
 update vmgc_push.deliveries set status=case when p_success then 'sent' when p_invalid or attempts>=5 then 'failed' else 'pending' end,
 last_error=left(p_error,100),available_at=now()+interval '3 minutes' where id=p_id;
 if p_invalid then update vmgc_push.devices set enabled=false where token=(select token from vmgc_push.deliveries where id=p_id);end if;
 end; $$;
select vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),'vmgc_push_dispatch');
create function public.push_authorize(p_secret text) returns boolean language sql security definer set search_path='' as $$
 select exists(select 1 from vault.decrypted_secrets where name='vmgc_push_dispatch' and decrypted_secret=p_secret); $$;
revoke all on function public.push_register(uuid,text),public.push_unregister(uuid,text),public.push_claim(),public.push_finish(bigint,boolean,text,boolean),public.push_authorize(text) from public,anon,authenticated;
grant execute on function public.push_register(uuid,text),public.push_unregister(uuid,text),public.push_claim(),public.push_finish(bigint,boolean,text,boolean),public.push_authorize(text) to service_role;
revoke all on function vmgc_push.queue_notice(),vmgc_push.tournament_notice() from public,anon,authenticated;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('club-notice-images','club-notice-images',true,1048576,array['image/jpeg','image/png','image/webp']) on conflict(id) do nothing;
create policy club_notice_image_admin_insert on storage.objects for insert to authenticated
 with check(bucket_id='club-notice-images' and exists(select 1 from public.profiles where id=(select auth.uid()) and role='admin' and active));
create policy club_notice_image_admin_read on storage.objects for select to authenticated
 using(bucket_id='club-notice-images' and exists(select 1 from public.profiles where id=(select auth.uid()) and role='admin' and active));
