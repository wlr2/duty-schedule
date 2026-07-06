import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { generateForPeriod } from "@/lib/schedule-runner";
import { minToTimeStr, todayISO } from "@/lib/scheduler";

// Use the latest capable model. Switch to "claude-haiku-4-5" here for lower cost.
const MODEL = "claude-opus-4-8";

const COLORS = ["#2563eb", "#0d9488", "#b45309", "#7c3aed", "#db2777", "#0891b2", "#65a30d"];

// Tools that change data. They only execute when the manager has confirmed
// (the client sends confirmed: true after the manager clicks "Yes, apply it").
const WRITE_TOOLS = new Set([
  "create_position",
  "delete_position",
  "set_eligibility",
  "generate_schedule",
]);

// Marker the model appends when it is waiting for the manager's go-ahead.
const CONFIRM_MARKER = "[CONFIRM_REQUIRED]";

function systemPrompt(today: string) {
  return `You are the scheduling assistant for DutyRoster, a duty/shift scheduling app. You help a MANAGER set up their schedule by talking to them in plain language and calling tools. Today is ${today}.

HOW SCHEDULING WORKS HERE:
- A "position" is a role that needs people on duty (e.g. Sentry, Dishwasher, Server). Each position has: a coverage window (start–end time), a headcount (how many people on duty AT ONCE), and either a ROTATION (each person works N hours then rests M hours, with others covering) or ONE CONTINUOUS shift.
- "Eligibility" limits which staff can work a position. If you set none, everyone is eligible.
- The engine then guarantees the required headcount is covered across the whole window, rotating people with rest.

ADAPT TO THE MANAGER'S CONTEXT — this is the most important thing:
- MILITARY / GUARD / NATIONAL SERVICE (NS) duty (posts like Sentry, PAC, VAC, Guard): use ROTATION. Typically headcount 1 per post, rotate every 2 hours with 2 hours rest, everyone eligible. Create one position per post over the guard window (ask the window if unknown, e.g. 08:00–20:00 or 24h).
- NORMAL JOBS (restaurant, retail, warehouse, hospital, events): usually CONTINUOUS shifts with a headcount (e.g. "5 dishwashers, 11:00–22:00"). Create one position per role and set who is eligible for it.

CONFIRMATION PROTOCOL — never change anything without the manager's OK:
- Reading (list_positions, list_staff, get_schedule) is always allowed; just do it.
- Any CHANGE (create/delete positions, eligibility, generating a schedule) must be confirmed first. When you are ready to make changes, DO NOT call the write tools yet. Instead, present the complete plan in plain language (every position: window, headcount, rotation, eligibility; every deletion; the date range of any schedule), then end your reply with the exact line:
${CONFIRM_MARKER}
- If a write tool returns "BLOCKED", that means confirmation is still missing — present the plan as above instead of retrying.
- Once the manager confirms, call the tools and report what you did.

YOUR JOB:
1. Understand what they run. Ask SHORT clarifying questions only when you truly need them (hours, how many at once, rotating vs continuous).
2. Use list_staff before proposing eligibility — only use names that exist, and tell the manager if some are missing.
3. Summarize schedules in plain English when asked (use get_schedule): who works when, total coverage, anything unusual.
4. If a generated schedule has unfilled slots, explain the likely cause in plain words (too few eligible people, rest rules, availability) and suggest the smallest fix — e.g. "add one more person eligible for PAC, or shorten the overnight window".

RULES:
- Times are 24-hour "HH:MM". Be concise and friendly. Don't invent staff. Don't ask more than 1–2 questions at a time. If the manager gives enough detail, propose the plan right away.`;
}

interface ToolOutcome {
  result: string;
  action?: string;
}

async function getStaff(supabase: SupabaseClient, orgId: string) {
  const { data } = await supabase
    .from("profiles")
    .select("id, full_name")
    .eq("org_id", orgId)
    .eq("role", "employee");
  return (data ?? []) as { id: string; full_name: string | null }[];
}

function matchNames(
  staff: { id: string; full_name: string | null }[],
  names: string[],
): { ids: string[]; missing: string[] } {
  const ids: string[] = [];
  const missing: string[] = [];
  for (const n of names) {
    const hit = staff.find((s) => (s.full_name ?? "").toLowerCase() === n.trim().toLowerCase());
    if (hit) ids.push(hit.id);
    else missing.push(n);
  }
  return { ids, missing };
}

