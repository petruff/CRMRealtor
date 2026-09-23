-- Story 7.5: versioned affordability scenarios with source-preserving inputs and preview-only handoff.
begin;

create table public.affordability_scenarios (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  name text not null,
  contact_id uuid,
  transaction_id uuid,
  inputs jsonb not null,
  outputs jsonb not null,
  disclaimer text not null,
  current_version integer not null default 1,
  created_by_membership_id uuid not null,
  updated_by_membership_id uuid not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  constraint affordability_scenarios_id_workspace_unique unique(id,workspace_id),
  constraint affordability_scenarios_contact_workspace_fk foreign key(contact_id,workspace_id)
    references public.contacts(id,workspace_id) on delete restrict,
  constraint affordability_scenarios_transaction_workspace_fk foreign key(transaction_id,workspace_id)
    references public.real_estate_transactions(id,workspace_id) on delete restrict,
  constraint affordability_scenarios_creator_workspace_fk foreign key(created_by_membership_id,workspace_id)
    references public.workspace_members(id,workspace_id) on delete restrict,
  constraint affordability_scenarios_updater_workspace_fk foreign key(updated_by_membership_id,workspace_id)
    references public.workspace_members(id,workspace_id) on delete restrict,
  constraint affordability_scenarios_name_present check(length(trim(name)) between 1 and 120),
  constraint affordability_scenarios_json_objects check(jsonb_typeof(inputs)='object' and jsonb_typeof(outputs)='object'),
  constraint affordability_scenarios_version_positive check(current_version>0)
);

create table public.affordability_scenario_revisions (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  scenario_id uuid not null,
  version integer not null,
  name text not null,
  contact_id uuid,
  transaction_id uuid,
  inputs jsonb not null,
  outputs jsonb not null,
  disclaimer text not null,
  reason_code text not null,
  actor_membership_id uuid not null,
  idempotency_key text not null,
  created_at timestamptz not null,
  constraint affordability_revisions_scenario_workspace_fk foreign key(scenario_id,workspace_id)
    references public.affordability_scenarios(id,workspace_id) on delete restrict,
  constraint affordability_revisions_actor_workspace_fk foreign key(actor_membership_id,workspace_id)
    references public.workspace_members(id,workspace_id) on delete restrict,
  constraint affordability_revisions_version_unique unique(workspace_id,scenario_id,version),
  constraint affordability_revisions_idempotency_unique unique(workspace_id,idempotency_key),
  constraint affordability_revisions_json_objects check(jsonb_typeof(inputs)='object' and jsonb_typeof(outputs)='object'),
  constraint affordability_revisions_reason_present check(length(trim(reason_code)) between 1 and 80)
);

create table public.affordability_share_intents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  scenario_id uuid not null,
  scenario_version integer not null,
  recipient_name text not null,
  recipient_address text not null,
  channel text not null,
  consent_confirmed boolean not null,
  preview_payload jsonb not null,
  status text not null default 'previewed',
  created_by_membership_id uuid not null,
  idempotency_key text not null,
  created_at timestamptz not null,
  constraint affordability_share_scenario_workspace_fk foreign key(scenario_id,workspace_id)
    references public.affordability_scenarios(id,workspace_id) on delete restrict,
  constraint affordability_share_actor_workspace_fk foreign key(created_by_membership_id,workspace_id)
    references public.workspace_members(id,workspace_id) on delete restrict,
  constraint affordability_share_revision_fk foreign key(workspace_id,scenario_id,scenario_version)
    references public.affordability_scenario_revisions(workspace_id,scenario_id,version) on delete restrict,
  constraint affordability_share_idempotency_unique unique(workspace_id,idempotency_key),
  constraint affordability_share_preview_only check(channel='email' and consent_confirmed and status='previewed'),
  constraint affordability_share_recipient_present check(length(trim(recipient_name)) between 1 and 120 and length(trim(recipient_address)) between 3 and 320),
  constraint affordability_share_payload_object check(jsonb_typeof(preview_payload)='object')
);

create index affordability_scenarios_workspace_updated_idx on public.affordability_scenarios(workspace_id,updated_at desc);
create index affordability_revisions_scenario_idx on public.affordability_scenario_revisions(workspace_id,scenario_id,version desc);
create index affordability_share_scenario_idx on public.affordability_share_intents(workspace_id,scenario_id,created_at desc);

create or replace function public.reject_affordability_history_mutation()
returns trigger language plpgsql security definer set search_path='' as $$
begin raise exception 'affordability history is append-only' using errcode='55000'; end $$;
create trigger affordability_revisions_no_mutation before update or delete on public.affordability_scenario_revisions
for each row execute function public.reject_affordability_history_mutation();
create trigger affordability_share_intents_no_mutation before update or delete on public.affordability_share_intents
for each row execute function public.reject_affordability_history_mutation();

