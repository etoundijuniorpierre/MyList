-- The existing public SELECT and administrator-only UPDATE policies also cover
-- this column. A whole grid is saved in a single atomic UPDATE.
alter table public.site_settings
  add column if not exists order_pricing jsonb default null
  constraint site_settings_order_pricing_object check (
    order_pricing is null or (
      jsonb_typeof(order_pricing) = 'object'
      and order_pricing ?& array['prices', 'gameTiers', 'gameDiscount']
      and jsonb_typeof(order_pricing->'prices') = 'array'
      and jsonb_typeof(order_pricing->'gameTiers') = 'array'
      and jsonb_typeof(order_pricing->'gameDiscount') = 'object'
    )
  );

comment on column public.site_settings.order_pricing is
  'Independent pricing for titles absent from the catalog. NULL uses the catalog pricing. Publicly readable, writable only by existing site administrators.';
