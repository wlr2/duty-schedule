-- Adds per-assignment block times so the timeline roster view works.
-- Run this ONCE in the Supabase SQL Editor. Safe to run more than once.
-- (The seed script also runs these, so you don't need both.)

alter table public.assignments add column if not exists start_time time;
alter table public.assignments add column if not exists end_time   time;