create or replace function public.calculate_affordability_outputs(target_inputs jsonb)
returns jsonb language plpgsql stable set search_path='' as $$
declare
  keys constant text[]:=array['priceCents','downPaymentCents','loanTermMonths','annualRateBasisPoints','annualPropertyTaxCents',
    'annualHomeInsuranceCents','annualFloodInsuranceCents','monthlyAssociationCents','monthlyAssessmentCents','monthlyMaintenanceCents','closingCostsCents'];
  item_key text; item jsonb; numeric_value numeric; unknowns jsonb:='[]'::jsonb;
  price numeric; down_payment numeric; term_months numeric; rate_bps numeric; loan_amount numeric; monthly_rate numeric; principal_interest numeric;
  property_tax numeric; home_insurance numeric; flood_insurance numeric; association_cost numeric; assessment_cost numeric; maintenance_cost numeric;
  closing_costs numeric; monthly_total numeric; cash_to_close numeric;
begin
  if jsonb_typeof(target_inputs)<>'object' or (select array_agg(key order by key) from jsonb_object_keys(target_inputs) key)
    <> (select array_agg(key order by key) from unnest(keys) key) then
    raise exception 'affordability inputs are incomplete' using errcode='22023';
  end if;
  foreach item_key in array keys loop
    item:=target_inputs->item_key;
    if jsonb_typeof(item)<>'object' or item->>'sourceType' not in ('user-entered','provider-supplied','calculated','estimated','unknown')
      or item->>'verificationState' not in ('unverified','verified') or jsonb_typeof(item->'assumption')<>'boolean'
      or (item ? 'asOfDate' and item->>'asOfDate' is not null and (item->>'asOfDate') !~ '^\d{4}-\d{2}-\d{2}$')
      or ((item->>'sourceType'='provider-supplied' or item->>'verificationState'='verified') and length(trim(coalesce(item->>'sourceReference','')))=0) then
      raise exception 'invalid affordability input provenance for %',item_key using errcode='22023';
    end if;
    if item->>'sourceType'='unknown' then
      if item ? 'value' and item->'value'<>'null'::jsonb then raise exception 'unknown affordability input cannot have a value' using errcode='22023'; end if;
      unknowns:=unknowns||to_jsonb(item_key);
    else
      begin numeric_value:=(item->>'value')::numeric; exception when others then raise exception 'affordability input value is invalid' using errcode='22023'; end;
      if numeric_value<0 or numeric_value<>trunc(numeric_value) or numeric_value>9007199254740991 then
        raise exception 'affordability input value is invalid' using errcode='22023';
      end if;
    end if;
  end loop;
  price:=nullif(target_inputs->'priceCents'->>'value','')::numeric;
  down_payment:=nullif(target_inputs->'downPaymentCents'->>'value','')::numeric;
  term_months:=nullif(target_inputs->'loanTermMonths'->>'value','')::numeric;
  rate_bps:=nullif(target_inputs->'annualRateBasisPoints'->>'value','')::numeric;
  if down_payment is not null and price is not null and down_payment>price then raise exception 'down payment cannot exceed price' using errcode='22023'; end if;
  if term_months is not null and (term_months<1 or term_months>600) then raise exception 'loan term is invalid' using errcode='22023'; end if;
  if rate_bps is not null and rate_bps>5000 then raise exception 'annual rate is invalid' using errcode='22023'; end if;
  loan_amount:=case when price is null or down_payment is null then null else price-down_payment end;
  if loan_amount is not null and term_months is not null and rate_bps is not null then
    monthly_rate:=rate_bps/10000/12;
    principal_interest:=case when monthly_rate=0 then round(loan_amount/term_months)
      else round(loan_amount*(monthly_rate*power(1+monthly_rate,term_months))/(power(1+monthly_rate,term_months)-1)) end;
  end if;
  property_tax:=round(nullif(target_inputs->'annualPropertyTaxCents'->>'value','')::numeric/12);
  home_insurance:=round(nullif(target_inputs->'annualHomeInsuranceCents'->>'value','')::numeric/12);
  flood_insurance:=round(nullif(target_inputs->'annualFloodInsuranceCents'->>'value','')::numeric/12);
  association_cost:=nullif(target_inputs->'monthlyAssociationCents'->>'value','')::numeric;
  assessment_cost:=nullif(target_inputs->'monthlyAssessmentCents'->>'value','')::numeric;
  maintenance_cost:=nullif(target_inputs->'monthlyMaintenanceCents'->>'value','')::numeric;
  closing_costs:=nullif(target_inputs->'closingCostsCents'->>'value','')::numeric;
  if principal_interest is not null and property_tax is not null and home_insurance is not null and flood_insurance is not null
    and association_cost is not null and assessment_cost is not null and maintenance_cost is not null then
    monthly_total:=principal_interest+property_tax+home_insurance+flood_insurance+association_cost+assessment_cost+maintenance_cost;
  end if;
  if down_payment is not null and closing_costs is not null then cash_to_close:=down_payment+closing_costs; end if;
  return jsonb_strip_nulls(jsonb_build_object('loanAmountCents',loan_amount,'monthlyPrincipalInterestCents',principal_interest,
    'monthlyPropertyTaxCents',property_tax,'monthlyHomeInsuranceCents',home_insurance,'monthlyFloodInsuranceCents',flood_insurance,
    'monthlyAssociationCents',association_cost,'monthlyAssessmentCents',assessment_cost,'monthlyMaintenanceCents',maintenance_cost,
    'estimatedMonthlyOwnershipCents',monthly_total,'estimatedCashToCloseCents',cash_to_close))||jsonb_build_object('unknowns',unknowns);
