import { describe, expect, test } from "bun:test";
import {
  closeSessionTabs,
  closeTabScript,
  handleCloseTabRequest,
  MAX_CLOSE_AFTER_MS,
  sessionTabPrefixes,
  settleSession,
  SCRIPTABLE_BROWSERS,
  type CloseTabOutcome,
  type OsascriptResult,
} from "./close-tab";

/** A stand-in for osascript: RUNNING answers each `is running` probe; CLOSE answers a close script, by bundle id. */
function fakeOsascript(running: Record<string, boolean>, close: (id: string, args: string[]) => OsascriptResult) {
  const calls: string[][] = [];
  const run = async (args: string[]): Promise<OsascriptResult> => {
    calls.push(args);
    const source = args[1] ?? "";
    const probe = /^application id "([^"]+)" is running$/.exec(source);
    if (probe) {
      const id = probe[1]!;
      if (!(id in running)) return { code: 1, stdout: "", stderr: `Can't get application id "${id}". (-1728)` };
      return { code: 0, stdout: running[id] ? "true\n" : "false\n", stderr: "" };
    }
    const target = /tell application id "([^"]+)"/.exec(source)?.[1] ?? "";
    return close(target, args.slice(2));
  };
  return { run, calls };
}

describe("closing a session's tab from the server", () => {
  test("a session's tabs are its port on each loopback name", () => {
    expect(sessionTabPrefixes(51747)).toEqual([
      "http://localhost:51747/",
      "http://127.0.0.1:51747/",
      "http://[::1]:51747/",
    ]);
  });

  test("only a running browser is sent its close script, with the session's prefixes, and the closed tabs are counted", async () => {
    const { run, calls } = fakeOsascript(
      { "com.brave.Browser": true, "com.google.Chrome": false, "com.apple.Safari": true },
      (id) => ({ code: 0, stdout: id === "com.brave.Browser" ? "2\n" : "0\n", stderr: "" }),
    );
    const outcome = await closeSessionTabs(51747, { platform: "darwin", remote: false, run });
    expect(outcome).toEqual({ closed: 2, browsers: ["com.brave.Browser", "com.apple.Safari"] });
    const scripts = calls.filter((args) => !/ is running$/.test(args[1] ?? ""));
    expect(scripts.map((args) => /tell application id "([^"]+)"/.exec(args[1]!)?.[1])).toEqual([
      "com.brave.Browser",
      "com.apple.Safari",
    ]);
    for (const args of scripts) expect(args.slice(2)).toEqual(sessionTabPrefixes(51747));
    // Every known browser was probed, Chrome (not running) and the missing ones too, and none launched.
    expect(calls.filter((args) => / is running$/.test(args[1] ?? ""))).toHaveLength(SCRIPTABLE_BROWSERS.length);
  });

  test("macOS refusing the Apple event reads as not authorized, which the done screen explains", async () => {
    const { run } = fakeOsascript({ "com.brave.Browser": true }, () => ({
      code: 1,
      stdout: "",
      stderr: "execution error: Not authorized to send Apple events to Brave Browser. (-1743)",
    }));
    expect(await closeSessionTabs(51747, { platform: "darwin", remote: false, run }))
      .toEqual({ closed: 0, reason: "not-authorized", browsers: ["com.brave.Browser"] });
  });

  test("no scriptable browser running, a remote session, and another platform close nothing and say why, asking osascript nothing when it cannot help", async () => {
    const idle = fakeOsascript({}, () => ({ code: 0, stdout: "0\n", stderr: "" }));
    expect(await closeSessionTabs(1, { platform: "darwin", remote: false, run: idle.run }))
      .toEqual({ closed: 0, reason: "no-browser", browsers: [] });
    const never = fakeOsascript({ "com.brave.Browser": true }, () => ({ code: 0, stdout: "1\n", stderr: "" }));
    expect(await closeSessionTabs(1, { platform: "darwin", remote: true, run: never.run }))
      .toEqual({ closed: 0, reason: "remote", browsers: [] });
    expect(await closeSessionTabs(1, { platform: "linux", remote: false, run: never.run }))
      .toEqual({ closed: 0, reason: "platform", browsers: [] });
    expect(never.calls).toHaveLength(0);
  });

  test("the Chromium script closes tabs by the ids it collected first, Safari's by the prefix", () => {
    const chromium = closeTabScript("com.brave.Browser", "chromium");
    expect(chromium).toContain('tell application id "com.brave.Browser"');
    expect(chromium).toContain("set end of doomed to (id of t)");
    expect(chromium).toContain("close (tab id i of w)");
    const safari = closeTabScript("com.apple.Safari", "safari");
    expect(safari).toContain('tell application id "com.apple.Safari"');
    expect(safari).toContain("(tabs of w whose URL starts with (p as text))");
  });

  test("the route answers a same-origin request with the outcome for its own port, and refuses another origin", async () => {
    const seen: number[] = [];
    const close = async (port: number) => {
      seen.push(port);
      return { closed: 1, browsers: ["com.brave.Browser"] };
    };
    const url = new URL("http://localhost:51747/api/close-tab");
    const same = await handleCloseTabRequest(
      new Request(url, { method: "POST", headers: { origin: "http://localhost:51747" } }),
      url,
      close,
    );
    expect(await same.json()).toEqual({ closed: 1, browsers: ["com.brave.Browser"] });
    expect(seen).toEqual([51747]);
    const foreign = await handleCloseTabRequest(
      new Request(url, { method: "POST", headers: { origin: "https://example.com" } }),
      url,
      close,
    );
    expect(foreign.status).toBe(403);
    expect(seen).toEqual([51747]);
  });

  const closeRequest = (afterMs?: unknown) => {
    const url = new URL("http://localhost:51747/api/close-tab");
    const body = afterMs === undefined ? undefined : JSON.stringify({ afterMs });
    return { url, req: new Request(url, { method: "POST", headers: { origin: "http://localhost:51747" }, body }) };
  };

  // The page asks the moment its done screen appears, while the session is
  // certainly up, and the server closes the tab when the countdown ends.
  test("the request is held for the page's countdown, and the tabs are closed at its end", async () => {
    const started = Date.now();
    let closedAt = 0;
    const { req, url } = closeRequest(200);
    const response = await handleCloseTabRequest(req, url, async () => {
      closedAt = Date.now() - started;
      return { closed: 1, browsers: ["com.brave.Browser"] };
    });
    expect(closedAt).toBeGreaterThanOrEqual(190);
    expect(await response.json()).toEqual({ closed: 1, browsers: ["com.brave.Browser"] });
  });

  test("the countdown is held for 5 s at most; a missing, negative or malformed one is none", async () => {
    const waited: number[] = [];
    const wait = async (ms: number) => { waited.push(ms); };
    const close = async (): Promise<CloseTabOutcome> => ({ closed: 1, browsers: [] });
    for (const afterMs of [60_000, -5, "3000", Number.NaN, undefined, 1234.4]) {
      const { req, url } = closeRequest(afterMs);
      await handleCloseTabRequest(req, url, close, { wait });
    }
    expect(waited).toEqual([MAX_CLOSE_AFTER_MS, 0, 0, 0, 0, 1234]);
  });

  test("every browser is checked and closed at the same time, not one after another", async () => {
    const running = new Set(["com.brave.Browser", "com.google.Chrome", "com.apple.Safari"]);
    const run = async (args: string[]): Promise<OsascriptResult> => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const probe = /^application id "([^"]+)" is running$/.exec(args[1] ?? "");
      if (probe) return { code: 0, stdout: running.has(probe[1]!) ? "true\n" : "false\n", stderr: "" };
      return { code: 0, stdout: "1\n", stderr: "" };
    };
    const started = Date.now();
    const outcome = await closeSessionTabs(51747, { platform: "darwin", remote: false, run });
    // One check and one close each, together: about 200 ms, where one after another took 1.1 s.
    expect(Date.now() - started).toBeLessThan(600);
    expect(outcome).toEqual({ closed: 3, browsers: ["com.brave.Browser", "com.google.Chrome", "com.apple.Safari"] });
  });

  test("a close script that ran out of time (macOS asking whether Plannotator may control the browser) says so", async () => {
    const { run } = fakeOsascript({ "com.brave.Browser": true }, () => ({ code: 124, stdout: "", stderr: "osascript timed out" }));
    expect(await closeSessionTabs(51747, { platform: "darwin", remote: false, run }))
      .toEqual({ closed: 0, reason: "timeout", browsers: ["com.brave.Browser"] });
  });

  // The lifetime the page counts on: a decision settles the session, and a
  // close the page asked for is answered before the server stops.
  test("a held request is answered before the session's server stops", async () => {
    const server = Bun.serve({
      port: 0,
      idleTimeout: 0,
      fetch: (req) => handleCloseTabRequest(req, new URL(req.url), async () => ({ closed: 1, browsers: ["com.brave.Browser"] })),
    });
    try {
      const asked = Date.now();
      let answeredAfter = -1;
      const answer = fetch(`http://localhost:${server.port}/api/close-tab`, {
        method: "POST",
        body: JSON.stringify({ afterMs: 300 }),
      }).then(async (response) => {
        answeredAfter = Date.now() - asked;
        return response.json();
      });
      await new Promise((resolve) => setTimeout(resolve, 50));
      // The decision: the session settles (its 1.5 s, short here), then stops.
      await settleSession(10);
      const stoppedAfter = Date.now() - asked;
      server.stop();
      expect(await answer).toEqual({ closed: 1, browsers: ["com.brave.Browser"] });
      // Held for the countdown, and the server stopped only once it was over.
      expect(answeredAfter).toBeGreaterThanOrEqual(280);
      expect(stoppedAfter).toBeGreaterThanOrEqual(280);
    } finally {
      server.stop(true);
    }
  });

  test("settling waits for no close past its bound", async () => {
    const { req, url } = closeRequest(0);
    void handleCloseTabRequest(req, url, () => new Promise<CloseTabOutcome>(() => {}), { graceMs: 150 });
    const started = Date.now();
    await settleSession(10);
    const waited = Date.now() - started;
    expect(waited).toBeGreaterThanOrEqual(140);
    expect(waited).toBeLessThan(1_000);
  });
});
