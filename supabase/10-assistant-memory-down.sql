-- ============================================================================
-- DOWN migration for 10-assistant-memory.sql.
-- WARNING: deletes everything the assistant has learned + all chat history.
-- ============================================================================

drop table if exists public.assistant_conversations;
drop table if exists public.assistant_memories;
