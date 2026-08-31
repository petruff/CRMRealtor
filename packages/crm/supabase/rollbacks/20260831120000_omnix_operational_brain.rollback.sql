-- Pre-use rollback only. Do not run after proposals or memories are created.

begin;

drop function if exists public.transition_omnix_proposal_execution(
  uuid, uuid, public.omnix_proposal_state, public.omnix_proposal_state, uuid, text, text, text, timestamptz
);
drop function if exists public.decide_omnix_action_proposal(uuid, uuid, integer, text, uuid, text, timestamptz);
drop function if exists public.create_omnix_action_proposal(
  uuid, uuid, uuid, uuid, public.omnix_proposal_kind, public.omnix_proposal_origin,
  public.omnix_approval_mode, public.attention_priority, integer, jsonb, text, text, jsonb, text,
  jsonb, timestamptz, timestamptz, uuid, uuid, text, timestamptz
);
drop trigger if exists omnix_relationship_memories_touch_updated_at on public.omnix_relationship_memories;
drop trigger if exists omnix_action_proposals_touch_updated_at on public.omnix_action_proposals;
drop trigger if exists omnix_action_proposal_events_no_mutation on public.omnix_action_proposal_events;
drop trigger if exists omnix_action_proposal_versions_no_mutation on public.omnix_action_proposal_versions;
drop function if exists public.guard_omnix_proposal_event_mutation();
drop table if exists public.omnix_relationship_memories;
drop table if exists public.omnix_action_proposal_events;
drop table if exists public.omnix_action_proposal_versions;
drop table if exists public.omnix_action_proposals;
drop function if exists public.valid_omnix_proposal_citations(jsonb);
drop function if exists public.valid_omnix_priority_factors(jsonb,integer);
alter table if exists public.real_estate_transactions
  drop constraint if exists real_estate_transactions_id_workspace_unique;
drop type if exists public.omnix_proposal_actor_kind;
drop type if exists public.omnix_approval_mode;
drop type if exists public.omnix_proposal_origin;
drop type if exists public.omnix_proposal_state;
drop type if exists public.omnix_proposal_kind;

commit;
