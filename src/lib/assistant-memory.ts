// ============================================================================
// Addendum B: org-scoped backing store for the Anthropic Memory Tool.
// ----------------------------------------------------------------------------
// The model issues file commands (view/create/str_replace/insert/delete/
// rename) against a virtual /memories directory. Rows live in
// assistant_memories keyed by (org_id, path) — RLS guarantees one org can
// never read another's memory. This handler additionally rejects ANY path
// outside /memories (tested in scripts/test-memory-paths.ts BEFORE wiring).
// ============================================================================
import type { SupabaseClient } from "@supabase/supabase-js";

export const MEMORY_ROOT = "/memories";

/** Returns the normalized path, or null if it is unsafe / outside /memories. */
export function validateMemoryPath(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 300) return null;
  if (raw.includes("\0") || raw.includes("\\")) return null;
  // Collapse duplicate slashes, strip a single trailing slash.
  let p = raw.replace(/\/{2,}/g, "/");
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  if (p !== MEMORY_ROOT && !p.startsWith(MEMORY_ROOT + "/")) return null;
  // No traversal or hidden/empty segments anywhere.
  const segments = p.split("/").slice(1); // drop leading ''
  for (const seg of segments) {
    if (seg === "" || seg === "." || seg === ".." || seg.startsWith(".")) return null;
    if (!/^[\w][\w .-]*$/.test(seg)) return null;
  }
  return p;
}

interface MemoryRow {
  path: string;
  content: string;
  updated_at: string;
}

function numbered(content: string, range?: [number, number]): string {
  const lines = content.split("\n");
  const from = range ? Math.max(1, range[0]) : 1;
  const to = range ? Math.min(lines.length, range[1]) : lines.length;
  const out: string[] = [];
  for (let i = from; i <= to; i++) out.push(`${i}: ${lines[i - 1]}`);
  return out.join("\n");
}

/** Executes one Memory Tool command against the org's store.
 *  Always returns a string tool result ("Error: ..." on failure). */
export async function executeMemoryCommand(
  supabase: SupabaseClient,
  orgId: string,
  input: Record<string, unknown>,
): Promise<string> {
  const command = String(input.command ?? "");

  const read = async (path: string): Promise<MemoryRow | null> => {
    const { data } = await supabase
      .from("assistant_memories")
      .select("path, content, updated_at")
      .eq("org_id", orgId)
      .eq("path", path)
      .maybeSingle();
    return (data as MemoryRow) ?? null;
  };
  const write = async (path: string, content: string) => {
    await supabase
      .from("assistant_memories")
      .upsert(
        { org_id: orgId, path, content, updated_at: new Date().toISOString() },
        { onConflict: "org_id,path" },
      );
  };

  if (command === "view") {
    const path = validateMemoryPath(input.path);
    if (!path) return "Error: path must be inside /memories";
    if (path === MEMORY_ROOT) {
      const { data } = await supabase
        .from("assistant_memories")
        .select("path, updated_at")
        .eq("org_id", orgId)
        .order("path");
      const rows = (data ?? []) as { path: string; updated_at: string }[];
      if (rows.length === 0) return "Directory: /memories (empty — no memory files yet)";
      return `Directory: /memories\n${rows.map((r) => `- ${r.path}`).join("\n")}`;
    }
    const row = await read(path);
    if (!row) return `Error: ${path} does not exist`;
    const range = Array.isArray(input.view_range)
      ? ([Number(input.view_range[0]), Number(input.view_range[1])] as [number, number])
      : undefined;
    return numbered(row.content, range) || "(empty file)";
  }

  if (command === "create") {
    const path = validateMemoryPath(input.path);
    if (!path || path === MEMORY_ROOT) return "Error: provide a file path inside /memories";
    await write(path, String(input.file_text ?? ""));
    return `Created ${path}`;
  }

  if (command === "str_replace") {
    const path = validateMemoryPath(input.path);
    if (!path || path === MEMORY_ROOT) return "Error: provide a file path inside /memories";
    const row = await read(path);
    if (!row) return `Error: ${path} does not exist`;
    const oldStr = String(input.old_str ?? "");
    const newStr = String(input.new_str ?? "");
    const count = row.content.split(oldStr).length - 1;
    if (oldStr === "" || count === 0) return `Error: old_str not found in ${path}`;
    if (count > 1) return `Error: old_str appears ${count} times in ${path}; make it unique`;
    await write(path, row.content.replace(oldStr, newStr));
    return `Updated ${path}`;
  }

  if (command === "insert") {
    const path = validateMemoryPath(input.path);
    if (!path || path === MEMORY_ROOT) return "Error: provide a file path inside /memories";
    const row = await read(path);
    if (!row) return `Error: ${path} does not exist`;
    const lines = row.content.split("\n");
    const at = Math.max(0, Math.min(lines.length, Number(input.insert_line ?? 0)));
    lines.splice(at, 0, String(input.insert_text ?? ""));
    await write(path, lines.join("\n"));
    return `Inserted into ${path} at line ${at}`;
  }

  if (command === "delete") {
    const path = validateMemoryPath(input.path);
    if (!path) return "Error: path must be inside /memories";
    if (path === MEMORY_ROOT)
      return "Error: cannot delete the /memories directory itself (the manager can wipe memory from the review screen)";
    await supabase.from("assistant_memories").delete().eq("org_id", orgId).eq("path", path);
    return `Deleted ${path}`;
  }

  if (command === "rename") {
    const from = validateMemoryPath(input.old_path);
    const to = validateMemoryPath(input.new_path);
    if (!from || !to || from === MEMORY_ROOT || to === MEMORY_ROOT)
      return "Error: both paths must be files inside /memories";
    const row = await read(from);
    if (!row) return `Error: ${from} does not exist`;
    if (await read(to)) return `Error: ${to} already exists`;
    await supabase
      .from("assistant_memories")
      .update({ path: to, updated_at: new Date().toISOString() })
      .eq("org_id", orgId)
      .eq("path", from);
    return `Renamed ${from} -> ${to}`;
  }

  return `Error: unknown memory command "${command}"`;
}
