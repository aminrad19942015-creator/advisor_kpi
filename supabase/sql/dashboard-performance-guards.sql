-- Advisor KPI dashboard: GAS migration performance/integrity guards
-- This is an idempotent replay/reference script, not a Supabase migration.
-- Live project: advisor-kpi
--
-- Goals:
-- 1) reject duplicate operational identifiers before they can replace a healthy snapshot
-- 2) support the most common dashboard filter/join paths
-- 3) keep persistent RPC cache in a non-exposed schema
-- 4) harden the legacy julianday compatibility function search_path

create schema if not exists private;

create table if not exists private.dashboard_rpc_cache (
  cache_key text primary key,
  payload jsonb not null,
  source_version text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists idx_dashboard_rpc_cache_expires_at
  on private.dashboard_rpc_cache (expires_at);

revoke all on schema private from public, anon, authenticated;
revoke all on all tables in schema private from public, anon, authenticated;

create unique index if not exists uq_team_members_name
  on public.team_members (name)
  where coalesce(name,'') <> '';

create unique index if not exists uq_open_leads_crm_shadow_lead_number
  on public.open_leads_crm_shadow (lead_number)
  where coalesce(lead_number,'') <> '';

create index if not exists idx_open_leads_crm_campaign_lead_type
  on public.open_leads_crm_shadow (campaign, lead_type);

create index if not exists idx_open_leads_crm_next_call_reason
  on public.open_leads_crm_shadow (next_call_reason);

create index if not exists idx_open_leads_crm_age_days
  on public.open_leads_crm_shadow (age_days);

create unique index if not exists uq_daily_leads_lead_number
  on public.daily_leads (lead_number) where coalesce(lead_number,'') <> '';
create unique index if not exists uq_weekly_leads_lead_number
  on public.weekly_leads (lead_number) where coalesce(lead_number,'') <> '';
create unique index if not exists uq_monthly_leads_lead_number
  on public.monthly_leads (lead_number) where coalesce(lead_number,'') <> '';

create unique index if not exists uq_daily_opportunities_opportunity_id
  on public.daily_opportunities (opportunity_id) where coalesce(opportunity_id,'') <> '';
create unique index if not exists uq_weekly_opportunities_opportunity_id
  on public.weekly_opportunities (opportunity_id) where coalesce(opportunity_id,'') <> '';
create unique index if not exists uq_monthly_opportunities_opportunity_id
  on public.monthly_opportunities (opportunity_id) where coalesce(opportunity_id,'') <> '';

create unique index if not exists uq_daily_calls_call_id
  on public.daily_calls (call_id) where coalesce(call_id,'') <> '';
create unique index if not exists uq_weekly_calls_call_id
  on public.weekly_calls (call_id) where coalesce(call_id,'') <> '';
create unique index if not exists uq_monthly_calls_call_id
  on public.monthly_calls (call_id) where coalesce(call_id,'') <> '';

create unique index if not exists uq_daily_tickets_queue_item_id
  on public.daily_tickets (queue_item_id) where coalesce(queue_item_id,'') <> '';
create unique index if not exists uq_weekly_tickets_queue_item_id
  on public.weekly_tickets (queue_item_id) where coalesce(queue_item_id,'') <> '';
create unique index if not exists uq_monthly_tickets_queue_item_id
  on public.monthly_tickets (queue_item_id) where coalesce(queue_item_id,'') <> '';

create index if not exists idx_daily_leads_campaign_lead_number
  on public.daily_leads (campaign, lead_number);
create index if not exists idx_weekly_leads_campaign_lead_number
  on public.weekly_leads (campaign, lead_number);
create index if not exists idx_monthly_leads_campaign_lead_number
  on public.monthly_leads (campaign, lead_number);

create index if not exists idx_daily_opportunities_lead_number
  on public.daily_opportunities (lead_number);
create index if not exists idx_weekly_opportunities_lead_number
  on public.weekly_opportunities (lead_number);
create index if not exists idx_monthly_opportunities_lead_number
  on public.monthly_opportunities (lead_number);

create index if not exists idx_daily_calls_user_lead_number
  on public.daily_calls ("user", lead_number);
create index if not exists idx_weekly_calls_user_lead_number
  on public.weekly_calls ("user", lead_number);
create index if not exists idx_monthly_calls_user_lead_number
  on public.monthly_calls ("user", lead_number);

alter function public.julianday(text) set search_path = pg_catalog;

analyze public.team_members;
analyze public.open_leads_crm_shadow;
analyze public.daily_leads;
analyze public.weekly_leads;
analyze public.monthly_leads;
analyze public.daily_opportunities;
analyze public.weekly_opportunities;
analyze public.monthly_opportunities;
analyze public.daily_calls;
analyze public.weekly_calls;
analyze public.monthly_calls;
analyze public.daily_tickets;
analyze public.weekly_tickets;
analyze public.monthly_tickets;
