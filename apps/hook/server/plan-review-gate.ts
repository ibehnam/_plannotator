/**
 * The review gate (this fork, local/README.md patch 35): with plan review off,
 * a person's own command can still ask for the review of one plan.
 *
 * Claude Code's ExitPlanMode permission request reaches the plan hook. Where
 * plan review is off by the person's own choice (`PLANNOTATOR_PLAN_REVIEW`,
 * config.json `planReview`), the hook runs `PLANNOTATOR_PLAN_REVIEW_GATE` with
 * `/bin/sh -c`, the hook event on its stdin. Exit 0 within the time limit:
 * review this plan, the classic blocking review. Any other exit, a failure to
 * start, or the time limit: no decision, so Claude Code shows its own dialog,
 * as upstream does. With no gate set, nothing runs: upstream's behaviour.
 *
 * The gate runs in a process group of its own, so the time limit stops what
 * it started too. Its stdout never reaches the hook's, which is the decision
 * channel; its stderr does, as a trace.
 */
import { childEnv } from "@plannotator/shared/child-env";

export const PLAN_REVIEW_GATE_ENV = "PLANNOTATOR_PLAN_REVIEW_GATE";
export const PLAN_REVIEW_GATE_TIMEOUT_MS = 5_000;

export async function planReviewGateOpens(
  eventJson: string,
  env: NodeJS.ProcessEnv = childEnv(),
  timeoutMs: number = PLAN_REVIEW_GATE_TIMEOUT_MS,
): Promise<boolean> {
  const command = env[PLAN_REVIEW_GATE_ENV];
  if (!command?.trim()) return false;
  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn(["/bin/sh", "-c", command], {
      detached: true,
      windowsHide: true,
      env,
      stdin: new TextEncoder().encode(eventJson),
      stdout: "ignore",
      stderr: "inherit",
    });
  } catch {
    return false;
  }
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    try {
      process.kill(-proc.pid, "SIGKILL");
    } catch {
      proc.kill("SIGKILL");
    }
  }, timeoutMs);
  try {
    return (await proc.exited) === 0 && !timedOut;
  } finally {
    clearTimeout(timer);
  }
}
