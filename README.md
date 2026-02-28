# Portfolio Website

This repository contains a static personal portfolio website with a dedicated blog page. The site is designed to be lightweight, fast, and easy to deploy, using plain HTML, CSS, and JavaScript.

## Website Overview

The website has three core views:

- **Home page** (`index.html`) — the main landing experience.
- **Projects page** (`projects.html`) — a curated overview of selected work.
- **Blog page** (`blog.html`) — blog content powered by frontend JavaScript.
- **Mock Shop page** (`shop.html`) — product catalog loaded from Supabase.

## Supabase Data Sources

The site currently reads Supabase data directly in the browser using the public anon key model.

- `assets/blog.js` reads `public.blogposts`.
- `assets/shop.js` reads `public.products` and maps these fields:
   - `id` (required, unique)
   - `product_name` (required)
   - `category`
   - `description`
   - `unit_price` (required)
   - `stock` (required; used for both product stock and ticket capacity)

RLS policies should allow read access only to intended public product rows/columns.
Checkout also updates `public.products.stock` after successful orders, so an appropriate `UPDATE` RLS policy is required for the rows you allow to be purchased.

### Supabase SQL (RLS + Stock Update)

Run this in Supabase SQL Editor for the current frontend anon-key model:

```sql
-- 1) Ensure RLS is enabled
alter table public.products enable row level security;

-- 2) Allow catalog reads for anon users
drop policy if exists "products_select_anon" on public.products;
create policy "products_select_anon"
on public.products
for select
to anon
using (true);

-- 3) Allow anon updates on purchasable rows
-- Adjust USING/WITH CHECK if you want to restrict by a boolean like is_active = true
drop policy if exists "products_update_stock_anon" on public.products;
create policy "products_update_stock_anon"
on public.products
for update
to anon
using (true)
with check (stock >= 0);

-- 4) Restrict anon updates to stock column only
grant usage on schema public to anon;
grant select on public.products to anon;
grant update (stock) on public.products to anon;

-- 5) Hardening: prevent anon from increasing stock
create or replace function public.enforce_stock_decrease_only()
returns trigger
language plpgsql
as $$
begin
   if new.stock > old.stock then
      raise exception 'stock can only decrease from client checkout';
   end if;

   if new.stock < 0 then
      raise exception 'stock cannot be negative';
   end if;

   return new;
end;
$$;

drop trigger if exists trg_products_enforce_stock_decrease_only on public.products;
create trigger trg_products_enforce_stock_decrease_only
before update of stock on public.products
for each row
execute function public.enforce_stock_decrease_only();
```

## Layout and File Structure

```text
portfolio2-main/
├─ index.html                # Main portfolio landing page
├─ projects.html             # Projects showcase page
├─ blog.html                 # Blog page
├─ vercel.json               # Deployment/routing + cache headers
├─ robots.txt
├─ sitemap.xml
└─ assets/
   ├─ index.min.css          # Home page optimized CSS
   ├─ style.css              # Shared styling for projects/blog
   ├─ transition.min.js      # Optimized transition script
   ├─ blog.js                # Blog page logic
   ├─ crane.jpg
   ├─ archive/
   │  └─ profile-images/
   │     ├─ profilepicCranes-400.avif
   │     ├─ profilepicCranes-400.jpg
   │     └─ profilepicCranes.jpeg
   ├─ resume_current.pdf
   └─ resume_ats.txt
```

## Performance Optimizations Implemented

This project received a focused optimization pass for faster load, improved Core Web Vitals, and leaner deployment:

- Removed Font Awesome dependency from `index.html`, `projects.html`, and `blog.html`.
- Replaced marquee icon `<i>` tags with inline Unicode symbols to eliminate webfont/CSS overhead.
- Improved hero image delivery on the home page with AVIF + JPEG fallback using `<picture>`.
- Added high-priority preload/fetch settings for the LCP hero image.
- Kept minified route-critical assets in use (`assets/index.min.css`, `assets/transition.min.js`).
- Preserved strong cache headers in `vercel.json` for static assets (`max-age=31536000, immutable`).
- Removed unneeded local optimization artifacts (temporary Lighthouse output and unused WebP variant).

## Lighthouse Snapshot (Desktop)

Latest optimization run reached a **100/100 Performance score** with key metrics in excellent range:

- FCP: ~0.2s
- LCP: ~0.3s
- TBT: 0ms
- CLS: 0

## Author Note

The latest performance optimization pass was authored by **GitHub Copilot (GPT-5.3-Codex)**.

## AI Development Note

This website and the user-facing implementation were developed with assistance from:

- **GPT-5.3-Codex**
- **Gemini 3.1 Pro**

