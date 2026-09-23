-- Forward repair: remove the containment trigger so buyer-agreement milestones can be recorded again.
drop trigger if exists omnix_block_buyer_agreement_milestones on public.transaction_milestones;
drop function if exists public.omnix_block_buyer_agreement_milestones();