async function executeTool(
  supabase: SupabaseClient,
  orgId: string,
  name: string,
  input: Record<string, unknown>,
): Promise<ToolOutcome> {
  if (name === "list_positions") {
    const { data } = await supabase
      .from("shift_types")
      .select("name, start_time, end_time, required_staff, block_minutes, min_rest_minutes")
      .eq("org_id", orgId);
    const list = (data ?? []).map((p) => ({
      name: p.name,
      window: `${p.start_time}-${p.end_time}`,
      on_at_once: p.required_staff,
      style:
        p.block_minutes == null
          ? "continuous"
          : `rotate ${p.block_minutes / 60}h / rest ${p.min_rest_minutes / 60}h`,
    }));
    return { result: JSON.stringify(list) };
  }

  if (name === "list_staff") {
    const staff = await getStaff(supabase, orgId);
    return { result: JSON.stringify(staff.map((s) => s.full_name ?? "Unnamed")) };
  }

  if (name === "get_schedule") {
    const start = String(input.start_date ?? "");
    const end = String(input.end_date ?? "");
    if (!start || !end) return { result: "Error: start_date and end_date (YYYY-MM-DD) required." };
    const { data, error } = await supabase
      .from("assignments")
      .select("work_date, start_time, end_time, status, shift_types(name), profiles(full_name)")
      .eq("org_id", orgId)
      .gte("work_date", start)
      .lte("work_date", end)
      .order("work_date")
      .order("start_time")
      .limit(500);
    if (error) return { result: `Error: ${error.message}` };
    const rows = (data ?? []).map((a) => {
      const pos = (a.shift_types as unknown as { name: string } | null)?.name ?? "?";
      const who = (a.profiles as unknown as { full_name: string | null } | null)?.full_name;
      return `${a.work_date} ${a.start_time ?? ""}-${a.end_time ?? ""} ${pos}: ${
        who ?? `UNFILLED (${a.status})`
      }`;
    });
    return {
      result: rows.length === 0 ? "No assignments in that range." : rows.join("\n"),
    };
  }

  if (name === "create_position") {
    const posName = String(input.name ?? "").trim();
    const start = String(input.start_time ?? "");
    const end = String(input.end_time ?? "");
    const headcount = Math.max(1, Number(input.headcount ?? 1));
    const continuous = String(input.rotation ?? "continuous") === "continuous";
    const rotateHours = Math.max(0.5, Number(input.rotate_hours ?? 2));
    const restHours = Math.max(0, Number(input.rest_hours ?? 2));
    if (!posName || !start || !end) return { result: "Error: name, start_time and end_time are required." };

    const { data: pos, error } = await supabase
      .from("shift_types")
      .insert({
        org_id: orgId,
        name: posName,
        start_time: start,
        end_time: end,
        required_staff: headcount,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        block_minutes: continuous ? null : Math.round(rotateHours * 60),
        min_rest_minutes: continuous ? 0 : Math.round(restHours * 60),
      })
      .select("id")
      .single();
    if (error || !pos) return { result: `Error creating position: ${error?.message}` };

    // Keep the Phase 1 keystone in sync: one daily coverage band mirroring the
    // position window (Phase 3 reads these; multi-band editing comes later).
    await supabase.from("coverage_requirements").insert({
      org_id: orgId,
      position_id: pos.id,
      day_of_week: null,
      start_time: start,
      end_time: end,
      min_headcount: headcount,
    });

    let eligibilityNote = "everyone eligible";
    const eligibleNames = Array.isArray(input.eligible_names)
      ? (input.eligible_names as unknown[]).map(String)
      : [];
    if (eligibleNames.length > 0) {
      const staff = await getStaff(supabase, orgId);
      const { ids, missing } = matchNames(staff, eligibleNames);
      if (ids.length > 0) {
        await supabase
          .from("position_members")
          .insert(ids.map((employee_id) => ({ org_id: orgId, position_id: pos.id, employee_id })));
        eligibilityNote = `${ids.length} eligible`;
      }
      if (missing.length > 0) eligibilityNote += ` (not found: ${missing.join(", ")})`;
    }

    return {
      result: `Created "${posName}" ${start}-${end}, ${headcount} at once, ${continuous ? "continuous shift" : `rotate ${rotateHours}h/rest ${restHours}h`}, ${eligibilityNote}.`,
      action: `Created position ${posName}`,
    };
  }

  if (name === "delete_position") {
    const posName = String(input.name ?? "").trim();
    const { data: pos } = await supabase
      .from("shift_types")
      .select("id, name")
      .eq("org_id", orgId)
      .ilike("name", posName)
      .maybeSingle();
    if (!pos) return { result: `No position named "${posName}".` };
    await supabase.from("shift_types").delete().eq("id", pos.id);
    return { result: `Deleted "${pos.name}".`, action: `Deleted position ${pos.name}` };
  }

  if (name === "set_eligibility") {
    const posName = String(input.position_name ?? "").trim();
    const names = Array.isArray(input.employee_names)
      ? (input.employee_names as unknown[]).map(String)
      : [];
    const { data: pos } = await supabase
      .from("shift_types")
      .select("id, name")
      .eq("org_id", orgId)
      .ilike("name", posName)
      .maybeSingle();
    if (!pos) return { result: `No position named "${posName}".` };

    const staff = await getStaff(supabase, orgId);
    const { ids, missing } = matchNames(staff, names);
    await supabase.from("position_members").delete().eq("position_id", pos.id);
    if (ids.length > 0) {
      await supabase
        .from("position_members")
        .insert(ids.map((employee_id) => ({ org_id: orgId, position_id: pos.id, employee_id })));
    }
    let note = `${pos.name}: ${ids.length === 0 ? "everyone" : `${ids.length} eligible`}.`;
    if (missing.length > 0) note += ` Not found: ${missing.join(", ")}.`;
    return { result: note, action: `Set eligibility for ${pos.name}` };
  }

  if (name === "generate_schedule") {
    const start = String(input.start_date ?? "");
    const end = String(input.end_date ?? "");
    if (!start || !end) return { result: "Error: start_date and end_date (YYYY-MM-DD) required." };
    const { data: period, error } = await supabase
      .from("schedule_periods")
      .insert({ org_id: orgId, start_date: start, end_date: end, status: "draft" })
      .select("id, start_date, end_date")
      .single();
    if (error || !period) return { result: `Error: ${error?.message}` };
    const res = await generateForPeriod(supabase, orgId, period);

    // Structured solver diagnostics: which slots failed, and why each person
    // was blocked — the model turns this into a plain-English explanation.
    let gapDetail = "";
    if (res.gapDetails.length > 0) {
      const lines = res.gapDetails.slice(0, 12).map((g) => {
        const why = g.reasons.length > 0 ? ` — ${g.reasons.slice(0, 4).join("; ")}` : "";
        return `${g.date} ${minToTimeStr(g.startMin)}-${minToTimeStr(g.endMin)} ${g.positionName}: ${g.missing} short${why}`;
      });
      gapDetail = ` UNFILLED (with per-person blockers):\n${lines.join("\n")}`;
    }
    let relaxNote = "";
    if (res.relaxations.length > 0) {
      const byRule: Record<string, number> = {};
      for (const r of res.relaxations) byRule[r.rule] = (byRule[r.rule] ?? 0) + 1;
      relaxNote = ` NOTE: coverage required bending soft rules ${JSON.stringify(byRule)} (rest/hour/consecutive-day exceptions — tell the manager honestly).`;
    }
    return {
      result: `Draft schedule created for ${start} to ${end}. ${res.gaps} unfilled slot(s). The manager can review and publish it under "Schedule".${gapDetail}${relaxNote}`,
      action: `Generated draft schedule (${res.gaps} gaps)`,
    };
  }

  return { result: `Unknown tool: ${name}` };
}

