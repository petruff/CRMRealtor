-- Epic 11 P7: Florida deal readiness.
-- Adds a sourced "buyer-agreement" milestone kind so a written buyer agreement
-- (required before touring since the NAR settlement practice change of
-- 2024-08-17) is recorded with the same source/verification/audit trail as
-- every other deal milestone. Flood disclosure (Fla. Stat. 689.302) reuses the
-- existing 'flood' kind. Additive only: no data is rewritten.
alter type public.transaction_milestone_kind add value if not exists 'buyer-agreement';
