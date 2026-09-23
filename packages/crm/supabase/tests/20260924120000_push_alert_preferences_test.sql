begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

select has_column('public','push_subscriptions','alert_new_leads','devices can opt out of new-lead alerts');
select has_column('public','push_subscriptions','alert_deadlines','devices can opt out of deadline alerts');
select col_default_is('public','push_subscriptions','quiet_start_hour','21','quiet hours start at 9 PM by default');
select col_default_is('public','push_subscriptions','quiet_end_hour','7','quiet hours end at 7 AM by default');
select ok(has_column_privilege('authenticated','public.push_subscriptions','alert_new_leads','UPDATE'),'members can change their alert choices');
select ok(not has_column_privilege('authenticated','public.push_subscriptions','endpoint','UPDATE'),'members still cannot rewrite a device endpoint');
select throws_ok($$ insert into public.push_subscriptions(workspace_id,membership_id,user_id,endpoint,p256dh,auth_secret,quiet_start_hour)
  values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),'https://push.example/x',repeat('a',60),repeat('b',22),24) $$,
  '23514', null, 'quiet hours must be a valid hour');

select * from finish();
rollback;
