-- Kavach community reports. Paste into Supabase -> SQL Editor -> Run (once).
-- Only the Kavach API (service-role key, server-side) reads or writes these tables; row level security is on
-- with no policies, so the public anon key can do nothing.

create table if not exists public.reports (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  kind text not null check (kind in ('phone', 'upi', 'domain')),
  id_hash text not null,          -- salted SHA-256 of the number / UPI ID / website
  id_hint text not null,          -- XXXXXX3210, ra***@ybl, or the website
  category text,
  masked_text text,               -- message with numbers, UPI IDs and e-mails masked
  lang text,
  reporter text not null          -- salted hash of the reporter's IP, only to count distinct reporters
);
create index if not exists reports_hash_time on public.reports (id_hash, created_at desc);
create index if not exists reports_kind_time on public.reports (kind, created_at desc);

create table if not exists public.verdict_events (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  category text not null,
  level text not null
);
create index if not exists verdict_events_time on public.verdict_events (created_at desc);

alter table public.reports enable row level security;
alter table public.verdict_events enable row level security;

-- keep the free tier small: forget raw rows after 180 days (run from the SQL editor, or schedule with pg_cron)
-- delete from public.reports where created_at < now() - interval '180 days';
-- delete from public.verdict_events where created_at < now() - interval '180 days';
