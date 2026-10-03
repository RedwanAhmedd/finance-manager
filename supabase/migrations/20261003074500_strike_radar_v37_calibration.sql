-- Strike Radar ELITE v3.7 CALIBRATED
-- Separates setup score from empirical probability and adds point-in-time feature lineage.

alter table public.radar_forecasts
  alter column confidence drop not null;

comment on column public.radar_forecasts.confidence is
  'Deprecated v3.6 evidence/confidence field. v3.7 uses setup_score for ranking and separate calibrated probability fields.';

alter table public.radar_forecasts
  add column if not exists setup_score numeric(5,2) not null default 0
    check (setup_score >= 0 and setup_score <= 100),
  add column if not exists probability_status text not null default 'UNKNOWN'
    check (probability_status in ('UNKNOWN','EXPERIMENTAL','CALIBRATED')),
  add column if not exists p_positive_5s numeric,
  add column if not exists p_outperform_benchmark_5s numeric,
  add column if not exists expected_excess_return_pct numeric,
  add column if not exists probability_sample_size integer,
  add column if not exists probability_effective_sample_size numeric,
  add column if not exists probability_method text,
  add column if not exists probability_as_of timestamptz,
  add column if not exists data_quality_pct numeric(5,2) not null default 0
    check (data_quality_pct >= 0 and data_quality_pct <= 100),
  add column if not exists unknown_feature_mask jsonb not null default '[]'::jsonb,
  add column if not exists stale_feature_mask jsonb not null default '[]'::jsonb,
  add column if not exists decision_critical_unknowns jsonb not null default '[]'::jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'radar_forecasts_p_positive_range') then
    alter table public.radar_forecasts
      add constraint radar_forecasts_p_positive_range
      check (p_positive_5s is null or (p_positive_5s >= 0 and p_positive_5s <= 1));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'radar_forecasts_p_outperform_range') then
    alter table public.radar_forecasts
      add constraint radar_forecasts_p_outperform_range
      check (p_outperform_benchmark_5s is null or (p_outperform_benchmark_5s >= 0 and p_outperform_benchmark_5s <= 1));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'radar_forecasts_probability_status_consistent') then
    alter table public.radar_forecasts
      add constraint radar_forecasts_probability_status_consistent
      check (
        probability_status = 'UNKNOWN'
        or p_positive_5s is not null
        or p_outperform_benchmark_5s is not null
      );
  end if;
end $$;

create table if not exists public.radar_feature_observations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  forecast_id uuid not null,
  feature_group text not null,
  feature_name text not null,
  availability text not null check (availability in ('KNOWN','UNKNOWN','STALE')),
  value_json jsonb,
  observed_at timestamptz,
  available_at timestamptz,
  info_cutoff_at timestamptz not null,
  source_url text,
  source_published_at timestamptz,
  created_at timestamptz not null default now(),
  constraint radar_feature_obs_forecast_owner_fk
    foreign key (forecast_id, user_id)
    references public.radar_forecasts (id, user_id)
    on delete restrict,
  constraint radar_feature_obs_timing
    check (
      availability = 'UNKNOWN'
      or (available_at is not null and available_at <= info_cutoff_at)
    ),
  constraint radar_feature_obs_unique
    unique (forecast_id, feature_group, feature_name)
);

comment on table public.radar_feature_observations is
  'Append-only point-in-time feature ledger for Strike Radar v3.7. KNOWN/STALE features must prove they were available by the forecast cutoff; UNKNOWN is explicit rather than coerced to neutral.';

create index if not exists radar_feature_obs_forecast_user_idx
  on public.radar_feature_observations (forecast_id, user_id);
create index if not exists radar_feature_obs_user_group_idx
  on public.radar_feature_observations (user_id, feature_group, created_at desc);

alter table public.radar_feature_observations enable row level security;

drop policy if exists radar_feature_obs_select_own on public.radar_feature_observations;
create policy radar_feature_obs_select_own
  on public.radar_feature_observations for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists radar_feature_obs_insert_own on public.radar_feature_observations;
create policy radar_feature_obs_insert_own
  on public.radar_feature_observations for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

revoke all on table public.radar_feature_observations from anon, authenticated;
grant select, insert on table public.radar_feature_observations to authenticated;
grant all on table public.radar_feature_observations to service_role;

drop view if exists public.radar_calibration_summary;
create view public.radar_calibration_summary
with (security_invoker = true)
as
select
  f.user_id,
  f.provenance,
  f.model_version,
  case
    when f.setup_score >= 90 then '90+'
    when f.setup_score >= 80 then '80-89'
    when f.setup_score >= 65 then '65-79'
    else '<65'
  end as setup_bucket,
  count(*)::bigint as resolved_forecasts,
  round(avg(f.setup_score), 2) as mean_setup_score,
  round(100.0 * avg(case when o.status = 'hit' then 1.0 else 0.0 end), 2) as hit_rate_pct,
  round(avg(o.excess_return), 4) as mean_excess_return
