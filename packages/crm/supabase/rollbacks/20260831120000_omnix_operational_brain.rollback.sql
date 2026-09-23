-- Data-preserving containment rollback.
-- Later migrations depend on the proposal enums, tables, and immutable-event
-- guard, so rollback disables mutation entry points without dropping the
-- shared contract or its evidence.

begin;

revoke execute on function public.create_omnix_action_proposal(
  uuid, uuid, uuid, uuid, public.omnix_proposal_kind, public.omnix_proposal_origin,
  public.omnix_approval_mode, public.attention_priority, integer, jsonb, text, text, jsonb, text,
  jsonb, timestamptz, timestamptz, uuid, uuid, text, timestamptz
) from authenticated, service_role;

revoke execute on function public.decide_omnix_action_proposal(
  uuid, uuid, integer, text, uuid, text, timestamptz
) from authenticated;

revoke execute on function public.transition_omnix_proposal_execution(
  uuid, uuid, public.omnix_proposal_state, public.omnix_proposal_state,
  uuid, text, text, text, timestamptz
) from authenticated;

comment on table public.omnix_action_proposals is
  'CONTAINED: proposal mutation entry points are revoked; evidence and dependent contracts are retained.';

commit;
