-- Previous Persian-month report snapshot tables.
-- Production-applied on 2026-10-12. Idempotent reference for rebuild/recovery.

create table if not exists public.report_month_leads
  (like public.monthly_leads including all);
create table if not exists public.report_month_opportunities
  (like public.monthly_opportunities including all);
create table if not exists public.report_month_calls
  (like public.monthly_calls including all);
create table if not exists public.report_month_tickets
  (like public.monthly_tickets including all);

create table if not exists public.crm_month_report_chunks(
  batch_id text not null,
  dataset text not null,
  seq integer not null,
  payload_json text not null,
  created_at timestamptz not null default now(),
  primary key(batch_id,dataset,seq)
);

alter table public.report_month_leads enable row level security;
alter table public.report_month_opportunities enable row level security;
alter table public.report_month_calls enable row level security;
alter table public.report_month_tickets enable row level security;
alter table public.crm_month_report_chunks enable row level security;

revoke all on public.report_month_leads from anon, authenticated;
revoke all on public.report_month_opportunities from anon, authenticated;
revoke all on public.report_month_calls from anon, authenticated;
revoke all on public.report_month_tickets from anon, authenticated;
revoke all on public.crm_month_report_chunks from anon, authenticated;

grant select,insert,update,delete,truncate on public.report_month_leads to advisor_kpi_railway;
grant select,insert,update,delete,truncate on public.report_month_opportunities to advisor_kpi_railway;
grant select,insert,update,delete,truncate on public.report_month_calls to advisor_kpi_railway;
grant select,insert,update,delete,truncate on public.report_month_tickets to advisor_kpi_railway;
grant select,insert,update,delete,truncate on public.crm_month_report_chunks to advisor_kpi_railway;
