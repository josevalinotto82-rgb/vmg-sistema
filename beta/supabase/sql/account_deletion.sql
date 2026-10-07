-- Aplicado en Supabase. Conserva los avisos y reportes al eliminar su autor.
begin;
alter table public.club_notices drop constraint club_notices_created_by_fkey;
alter table public.club_notices add constraint club_notices_created_by_fkey foreign key (created_by) references public.profiles(id) on delete set null;
alter table public.aag_sync_history drop constraint aag_sync_history_created_by_fkey;
alter table public.aag_sync_history add constraint aag_sync_history_created_by_fkey foreign key (created_by) references auth.users(id) on delete set null;
alter table public.tournament_archived_reports drop constraint tournament_archived_reports_created_by_fkey;
alter table public.tournament_archived_reports add constraint tournament_archived_reports_created_by_fkey foreign key (created_by) references auth.users(id) on delete set null;
commit;
