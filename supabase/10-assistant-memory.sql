-- ============================================================================
-- Addendum B: persistent memory + conversation history for the AI assistant.
-- Run ONCE in the Supabase SQL Editor. Safe to re-run. ADDITIVE ONLY.
-- Reversible via 10-assistant-memory-down.sql.
--
-- assistant_memories is the org-scoped store behind the Anthropic Memory
-- Tool's /memories directory: one row per file. Hard facts stay in the main
-- schema; memory holds the soft, learned layer (conventions, preferences,
-- corrections). One org can NEVER read another's memory (RLS below).
-- ============================================================================

create table if not exists public.assistant_memories (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations (id) on delete cascade,
  path       text not null, -- e.g. '/memories/scheduling_conventions.md'
  content    text not null default '',
  updated_at timestamptz not null default now(),
  unique (org_id, path)
);

create table if not exists public.assistant_conversations (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  title      text,
  messages   jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- RLS: the assistant runs as the signed-in manager; memory and history are
-- manager-only org data.
alter table public.assistant_memories     enable row level security;
alter table public.assistant_conversations enable row level security;

drop policy if exists am_all on public.assistant_memories;
create policy am_all on public.assistant_memories
  for all to authenticated
  using (public.is_manager() and org_id = public.current_org_id())
  with check (public.is_manager() and org_id = public.current_org_id());

drop policy if exists ac_all on public.assistant_conversations;
create policy ac_all on public.assistant_conversations
  for all to authenticated
  using (public.is_manager() and org_id = public.current_org_id())
  with check (public.is_manager() and org_id = public.current_org_id());

create index if not exists idx_am_org_path on public.assistant_memories (org_id, path);
create index if not exists idx_ac_org on public.assistant_conversations (org_id, updated_at desc);