const TOOLS: Anthropic.Tool[] = [
  {
    name: "list_positions",
    description: "List the positions already configured for this org.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "list_staff",
    description: "List the names of staff (employees) who have joined this org.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_schedule",
    description:
      "Read the roster between two dates: who works which position and when, including unfilled slots. Use for summaries and questions like 'who's on duty Friday?'.",
    input_schema: {
      type: "object",
      properties: {
        start_date: { type: "string", description: "YYYY-MM-DD" },
        end_date: { type: "string", description: "YYYY-MM-DD" },
      },
      required: ["start_date", "end_date"],
    },
  },
  {
    name: "create_position",
    description:
      "Create a position (a role that needs people on duty). Use rotation for guard/NS posts, continuous for normal jobs. Requires manager confirmation first.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Position name, e.g. Sentry or Dishwasher" },
        start_time: { type: "string", description: "Coverage start, 24h HH:MM" },
        end_time: { type: "string", description: "Coverage end, 24h HH:MM" },
        headcount: { type: "integer", description: "How many people on duty at once" },
        rotation: {
          type: "string",
          enum: ["rotating", "continuous"],
          description: "rotating = each person works a block then rests; continuous = one shift",
        },
        rotate_hours: { type: "number", description: "Hours each person works before resting (rotating only)" },
        rest_hours: { type: "number", description: "Hours of rest between blocks (rotating only)" },
        eligible_names: {
          type: "array",
          items: { type: "string" },
          description: "Names of staff allowed to work this. Omit/empty = everyone.",
        },
      },
      required: ["name", "start_time", "end_time", "headcount", "rotation"],
    },
  },
  {
    name: "delete_position",
    description: "Delete a position by name. Requires manager confirmation first.",
    input_schema: {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
    },
  },
  {
    name: "set_eligibility",
    description:
      "Set which staff can work a position (replaces the current list). Empty list = everyone. Requires manager confirmation first.",
    input_schema: {
      type: "object",
      properties: {
        position_name: { type: "string" },
        employee_names: { type: "array", items: { type: "string" } },
      },
      required: ["position_name", "employee_names"],
    },
  },
  {
    name: "generate_schedule",
    description:
      "Generate a DRAFT roster for a date range using the configured positions. Requires manager confirmation first.",
    input_schema: {
      type: "object",
      properties: {
        start_date: { type: "string", description: "YYYY-MM-DD" },
        end_date: { type: "string", description: "YYYY-MM-DD" },
      },
      required: ["start_date", "end_date"],
    },
  },
];

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Please log in." }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("org_id, role")
    .eq("id", user.id)
    .single();
  if (!profile || profile.role !== "manager") {
    return Response.json({ error: "Only managers can use the assistant." }, { status: 403 });
  }
  const orgId = profile.org_id as string;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return Response.json({
      reply:
        "The AI assistant isn't switched on yet. Add your Anthropic API key as ANTHROPIC_API_KEY in the .env.local file (from console.anthropic.com), then restart the app.",
      actions: [],
      messages: [],
      notConfigured: true,
    });
  }

  let body: { messages?: Anthropic.MessageParam[]; confirmed?: boolean };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Bad request." }, { status: 400 });
  }
  const messages: Anthropic.MessageParam[] = Array.isArray(body.messages)
    ? body.messages.slice(-50)
    : [];
  const confirmed = body.confirmed === true;

  const anthropic = new Anthropic({ apiKey });
  const today = todayISO();
  const actions: string[] = [];
  let blockedWrite = false;

  try {
    for (let i = 0; i < 6; i++) {
      const resp = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 2000,
        system: systemPrompt(today),
        tools: TOOLS,
        messages,
      });
      messages.push({ role: "assistant", content: resp.content });

      if (resp.stop_reason !== "tool_use") {
        let reply = resp.content
          .filter((b): b is Anthropic.TextBlock => b.type === "text")
          .map((b) => b.text)
          .join("\n")
          .trim();
        const needsConfirm = blockedWrite || reply.includes(CONFIRM_MARKER);
        reply = reply.split(CONFIRM_MARKER).join("").trim();
        return Response.json({ reply, actions, messages, needsConfirm });
      }

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of resp.content) {
        if (block.type === "tool_use") {
          let outcome: ToolOutcome;
          if (WRITE_TOOLS.has(block.name) && !confirmed) {
            blockedWrite = true;
            outcome = {
              result:
                "BLOCKED — manager confirmation required. Do not retry. Present the full plan of every change in plain language, then end your reply with the exact line " +
                CONFIRM_MARKER,
            };
          } else {
            outcome = await executeTool(
              supabase,
              orgId,
              block.name,
              (block.input ?? {}) as Record<string, unknown>,
            );
          }
          if (outcome.action) actions.push(outcome.action);
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: outcome.result,
          });
        }
      }
      messages.push({ role: "user", content: toolResults });
    }
    return Response.json({
      reply: "That took a few steps — could you confirm what you'd like me to do next?",
      actions,
      messages,
      needsConfirm: blockedWrite,
    });
  } catch (err) {
    console.error("Assistant error:", err);
    return Response.json(
      { error: "The assistant hit an error. Check your API key and try again." },
      { status: 200 },
    );
  }
}
