-- Commit enum addition before adapter functions use it.
alter type public.omnix_proposal_kind add value if not exists 'nurture-transition';
