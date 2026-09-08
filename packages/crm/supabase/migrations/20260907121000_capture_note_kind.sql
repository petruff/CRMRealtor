-- Enum extension must commit before the following migration uses this value.
alter type public.omnix_proposal_kind add value if not exists 'note-append';
