-- PostgreSQL enum values cannot be removed safely while dependent proposals exist.
-- Retain note-append. Use the capture_outcome containment rollback to revoke note execution.
select 1;