end $$;

alter table public.affordability_scenarios enable row level security;
alter table public.affordability_scenarios force row level security;
alter table public.affordability_scenario_revisions enable row level security;
alter table public.affordability_scenario_revisions force row level security;
alter table public.affordability_share_intents enable row level security;
alter table public.affordability_share_intents force row level security;
create policy affordability_scenarios_member_select on public.affordability_scenarios for select to authenticated using(public.has_workspace_access(workspace_id));
create policy affordability_revisions_member_select on public.affordability_scenario_revisions for select to authenticated using(public.has_workspace_access(workspace_id));
create policy affordability_share_member_select on public.affordability_share_intents for select to authenticated using(public.has_workspace_access(workspace_id));
revoke all on table public.affordability_scenarios,public.affordability_scenario_revisions,public.affordability_share_intents from public,anon,authenticated;
grant select on table public.affordability_scenarios,public.affordability_scenario_revisions,public.affordability_share_intents to authenticated;
grant all on table public.affordability_scenarios,public.affordability_scenario_revisions,public.affordability_share_intents to service_role;
revoke all on sequence public.affordability_scenario_revisions_id_seq from public,anon,authenticated;
grant all on sequence public.affordability_scenario_revisions_id_seq to service_role;

create or replace function public.upsert_affordability_scenario(target_workspace_id uuid,target_membership_id uuid,target_scenario_id uuid,
  target_expected_version integer,target_name text,target_contact_id uuid,target_transaction_id uuid,target_inputs jsonb,
  target_reason_code text,target_idempotency_key text,target_occurred_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare current_record public.affordability_scenarios%rowtype; replay public.affordability_scenario_revisions%rowtype;
  updated public.affordability_scenarios%rowtype; calculated_outputs jsonb;
begin
  perform public.assert_crm_actor_membership(target_membership_id,target_workspace_id);
  if target_expected_version<0 or length(trim(target_name)) not between 1 and 120 or length(trim(target_reason_code)) not between 1 and 80
    or target_idempotency_key !~ '^[A-Za-z0-9._:-]{1,160}$' or target_occurred_at is null then
    raise exception 'invalid affordability scenario request' using errcode='22023'; end if;
  select * into replay from public.affordability_scenario_revisions where workspace_id=target_workspace_id and idempotency_key=target_idempotency_key;
  if found then return jsonb_build_object('scenarioId',replay.scenario_id,'version',replay.version,'noOp',true); end if;
  if target_contact_id is not null then perform 1 from public.contacts where id=target_contact_id and workspace_id=target_workspace_id and archived_at is null;
    if not found then raise exception 'active contact not found' using errcode='P0002'; end if; end if;
  if target_transaction_id is not null then perform 1 from public.real_estate_transactions where id=target_transaction_id and workspace_id=target_workspace_id;
    if not found then raise exception 'transaction not found' using errcode='P0002'; end if; end if;
  calculated_outputs:=public.calculate_affordability_outputs(target_inputs);
  if target_scenario_id is not null then select * into current_record from public.affordability_scenarios
    where id=target_scenario_id and workspace_id=target_workspace_id for update; end if;
  if current_record.id is not null and current_record.current_version<>target_expected_version then raise exception 'scenario version is stale' using errcode='40001'; end if;
  if current_record.id is null and target_expected_version<>0 then raise exception 'scenario version is stale' using errcode='40001'; end if;
  if current_record.id is not null then
    update public.affordability_scenarios set name=trim(target_name),contact_id=target_contact_id,transaction_id=target_transaction_id,
      inputs=target_inputs,outputs=calculated_outputs,current_version=current_version+1,updated_by_membership_id=target_membership_id,updated_at=target_occurred_at
    where id=current_record.id returning * into updated;
  else
    insert into public.affordability_scenarios(workspace_id,name,contact_id,transaction_id,inputs,outputs,disclaimer,
      created_by_membership_id,updated_by_membership_id,created_at,updated_at)
    values(target_workspace_id,trim(target_name),target_contact_id,target_transaction_id,target_inputs,calculated_outputs,
      'Planning estimate only. Not a lender, insurance, tax, appraisal, association, legal, or affordability quote or guarantee.',
      target_membership_id,target_membership_id,target_occurred_at,target_occurred_at) returning * into updated;
  end if;
  insert into public.affordability_scenario_revisions(workspace_id,scenario_id,version,name,contact_id,transaction_id,inputs,outputs,
    disclaimer,reason_code,actor_membership_id,idempotency_key,created_at)
  values(target_workspace_id,updated.id,updated.current_version,updated.name,updated.contact_id,updated.transaction_id,updated.inputs,
    updated.outputs,updated.disclaimer,trim(target_reason_code),target_membership_id,target_idempotency_key,target_occurred_at);
  return jsonb_build_object('scenarioId',updated.id,'version',updated.current_version,'noOp',false);
end $$;

create or replace function public.create_affordability_share_preview(target_workspace_id uuid,target_membership_id uuid,target_scenario_id uuid,
  target_scenario_version integer,target_recipient_name text,target_recipient_address text,target_channel text,target_consent_confirmed boolean,
  target_preview_payload jsonb,target_idempotency_key text,target_occurred_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare replay public.affordability_share_intents%rowtype; created public.affordability_share_intents%rowtype;
  revision public.affordability_scenario_revisions%rowtype; expected_preview jsonb;
begin
  perform public.assert_crm_actor_membership(target_membership_id,target_workspace_id);
  if target_scenario_version<1 or length(trim(target_recipient_name)) not between 1 and 120
    or target_recipient_address !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or target_channel<>'email'
    or target_consent_confirmed is not true or jsonb_typeof(target_preview_payload)<>'object'
    or target_idempotency_key !~ '^[A-Za-z0-9._:-]{1,160}$' or target_occurred_at is null then
    raise exception 'invalid affordability sharing preview request' using errcode='22023'; end if;
  select * into replay from public.affordability_share_intents where workspace_id=target_workspace_id and idempotency_key=target_idempotency_key;
  if found then return jsonb_build_object('shareIntentId',replay.id,'status',replay.status,'noOp',true); end if;
  select * into revision from public.affordability_scenario_revisions where workspace_id=target_workspace_id and scenario_id=target_scenario_id and version=target_scenario_version;
  if revision.id is null then raise exception 'scenario revision not found' using errcode='P0002'; end if;
  expected_preview:=jsonb_build_object('scenarioId',revision.scenario_id,'scenarioVersion',revision.version,'name',revision.name,
    'inputs',revision.inputs,'outputs',revision.outputs,'disclaimer',revision.disclaimer);
  if target_preview_payload<>expected_preview then raise exception 'sharing preview does not match the canonical scenario revision' using errcode='22023'; end if;
  insert into public.affordability_share_intents(workspace_id,scenario_id,scenario_version,recipient_name,recipient_address,channel,
    consent_confirmed,preview_payload,created_by_membership_id,idempotency_key,created_at)
  values(target_workspace_id,target_scenario_id,target_scenario_version,trim(target_recipient_name),lower(trim(target_recipient_address)),target_channel,
    true,expected_preview,target_membership_id,target_idempotency_key,target_occurred_at) returning * into created;
  return jsonb_build_object('shareIntentId',created.id,'status',created.status,'noOp',false);
end $$;

revoke all on function public.calculate_affordability_outputs(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.calculate_affordability_outputs(jsonb) to authenticated,service_role;
revoke all on function public.upsert_affordability_scenario(uuid,uuid,uuid,integer,text,uuid,uuid,jsonb,text,text,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.upsert_affordability_scenario(uuid,uuid,uuid,integer,text,uuid,uuid,jsonb,text,text,timestamptz) to authenticated,service_role;
revoke all on function public.create_affordability_share_preview(uuid,uuid,uuid,integer,text,text,text,boolean,jsonb,text,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.create_affordability_share_preview(uuid,uuid,uuid,integer,text,text,text,boolean,jsonb,text,timestamptz) to authenticated,service_role;

commit;
