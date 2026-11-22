import { describe, expect, test } from "bun:test";
import {
  closeSessionTabs,
  closeTabScript,
  handleCloseTabRequest,
  sessionTabPrefixes,
  SCRIPTABLE_BROWSERS,
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
});
