-- Restore the exact mutation grants revoked by the containment rollback.

begin;

grant execute on function public.create_omnix_action_proposal(
  uuid, uuid, uuid, uuid, public.omnix_proposal_kind, public.omnix_proposal_origin,
  public.omnix_approval_mode, public.attention_priority, integer, jsonb, text, text, jsonb, text,
  jsonb, timestamptz, timestamptz, uuid, uuid, text, timestamptz
) to authenticated, service_role;

grant execute on function public.decide_omnix_action_proposal(
  uuid, uuid, integer, text, uuid, text, timestamptz
) to authenticated;

grant execute on function public.transition_omnix_proposal_execution(
  uuid, uuid, public.omnix_proposal_state, public.omnix_proposal_state,
  uuid, text, text, text, timestamptz
) to authenticated;

comment on table public.omnix_action_proposals is
  'Versioned, recoverable Omnix action proposals. Approval does not itself execute an external action.';

commit;