from public.radar_forecasts f
join public.radar_outcomes o
  on o.forecast_id = f.id
 and o.user_id = f.user_id
 and o.evaluation_kind = 'final'
group by f.user_id, f.provenance, f.model_version,
  case
    when f.setup_score >= 90 then '90+'
    when f.setup_score >= 80 then '80-89'
    when f.setup_score >= 65 then '65-79'
    else '<65'
  end;

comment on view public.radar_calibration_summary is
  'Resolved outcome summary by setup-score bucket. Setup score is a ranking/evidence score, NOT a probability.';

revoke all on public.radar_calibration_summary from anon, authenticated;
grant select on public.radar_calibration_summary to authenticated;
grant select on public.radar_calibration_summary to service_role;

create or replace view public.radar_model_metrics
with (security_invoker = true)
as
select
  f.user_id,
  f.provenance,
  f.model_version,
  count(*) filter (where f.p_positive_5s is not null and o.exact_instrument_return is not null)::bigint as n_positive_probability,
  round(avg(
    power(f.p_positive_5s - case when o.exact_instrument_return > 0 then 1.0 else 0.0 end, 2)
  ) filter (where f.p_positive_5s is not null and o.exact_instrument_return is not null), 6) as brier_positive,
  round(avg(
    -(
      (case when o.exact_instrument_return > 0 then 1.0 else 0.0 end)
        * ln(greatest(least(f.p_positive_5s, 0.999999), 0.000001))
      +
      (1.0 - case when o.exact_instrument_return > 0 then 1.0 else 0.0 end)
        * ln(greatest(least(1.0 - f.p_positive_5s, 0.999999), 0.000001))
    )
  ) filter (where f.p_positive_5s is not null and o.exact_instrument_return is not null), 6) as logloss_positive,
  count(*) filter (where f.p_outperform_benchmark_5s is not null and o.excess_return is not null)::bigint as n_relative_probability,
  round(avg(
    power(f.p_outperform_benchmark_5s - case when o.excess_return > 0 then 1.0 else 0.0 end, 2)
  ) filter (where f.p_outperform_benchmark_5s is not null and o.excess_return is not null), 6) as brier_relative,
  round(avg(
    -(
      (case when o.excess_return > 0 then 1.0 else 0.0 end)
        * ln(greatest(least(f.p_outperform_benchmark_5s, 0.999999), 0.000001))
      +
      (1.0 - case when o.excess_return > 0 then 1.0 else 0.0 end)
        * ln(greatest(least(1.0 - f.p_outperform_benchmark_5s, 0.999999), 0.000001))
    )
  ) filter (where f.p_outperform_benchmark_5s is not null and o.excess_return is not null), 6) as logloss_relative
from public.radar_forecasts f
join public.radar_outcomes o
  on o.forecast_id = f.id
 and o.user_id = f.user_id
 and o.evaluation_kind = 'final'
group by f.user_id, f.provenance, f.model_version;

comment on view public.radar_model_metrics is
  'Proper scoring metrics for v3.7 probability forecasts. Empty/NULL until explicit probability estimates and final outcomes exist.';

revoke all on public.radar_model_metrics from anon, authenticated;
grant select on public.radar_model_metrics to authenticated;
grant select on public.radar_model_metrics to service_role;

create or replace view public.radar_probability_calibration
with (security_invoker = true)
as
select
  f.user_id,
  f.provenance,
  f.model_version,
  width_bucket(f.p_positive_5s, 0.0, 1.0, 10) as probability_decile,
  count(*)::bigint as observations,
  round(avg(f.p_positive_5s), 4) as mean_predicted_probability,
  round(avg(case when o.exact_instrument_return > 0 then 1.0 else 0.0 end), 4) as empirical_positive_rate
from public.radar_forecasts f
join public.radar_outcomes o
  on o.forecast_id = f.id
 and o.user_id = f.user_id
 and o.evaluation_kind = 'final'
where f.p_positive_5s is not null
  and o.exact_instrument_return is not null
group by f.user_id, f.provenance, f.model_version,
  width_bucket(f.p_positive_5s, 0.0, 1.0, 10);

comment on view public.radar_probability_calibration is
  'Reliability-table source for P(positive 5 sessions). Keep LIVE and BACKTEST separate.';

revoke all on public.radar_probability_calibration from anon, authenticated;
grant select on public.radar_probability_calibration to authenticated;
grant select on public.radar_probability_calibration to service_role;
