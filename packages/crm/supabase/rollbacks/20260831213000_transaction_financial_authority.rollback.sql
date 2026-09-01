begin;

-- Financial evidence is retained. Rollback disables new mutations and leaves
-- authenticated reads available for recovery/export.
revoke all on function public.upsert_transaction_financial_authority(uuid,uuid,uuid,integer,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,text,text,date,text,text,text,timestamptz)
from public,anon,authenticated,service_role;

commit;
