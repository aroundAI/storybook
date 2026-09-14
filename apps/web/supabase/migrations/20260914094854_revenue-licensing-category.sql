-- FILM-1609: add `licensing` to the revenue category vocabulary.
--
-- Licensing/IP income has no API on any platform and is manual entry
-- permanently, so it is exactly the kind of value a human picks from a
-- dropdown — an argument for extending the closed vocabulary rather than
-- loosening it to free text. `category` participates in
-- idx_revenue_records_unique_scope, so two spellings of one category would
-- occupy two rows for one day and one scope and defeat that index
-- silently.
--
-- A CHECK cannot be extended in place; it is dropped and re-added. The
-- constraint was already re-created once by 20260827104500, so the drop
-- targets the name that migration left behind rather than the original
-- schema-file text.

alter table public.revenue_records
  drop constraint if exists revenue_records_category_check;

alter table public.revenue_records
  add constraint revenue_records_category_check
  check (category in ('ads', 'premium', 'sponsorship', 'product', 'affiliate', 'licensing', 'other'));

comment on column public.revenue_records.category is 'Revenue category: ads, premium, sponsorship, product, affiliate, licensing, other';
