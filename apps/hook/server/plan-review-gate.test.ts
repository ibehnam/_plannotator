/**
 * The review gate (this fork, patch 35; plan-review-gate.ts). With plan review
 * off, `PLANNOTATOR_PLAN_REVIEW_GATE` runs on Claude Code's ExitPlanMode
 * permission request: exit 0 opens the classic review, anything else gives no
 * decision, and with no gate the hook does what upstream does. It fails when a
 * gate is ignored, when a refusing or slow gate still opens a review, when the
 * gate's stdout reaches the decision channel, or when a gate overrides a
 * host's own plan card or turns a review that is on into a question.
 * Runs use a temp HOME and data dir with the browser and Inbox connect disabled.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { removeStubbedHtml, stubHookDistHtml } from "../../../tests/helpers/hook-dist-stub";
import { NO_BROWSER } from "../../../tests/helpers/no-browser";
import { PLAN_REVIEW_GATE_ENV, PLAN_REVIEW_GATE_TIMEOUT_MS, planReviewGateOpens } from "./plan-review-gate";

const entry = resolve(import.meta.dir, "index.ts");
const roots: string[] = [];
let stubs: string[] = [];

beforeAll(() => {
  stubs = stubHookDistHtml();
});
afterAll(() => {
  removeStubbedHtml(stubs);
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function scratch(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "plannotator-review-gate-")));
  roots.push(root);
  return root;
}

const SESSION = "0b7c1f7e-1111-4222-8333-444455556666";
const EVENT = JSON.stringify({
  session_id: SESSION,
  transcript_path: "/nowhere/transcript.jsonl",
  cwd: "/work",
  permission_mode: "plan",
  hook_event_name: "PermissionRequest",
  tool_name: "ExitPlanMode",
  tool_input: { plan: "# Ship it\n\n1. Do the thing.\n" },
});

describe("planReviewGateOpens", () => {
  test("no gate: nothing runs and no review", async () => {
    for (const command of [undefined, "", "   "]) {
      expect(await planReviewGateOpens(EVENT, { [PLAN_REVIEW_GATE_ENV]: command })).toBe(false);
    }
  });

  test("exit 0 opens the review, and the gate reads the hook event on stdin", async () => {
    const out = join(scratch(), "event.json");
    const env = { PATH: process.env.PATH, OUT: out, [PLAN_REVIEW_GATE_ENV]: 'cat > "$OUT"' };
    expect(await planReviewGateOpens(EVENT, env)).toBe(true);
    expect(readFileSync(out, "utf8")).toBe(EVENT);
  });

  test("any other exit, or a command that cannot run, gives no review", async () => {
    for (const command of ["exit 1", "exit 2", "/nonexistent/plannotator-gate"]) {
      expect(await planReviewGateOpens(EVENT, { PATH: process.env.PATH, [PLAN_REVIEW_GATE_ENV]: command })).toBe(false);
    }
  });

  test("the time limit gives no review and stops what the gate started", async () => {
    expect(PLAN_REVIEW_GATE_TIMEOUT_MS).toBe(5_000);
    const pidFile = join(scratch(), "child.pid");
    const env = { PATH: process.env.PATH, PIDS: pidFile, [PLAN_REVIEW_GATE_ENV]: 'sleep 30 & echo $! > "$PIDS"; wait; exit 0' };
    const started = Date.now();
    expect(await planReviewGateOpens(EVENT, env, 400)).toBe(false);
    expect(Date.now() - started).toBeLessThan(4_000);
    const child = Number(readFileSync(pidFile, "utf8").trim());
    let alive = true;
    for (let tries = 0; tries < 40 && alive; tries += 1) {
      try {
        process.kill(child, 0);
        await Bun.sleep(25);
      } catch {
        alive = false;
      }
    }
    expect(alive).toBe(false);
  }, 15_000);
});

async function runHook(opts: { review?: string; marker?: string; gate?: string; timeoutMs: number }) {
  const root = scratch();
  const dataDir = join(root, "data");
  mkdirSync(dataDir, { recursive: true });
  const env: Record<string, string | undefined> = {
    ...process.env,
    HOME: join(root, "home"),
    PLANNOTATOR_DATA_DIR: dataDir,
    PLANNOTATOR_PORT: "0",
    PLANNOTATOR_REMOTE: "0",
    PLANNOTATOR_SKIP_BROWSER_OPEN: "1",
    NO_BROWSER,
    BROWSER: NO_BROWSER,
    PLANNOTATOR_BROWSER: NO_BROWSER,
    PLANNOTATOR_INBOX_CONNECT: "0",
    PLANNOTATOR_AI: "disabled",
    PLANNOTATOR_SHARE: "disabled",
    PLANNOTATOR_PLAN_REVIEW: opts.review,
    PLANNOTATOR_PLAN_REVIEW_SET_BY: opts.marker,
    [PLAN_REVIEW_GATE_ENV]: opts.gate,
    GATE_SEEN: join(root, "gate-seen.json"),
  };
  delete env.PLANNOTATOR_ASK_AI_CHILD;
  for (const name of ["PLANNOTATOR_PLAN_REVIEW", "PLANNOTATOR_PLAN_REVIEW_SET_BY", PLAN_REVIEW_GATE_ENV]) {
    if (env[name] === undefined) delete env[name];
  }
  const started = Date.now();
  const proc = Bun.spawn([process.execPath, "run", entry], {
    cwd: root,
    stdin: new TextEncoder().encode(EVENT),
    stdout: "pipe",
    stderr: "pipe",
    env,
  });
  const timer = setTimeout(() => proc.kill(), opts.timeoutMs);
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  clearTimeout(timer);
  const sessions = join(dataDir, "sessions");
  return {
    stdout,
    stderr,
    code,
    elapsed: Date.now() - started,
    sessions: existsSync(sessions) ? readdirSync(sessions) : [],
    gateSaw: existsSync(env.GATE_SEEN!) ? readFileSync(env.GATE_SEEN!, "utf8") : null,
  };
}

// The gate records the event it read, then answers.
const SEE = 'cat > "$GATE_SEEN"';

describe("Claude Code's ExitPlanMode with plan review off and a review gate", () => {
  test("no gate: exits 0 with no decision and no server, as upstream", async () => {
    const run = await runHook({ review: "0", timeoutMs: 20_000 });
    expect([run.code, run.stdout, run.sessions]).toEqual([0, "", []]);
    expect(run.stderr).not.toContain("http://");
  }, 30_000);

  test("a gate that says no: it read the event, and there is no decision and no server", async () => {
    const run = await runHook({ review: "0", gate: `${SEE}; exit 1`, timeoutMs: 20_000 });
    expect([run.code, run.stdout, run.sessions]).toEqual([0, "", []]);
    expect(run.stderr).not.toContain("http://");
    expect(run.gateSaw).toBe(EVENT);
  }, 30_000);

  test("a gate's stdout never reaches the decision channel", async () => {
    const run = await runHook({ review: "0", gate: `${SEE}; echo '{"decision":"allow"}'; exit 1`, timeoutMs: 20_000 });
    expect([run.code, run.stdout, run.sessions]).toEqual([0, "", []]);
  }, 30_000);

  test("a gate that says yes: the review opens", async () => {
    // The server waits for a decision. The timeout kills it once it is up.
    const run = await runHook({ review: "0", gate: `${SEE}; exit 0`, timeoutMs: 8_000 });
    expect(run.stdout).toBe("");
    expect(run.stderr).toContain("http://");
    expect(run.gateSaw).toBe(EVENT);
  }, 30_000);

  test("a gate that runs past the time limit: no decision and no server", async () => {
    const run = await runHook({ review: "0", gate: "sleep 30", timeoutMs: 20_000 });
    expect([run.code, run.stdout, run.sessions]).toEqual([0, "", []]);
    expect(run.elapsed).toBeLessThan(15_000);
  }, 30_000);

  test("a host's own plan card (the mod's marked 0 for this session): the gate is never asked", async () => {
    const run = await runHook({ review: "0", marker: `claude-code:${SESSION}`, gate: `${SEE}; exit 0`, timeoutMs: 20_000 });
    expect([run.code, run.stdout, run.sessions, run.gateSaw]).toEqual([0, "", [], null]);
  }, 30_000);

  test("review on: the gate is never asked and the review opens", async () => {
    const run = await runHook({ review: "1", gate: `${SEE}; exit 1`, timeoutMs: 8_000 });
    expect(run.stderr).toContain("http://");
    expect(run.gateSaw).toBeNull();
  }, 30_000);
});
