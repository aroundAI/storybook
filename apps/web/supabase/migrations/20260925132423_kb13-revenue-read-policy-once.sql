/*
 * KB-13: row-level security cost about a second on a page of revenue.
 *
 * `revenue_records_read` decided a per-video row with
 *   exists (select … from publishes join episodes join projects
 *           where pub.id = revenue_records.publish_id and <access>)
 * which Postgres runs as a correlated subplan: once per revenue row, and
 * each run re-applies the RLS policies of publishes, episodes, projects and
 * accounts. A page of 100 videos with a year of daily revenue is 36,500
 * rows, so 36,500 walks of that chain.
 *
 * The same test is now written as
 *   publish_id in (select pub.id from publishes join episodes join projects
 *                  where <access>)
 * which is uncorrelated, so Postgres builds the set of publishes the caller
 * may read once per query (a hashed subplan) and checks each row against it.
 *
 * Who can see what is unchanged:
 *
 * - The access predicate is character for character the same, and the
 *   subquery still runs as the caller, under the same RLS on publishes,
 *   episodes, projects and accounts.
 * - For a row with a publish_id, `exists (… where pub.id = x and P)` and
 *   `x in (select pub.id … where P)` are true for exactly the same rows.
 *   For a NULL publish_id the first is false and the second NULL; a USING
 *   clause admits neither, and those rows are account-scoped anyway
 *   (revenue_records_single_scope_check).
 * - The account branch is untouched.
 *
 * Measured on a throwaway database with a page of 100 videos × 365 days
 * (the KB-13 shape): the read went from about 1.0–1.3 s to about 9 ms, and
 * at platform scale (200 more tenants, the owner with 2,000 videos) from
 * 1.6–4.0 s to about 140 ms. Tests: tests/database/revenue-read-access.test.sql.
 *
 * Only the read policy changes: the write policies apply to the rows being
 * written, a handful at a time.
 */

drop policy if exists "revenue_records_read" on public.revenue_records;

create policy "revenue_records_read" on public.revenue_records for select
  to authenticated using (
    (
      account_id is not null
      and public.has_account_access(account_id)
    )
    or publish_id in (
      select pub.id from public.publishes pub
      join public.episodes e on e.id = pub.episode_id
      join public.projects p on p.id = e.project_id
      where
        exists(
          select 1 from public.accounts a
          where a.id = p.account_id
          and a.primary_owner_user_id = auth.uid()
          and a.is_personal_account = true
        )
        or
        public.has_role_on_account(p.account_id)
    )
  );
