/**
 * Closing a session's browser tab from outside the page, for the done screen.
 *
 * A page may close its own tab with `window.close()` only when a script opened
 * the tab, or while the tab's back/forward list holds a single entry (Chrome:
 * `OpenedByDOM`, or `BackForwardLength() == 1`). Plannotator opens its tab with
 * `open URL`, and the annotate app adds a history entry for every linked page a
 * review opens (its Back and Forward), so after one followed link the done
 * screen's `window.close()` is refused, whoever started the session.
 *
 * On macOS the server can close the tab instead, through the browser's own
 * AppleScript: every tab whose address is this session's (its port, on each
 * loopback name), in each running browser whose dictionary lists windows, tabs
 * and their URLs. A browser that is not running is never asked, so none is
 * launched, and macOS asks about Automation only for one that is. A remote
 * session's browser is on another machine, and other platforms have no such
 * interface, so there the page's own close is all there is.
 *
 * The page asks the moment its done screen appears, while the session is
 * certainly up, with its countdown (`{ afterMs }`): the request is held and the
 * tabs are closed when the countdown ends. The session stays up for it
 * (`settleSession`, what every server does between its decision and its stop),
 * so the answer reaches the page whatever opened the tab.
 */
import { spawn } from "node:child_process";
import { isSameOriginOrNoOrigin } from "@plannotator/shared/request-origin";
import { isRemoteSession } from "./remote";

/** The browsers whose AppleScript lists windows, tabs and each tab's URL. The
 *  Chromium family shares one dictionary (tabs with ids); Safari's has none. */
export const SCRIPTABLE_BROWSERS: ReadonlyArray<{ id: string; kind: "chromium" | "safari" }> = [
  { id: "com.brave.Browser", kind: "chromium" },
  { id: "com.google.Chrome", kind: "chromium" },
  { id: "com.google.Chrome.canary", kind: "chromium" },
  { id: "org.chromium.Chromium", kind: "chromium" },
  { id: "com.microsoft.edgemac", kind: "chromium" },
  { id: "company.thebrowser.Browser", kind: "chromium" },
  { id: "com.vivaldi.Vivaldi", kind: "chromium" },
  { id: "com.apple.Safari", kind: "safari" },
];

/** The addresses this session's tabs start with: its port on each loopback name. */
export function sessionTabPrefixes(port: number): string[] {
  return [`http://localhost:${port}/`, `http://127.0.0.1:${port}/`, `http://[::1]:${port}/`];
}

/**
 * The AppleScript that closes, in the browser BROWSER_ID, every tab whose URL
 * starts with one of the prefixes it is given as arguments, and returns how many
 * it closed. A Chromium tab is closed by its id, collected first, so closing
 * one never shifts the next; Safari closes each prefix's tabs in one command.
 */
export function closeTabScript(browserId: string, kind: "chromium" | "safari"): string {
  if (kind === "safari") {
    return [
      "on run argv",
      "  set closedCount to 0",
      `  tell application id "${browserId}"`,
      "    repeat with w in windows",
      "      repeat with p in argv",
      "        set doomed to (tabs of w whose URL starts with (p as text))",
      "        set n to count of doomed",
      "        if n > 0 then",
      "          close doomed",
      "          set closedCount to closedCount + n",
      "        end if",
      "      end repeat",
      "    end repeat",
      "  end tell",
      "  return closedCount",
      "end run",
    ].join("\n");
  }
  return [
    "on run argv",
    "  set closedCount to 0",
    `  tell application id "${browserId}"`,
    "    repeat with w in windows",
    "      set doomed to {}",
    "      repeat with t in tabs of w",
    "        set u to URL of t",
    "        repeat with p in argv",
    "          if u starts with (p as text) then",
    "            set end of doomed to (id of t)",
    "            exit repeat",
    "          end if",
    "        end repeat",
    "      end repeat",
    "      repeat with i in doomed",
    "        close (tab id i of w)",
    "        set closedCount to closedCount + 1",
    "      end repeat",
    "    end repeat",
    "  end tell",
    "  return closedCount",
    "end run",
  ].join("\n");
}

export interface OsascriptResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** The exit `runOsascript` gives a run it stopped. */
export const OSASCRIPT_TIMED_OUT = 124;

/** Run `osascript` with ARGS, stopped after TIMEOUT_MS; a failure to start reads as a non-zero exit. */
export function runOsascript(args: string[], timeoutMs = 5_000): Promise<OsascriptResult> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (result: OsascriptResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const child = spawn("osascript", args, { stdio: ["ignore", "pipe", "pipe"] });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish({ code: OSASCRIPT_TIMED_OUT, stdout, stderr: stderr || "osascript timed out" });
    }, timeoutMs);
    child.stdout?.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.once("error", (error) => finish({ code: 127, stdout, stderr: String(error) }));
    child.once("close", (code) => finish({ code: code ?? 1, stdout, stderr }));
  });
}

/** Why no tab was closed: the done screen names it. `timeout`: a close script ran out of time, which is
 *  what macOS's Automation prompt, waiting for an answer, looks like from here. */
export type CloseTabRefusal = "remote" | "platform" | "no-browser" | "not-authorized" | "timeout" | "failed";

export interface CloseTabOutcome {
  /** How many of this session's tabs were closed. */
  closed: number;
  /** Set when none was: why. */
  reason?: CloseTabRefusal;
  /** The browsers that answered, by bundle id, for the done screen's hint. */
  browsers: string[];
}

