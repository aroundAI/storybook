-- KB-59: myfriends is a login with a password committed to the repo. It is
-- kept (owner, 2026-09-23), and it reads no rows because every table has RLS,
-- but nothing bounded what it could use up. Bound it (owner, 2026-09-30):
-- a few connections, and queries and idle transactions that end.
alter role myfriends connection limit 5;
alter role myfriends set statement_timeout = '5s';
alter role myfriends set idle_in_transaction_session_timeout = '10s';
