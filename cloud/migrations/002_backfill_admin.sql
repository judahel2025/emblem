-- One-time backfill: assign all legacy (pre-multi-user) rows to the admin account.
-- Admin = alliesjude@gmail.com (auth.users id 4ef3c659-38df-41f6-8adb-20a09e2665e7).
-- Run AFTER the admin-split deploy is live (its self-healing migrations add the columns).

begin;

update conversations    set user_id = '4ef3c659-38df-41f6-8adb-20a09e2665e7' where user_id is null;
update memory           set user_id = '4ef3c659-38df-41f6-8adb-20a09e2665e7' where user_id is null;
update notes            set user_id = '4ef3c659-38df-41f6-8adb-20a09e2665e7' where user_id is null;
update alerts           set user_id = '4ef3c659-38df-41f6-8adb-20a09e2665e7' where user_id is null;
update mail_messages    set user_id = '4ef3c659-38df-41f6-8adb-20a09e2665e7' where user_id is null;
update emails           set user_id = '4ef3c659-38df-41f6-8adb-20a09e2665e7' where user_id is null;
update scheduled_tasks  set user_id = '4ef3c659-38df-41f6-8adb-20a09e2665e7' where user_id is null;
update code_sessions    set user_id = '4ef3c659-38df-41f6-8adb-20a09e2665e7' where user_id is null;
update improvements     set user_id = '4ef3c659-38df-41f6-8adb-20a09e2665e7' where user_id is null;
update kernel_approvals set user_id = '4ef3c659-38df-41f6-8adb-20a09e2665e7' where user_id is null;

commit;