/**
 * Close every tab of the session on PORT in each running scriptable browser.
 * RUN stands in for `osascript` in tests; PLATFORM and REMOTE for the host.
 */
export async function closeSessionTabs(
  port: number,
  options: { platform?: NodeJS.Platform; remote?: boolean; run?: (args: string[]) => Promise<OsascriptResult> } = {},
): Promise<CloseTabOutcome> {
  const platform = options.platform ?? process.platform;
  const remote = options.remote ?? isRemoteSession();
  const run = options.run ?? ((args: string[]) => runOsascript(args));
  if (remote) return { closed: 0, reason: "remote", browsers: [] };
  if (platform !== "darwin") return { closed: 0, reason: "platform", browsers: [] };
  const prefixes = sessionTabPrefixes(port);
  // Every browser at once: each check and its close script take up to 5 s.
  const answers = await Promise.all(SCRIPTABLE_BROWSERS.map(async (browser) => {
    // `is running` sends nothing to the browser: a missing one errors, and is skipped.
    const probe = await run(["-e", `application id "${browser.id}" is running`]);
    if (probe.code !== 0 || probe.stdout.trim() !== "true") return null;
    return { id: browser.id, result: await run(["-e", closeTabScript(browser.id, browser.kind), ...prefixes]) };
  }));
  let closed = 0;
  let notAuthorized = false;
  let timedOut = false;
  let failed = false;
  const browsers: string[] = [];
  for (const answer of answers) {
    if (!answer) continue;
    browsers.push(answer.id);
    const { result } = answer;
    if (result.code === 0) {
      closed += Number.parseInt(result.stdout.trim(), 10) || 0;
    } else if (/-1743|not authori[sz]ed|not allowed/i.test(result.stderr)) {
      notAuthorized = true;
    } else if (result.code === OSASCRIPT_TIMED_OUT) {
      timedOut = true;
    } else {
      failed = true;
    }
  }
  if (closed > 0) return { closed, browsers };
  const reason: CloseTabRefusal = notAuthorized ? "not-authorized" : timedOut ? "timeout" : failed ? "failed" : "no-browser";
  return { closed: 0, reason, browsers };
}

/** The longest the server holds a close for the page's countdown. */
export const MAX_CLOSE_AFTER_MS = 5_000;

/**
 * How long past its countdown a held close may run: the browsers' checks and
 * close scripts, all at once, each stopped at 5 s (a first close waits on
 * macOS's Automation prompt), and a margin.
 */
export const CLOSE_GRACE_MS = 6_000;

/** The closes the page asked for that are not answered yet, each with the time it must be over by. */
const pendingCloses = new Map<Promise<unknown>, number>();

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * What a session does between its decision and its stop: MS (the done screen's
 * own requests), then every close the page asked for, each until it is
 * answered or its bound passes, so the server stops the moment the last answer
 * is out. With none asked, MS, as before.
 */
export async function settleSession(ms: number): Promise<void> {
  await sleep(ms);
  for (;;) {
    const now = Date.now();
    for (const [work, deadline] of pendingCloses) if (deadline <= now) pendingCloses.delete(work);
    if (pendingCloses.size === 0) break;
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      Promise.allSettled([...pendingCloses.keys()]),
      new Promise<void>((resolve) => { timer = setTimeout(resolve, Math.max(...pendingCloses.values()) - now); }),
    ]);
    clearTimeout(timer);
  }
  // The last answer is handed to its socket before the server stops.
  await sleep(0);
}

/** The page's countdown from its body (`{ afterMs }`), at most MAX_CLOSE_AFTER_MS; none when absent or malformed. */
async function closeDelay(req: Request): Promise<number> {
  try {
    const body: unknown = await req.json();
    const afterMs = body && typeof body === "object" ? (body as { afterMs?: unknown }).afterMs : undefined;
    if (typeof afterMs !== "number" || !Number.isFinite(afterMs)) return 0;
    return Math.min(MAX_CLOSE_AFTER_MS, Math.max(0, Math.round(afterMs)));
  } catch {
    return 0;
  }
}

/**
 * POST /api/close-tab: the done screen's request for a tab that cannot close
 * itself, made as the screen appears, with its countdown (`{ afterMs }`, at
 * most 5 s). The request is held for the countdown, the tabs are closed, and
 * the outcome is the answer, as JSON; the session stays up for it
 * (`settleSession`). Same-origin only. WAIT and GRACE_MS stand in for the
 * countdown's sleep and the bound in tests.
 */
export async function handleCloseTabRequest(
  req: Request,
  url: URL,
  close: (port: number) => Promise<CloseTabOutcome> = (port) => closeSessionTabs(port),
  options: { wait?: (ms: number) => Promise<void>; graceMs?: number } = {},
): Promise<Response> {
  if (!isSameOriginOrNoOrigin(req.headers.get("origin"), url.host, req.headers.get("sec-fetch-site"))) {
    return Response.json({ error: "Cross-origin requests are not allowed" }, { status: 403 });
  }
  const port = Number.parseInt(url.port, 10);
  if (!Number.isInteger(port) || port <= 0) return Response.json({ closed: 0, reason: "failed", browsers: [] });
  const afterMs = await closeDelay(req);
  const wait = options.wait ?? sleep;
  const work = (async () => {
    await wait(afterMs);
    return close(port);
  })();
  pendingCloses.set(work, Date.now() + afterMs + (options.graceMs ?? CLOSE_GRACE_MS));
  const done = () => { pendingCloses.delete(work); };
  work.then(done, done);
  return Response.json(await work);
}
