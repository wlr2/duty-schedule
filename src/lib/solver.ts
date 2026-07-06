// ============================================================================
// Solver interface — the seam between "what needs solving" and "how".
// ----------------------------------------------------------------------------
// Today there is one implementation: the greedy coverage-first engine in
// scheduler.ts. If the org ever outgrows it, drop in a new Solver (e.g. a
// FastAPI + OR-Tools CP-SAT service called over HTTP) without touching the
// schedule runner, the UI, or the AI assistant — they all depend only on
// SolverInput/CoverageResult.
// ============================================================================
import {
  generateCoverageSchedule,
  type CoverageResult,
} from "@/lib/scheduler";

export type SolverInput = Parameters<typeof generateCoverageSchedule>[0];

export interface Solver {
  readonly name: string;
  solve(input: SolverInput): Promise<CoverageResult> | CoverageResult;
}

/** Greedy coverage-first solver (in-process, sub-second at this scale). */
export const greedySolver: Solver = {
  name: "greedy-coverage-first",
  solve: generateCoverageSchedule,
};

/** The solver the app uses. Swap here to change the engine globally. */
export const defaultSolver: Solver = greedySolver;
