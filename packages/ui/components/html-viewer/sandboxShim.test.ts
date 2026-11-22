/**
 * A page that uses history or storage while it builds itself renders in the
 * viewer's sandboxed frame (sandboxShim.ts).
 *
 * The frame below follows what Chromium does in a frame sandboxed with
 * scripts and without allow-same-origin (checked in Chrome against the Inbox
 * with the prototype that showed blank): a srcdoc document (`about:srcdoc`)
 * may change only its fragment, the URL a page passes resolves against the
 * viewer's `<base href>`, a served page may move within its origin, and
 * reading `localStorage` / `sessionStorage` throws a SecurityError.
 */
import { describe, expect, test } from "bun:test";
import vm from "node:vm";
import { BRIDGE_SCRIPT } from "./bridge-script";
import { SANDBOX_SHIM_SCRIPT } from "./sandboxShim";
import { injectSandboxShim, type SandboxShimOffer } from "./srcdoc";

const ASSET_BASE = "http://localhost:4000/api/html-assets/tok/";

function securityError(message: string): Error {
  return Object.assign(new Error(message), { name: "SecurityError" });
}

function opaqueFrame(documentUrl: string, globals: Record<string, unknown> = {}) {
  let href = documentUrl;
  let state: unknown = null;
  const change = (next: unknown, _unused: string, url?: string | URL | null) => {
    if (url !== undefined && url !== null) {
      const target = new URL(String(url), ASSET_BASE);
      const current = new URL(href);
      const allowed = /^https?:$/.test(current.protocol)
        ? target.origin === current.origin
        : target.href.split("#")[0] === href.split("#")[0];
      if (!allowed) {
        throw securityError(`A history state object with URL '${target.href}' cannot be created in a document with origin 'null' and URL '${href}'.`);
      }
      href = target.href;
    }
    state = next;
  };
  const win: Record<string, unknown> = {
    URL,
    document: { baseURI: ASSET_BASE },
    history: { pushState: change, replaceState: change, get state() { return state; } },
    location: {
      get href() { return href; },
      get hash() { const at = href.indexOf("#"); return at < 0 ? "" : href.slice(at); },
    },
  };
  for (const name of ["localStorage", "sessionStorage"]) {
    Object.defineProperty(win, name, {
      configurable: true,
      enumerable: true,
      get() { throw securityError(`Failed to read the '${name}' property from 'Window': The document is sandboxed and lacks the 'allow-same-origin' flag.`); },
    });
  }
  win.window = win;
  Object.assign(win, globals);
  const context = vm.createContext(win);
  return {
    run: (source: string) => vm.runInContext(source, context),
    get href() { return href; },
  };
}

/** The boot of the prototype that rendered blank: read the hash and storage, write the hash, then draw. */
const PROTOTYPE_BOOT = `
  var theme = localStorage.getItem('theme') || 'light';
  history.replaceState(null, '', '#state=C4&theme=' + theme + '&vp=phone');
  localStorage.setItem('seen', '1');
  sessionStorage.tab = 'states';
  window.drawn = { hash: location.hash, seen: localStorage.getItem('seen'), tab: sessionStorage.getItem('tab'), keys: Object.keys(sessionStorage) };
`;

describe("a page that uses history and storage as it builds itself", () => {
  test("stops before it draws in the bare sandboxed frame (what the shim is for)", () => {
    const frame = opaqueFrame("about:srcdoc");
    expect(() => frame.run("localStorage.getItem('theme')")).toThrow("sandboxed");
    expect(() => frame.run("history.replaceState(null, '', '#state=C4')")).toThrow("cannot be created");
  });

  test("draws in a srcdoc frame, its fragment on its own address", () => {
    const frame = opaqueFrame("about:srcdoc");
    frame.run(SANDBOX_SHIM_SCRIPT);
    frame.run(PROTOTYPE_BOOT);
    expect(frame.run("JSON.stringify(window.drawn)")).toBe(
      JSON.stringify({ hash: "#state=C4&theme=light&vp=phone", seen: "1", tab: "states", keys: ["tab"] }),
    );
    expect(frame.href).toBe("about:srcdoc#state=C4&theme=light&vp=phone");
  });

  test("a served page keeps its own address, not its folder's", () => {
    const frame = opaqueFrame("http://localhost:4000/api/inbox/pages/abc");
    frame.run(SANDBOX_SHIM_SCRIPT);
    frame.run("history.pushState({ step: 2 }, '', '#step=2')");
    expect(frame.href).toBe("http://localhost:4000/api/inbox/pages/abc#step=2");
  });

  // A prototype that keeps its variant in the address (`replaceState(null, '', '?variant=2')`), as in a tab: on a
  // served page it used to land on the folder's address (the `<base>`), so a reload or a link lost the page.
  test("a bare query keeps the served page's own path; a srcdoc keeps only its fragment", () => {
    const served = opaqueFrame("http://localhost:4000/api/inbox/pages/abc?variant=1#top");
    served.run(SANDBOX_SHIM_SCRIPT);
    served.run("history.replaceState(null, '', '?variant=2')");
    expect(served.href).toBe("http://localhost:4000/api/inbox/pages/abc?variant=2");
    served.run("history.pushState({ v: 3 }, '', '?variant=3#step-2')");
    expect(served.href).toBe("http://localhost:4000/api/inbox/pages/abc?variant=3#step-2");
    const srcdoc = opaqueFrame("about:srcdoc");
    srcdoc.run(SANDBOX_SHIM_SCRIPT);
    srcdoc.run("history.replaceState({ v: 2 }, '', '?variant=2#two'); window.after = true;");
    expect(srcdoc.href).toBe("about:srcdoc#two");
    expect(srcdoc.run("JSON.stringify(history.state) + window.after")).toBe('{"v":2}true');
  });

  test("a URL the frame refuses keeps the state and the fragment, and the page runs on", () => {
    const frame = opaqueFrame("about:srcdoc");
    frame.run(SANDBOX_SHIM_SCRIPT);
    frame.run("history.replaceState({ step: 3 }, '', '/other/page.html?x=1#three'); window.after = true;");
    expect(frame.href).toBe("about:srcdoc#three");
    expect(frame.run("JSON.stringify(history.state) + window.after")).toBe('{"step":3}true');
  });

  test("running it again (the bridge after the head) keeps what the page stored", () => {
    const frame = opaqueFrame("about:srcdoc");
    frame.run(SANDBOX_SHIM_SCRIPT);
    frame.run("localStorage.setItem('theme', 'dark')");
    frame.run(SANDBOX_SHIM_SCRIPT);
    frame.run("history.replaceState(null, '', '#a')");
    expect(frame.run("localStorage.getItem('theme')")).toBe("dark");
    expect(frame.href).toBe("about:srcdoc#a");
  });
});

/**
 * A srcdoc frame whose host made an OFFER: the scripts `injectSandboxShim` writes (the offer, then the shim) run
 * in it as a page load runs them; what it posts to the parent, the steps it hands the link guard (which takes one
 * only while a person's click is being dispatched: `clicking`), the natives a page's history calls reached, and
 * the console's warnings are recorded.
 */
function hostedFrame(offer?: SandboxShimOffer, before = "") {
  const posted: Array<Record<string, unknown>> = [];
  const followed: Array<[string, unknown]> = [];
  const natives: string[] = [];
  const warnings: string[] = [];
  const person = { clicking: false };
  const frame = opaqueFrame("about:srcdoc", {
    parent: { postMessage: (message: Record<string, unknown>) => posted.push(JSON.parse(JSON.stringify(message))) },
    console: { warn: (message: string) => warnings.push(message) },
    __plannotatorLinkGuard: Object.freeze({
      follow: (kind: string, msg: { delta?: unknown }) => {
        followed.push([kind, msg?.delta]);
        return person.clicking;
      },
    }),
    __native: (name: string, delta?: unknown) => natives.push(delta === undefined ? name : `${name}(${String(delta)})`),
  });
  frame.run("history.back = function() { __native('back'); }; history.forward = function() { __native('forward'); }; history.go = function(n) { __native('go', n); };");
  if (before) frame.run(before);
  const html = injectSandboxShim("<!doctype html><head><script>PAGE()</script></head>", offer);
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]!);
  // The offer and the shim; the page's own script is the test's to run.
  for (const script of scripts.slice(0, -1)) frame.run(script);
  return { frame, posted, followed, natives, warnings, html, person, offerScript: scripts.length > 2 ? scripts[0]! : null };
}

const STORAGE = (local: Array<[string, string]>, session: Array<[string, string]> = [], limit = 1000, perItem = 0) => ({ storage: { local, session, limit, perItem } });

describe("a host that keeps the page's storage (frameStorage)", () => {
  // md2web reads its theme in a head script; with nothing kept between loads it found none on every page.
  test("the page's first head script reads what the host kept, and never sees the offer", () => {
    const { frame } = hostedFrame(STORAGE([["md2web.theme", "dark"]], [["tab", "states"]]));
    expect(frame.run("localStorage.getItem('md2web.theme') + ' ' + sessionStorage.tab + ' ' + localStorage.length")).toBe("dark states 1");
    expect(frame.run("typeof window.__plannotatorFrameHost")).toBe("undefined");
  });

  test("each change is posted once, as the area, the operation, the key and the value", () => {
    const { frame, posted } = hostedFrame(STORAGE([["kept", "1"]]));
    frame.run("localStorage.setItem('theme', 'dark'); localStorage.setItem('theme', 'dark');");
    frame.run("sessionStorage.step = 2; delete sessionStorage.step;");
    frame.run("localStorage.removeItem('theme'); localStorage.clear();");
    expect(posted).toEqual([
      { type: "plannotator-bridge-storage", area: "local", op: "set", key: "theme", value: "dark" },
      { type: "plannotator-bridge-storage", area: "session", op: "set", key: "step", value: "2" },
      { type: "plannotator-bridge-storage", area: "session", op: "remove", key: "step" },
      { type: "plannotator-bridge-storage", area: "local", op: "remove", key: "theme" },
      { type: "plannotator-bridge-storage", area: "local", op: "clear" },
    ]);
  });

  // A page that reloads itself starts from the storage its document was built with, which can be older than the
  // store: a remove or a clear of what that load does not hold must still reach the store, or the deleted value
  // comes back on every later page.
  test("a remove or clear of what this load does not hold still reaches the store", () => {
    const { frame, posted } = hostedFrame(STORAGE([]));
    frame.run("localStorage.removeItem('theme'); sessionStorage.clear();");
    expect(posted).toEqual([
      { type: "plannotator-bridge-storage", area: "local", op: "remove", key: "theme" },
      { type: "plannotator-bridge-storage", area: "session", op: "clear" },
    ]);
  });

  test("the bridge's second run neither seeds again nor posts twice, even handed an offer again", () => {
    const { frame, posted, offerScript } = hostedFrame(STORAGE([["theme", "light"]]));
    frame.run("localStorage.setItem('theme', 'dark')");
    frame.run(offerScript!);
    frame.run(SANDBOX_SHIM_SCRIPT);
    frame.run("localStorage.setItem('seen', '1')");
    expect(frame.run("localStorage.getItem('theme')")).toBe("dark");
    expect(posted.map((m) => m.key)).toEqual(["theme", "seen"]);
  });

  test("with no offer nothing is posted and nothing is kept, as before", () => {
    const { frame, posted, html, followed } = hostedFrame(undefined);
    frame.run("localStorage.setItem('theme', 'dark'); localStorage.removeItem('x'); history.back(); history.go(-2);");
    expect(posted).toEqual([]);
    expect(followed).toEqual([]);
    expect(html).not.toContain("__plannotatorFrameHost =");
    expect(html).toBe(`<!doctype html><head>${SHIM_TAG}<script>PAGE()</script></head>`);
  });

  // The host's store holds every page's items in the review tab's own sessionStorage, which it shares with the app.
  test("a change past the limit, each item counted with its cost besides key and value, stays with this load", () => {
    const { frame, posted, warnings } = hostedFrame(STORAGE([["a", "12345"]], [], 40, 10));
    frame.run("localStorage.setItem('big', 'x'.repeat(40)); localStorage.setItem('big2', 'y'.repeat(40));");
    frame.run("sessionStorage.setItem('b', '123'); sessionStorage.setItem('c', '4');");
    expect(frame.run("localStorage.getItem('big').length")).toBe(40);
    // a: 1 + 5 + 10 = 16; b: 1 + 3 + 10 = 14 (30); c would be 1 + 1 + 10 = 12 (42, past 40).
    expect(posted).toEqual([{ type: "plannotator-bridge-storage", area: "session", op: "set", key: "b", value: "123" }]);
    expect(warnings.length).toBe(1);
  });

  // A tab's Storage keeps its own methods whatever its items are named; kept from page to page, an item named
  // toString would otherwise break every later page's storage.
  test("an item named as one of Storage's methods leaves the method in place", () => {
    const { frame } = hostedFrame(STORAGE([["toString", "x"], ["hasOwnProperty", "y"]]));
    expect(frame.run("typeof localStorage.toString + ' ' + typeof localStorage.hasOwnProperty")).toBe("function function");
    expect(frame.run("localStorage.getItem('toString') + localStorage.getItem('hasOwnProperty')")).toBe("xy");
  });
});

const SHIM_TAG = `<script>${SANDBOX_SHIM_SCRIPT}</script>`;

describe("where the shim runs", () => {
  test("before the page's own head scripts", () => {
    const page = '<!doctype html><html lang="en"><head data-x="1"><script>PAGE_HEAD()</script></head><body></body></html>';
    expect(injectSandboxShim(page)).toBe(`<!doctype html><html lang="en"><head data-x="1">${SHIM_TAG}<script>PAGE_HEAD()</script></head><body></body></html>`);
  });

  test("never inside a comment, a title or an attribute that names <head>", () => {
    expect(injectSandboxShim('<!doctype html><!-- the <head> goes here --><html><head><script>boot()</script></head>'))
      .toBe(`<!doctype html><!-- the <head> goes here --><html><head>${SHIM_TAG}<script>boot()</script></head>`);
    expect(injectSandboxShim('<!doctype html><title>About <head></title><script>boot()</script></head>'))
      .toBe(`<!doctype html>${SHIM_TAG}<title>About <head></title><script>boot()</script></head>`);
    expect(injectSandboxShim('<!doctype html><html data-n="<head>"><head data-x="a>b"><script>boot()</script></head>'))
      .toBe(`<!doctype html><html data-n="<head>"><head data-x="a>b">${SHIM_TAG}<script>boot()</script></head>`);
  });

  test("a host's offer right before it, so ahead of every page script too", () => {
    const html = injectSandboxShim('<!doctype html><script>boot()</script><head></head>', STORAGE([["theme", "dark"]]));
    expect(html).toBe(`<!doctype html><script>window.__plannotatorFrameHost = {"storage":{"local":[["theme","dark"]],"session":[],"limit":1000,"perItem":0}};</script>${SHIM_TAG}<script>boot()</script><head></head>`);
  });

  test("an offered value that would end the script, open a comment or end a line of it reads back as it was", () => {
    const value = "</script><script>alert(1)</script><!-- \u2028 \u2029 '\" \\";
    const html = injectSandboxShim("<head></head>", STORAGE([[value, value]]));
    const offerScript = html.slice(0, html.indexOf(SHIM_TAG));
    expect(offerScript.match(/<\/script>/g)?.length).toBe(1);
    expect(offerScript).not.toContain("<!--");
    expect(offerScript).not.toContain("\u2028");
    const { frame } = hostedFrame(STORAGE([[value, value]]));
    expect(frame.run(`localStorage.getItem(${JSON.stringify(value)})`)).toBe(value);
  });

  test("ahead of a script that comes before <head>, and never inside one", () => {
    expect(injectSandboxShim('<!doctype html><script>boot()</script><head></head>'))
      .toBe(`<!doctype html>${SHIM_TAG}<script>boot()</script><head></head>`);
    expect(injectSandboxShim('<script>var t = "<head>";</script><p>x</p>'))
      .toBe(`${SHIM_TAG}<script>var t = "<head>";</script><p>x</p>`);
    expect(injectSandboxShim("<!doctype html><header>x</header>")).toBe(`<!doctype html>${SHIM_TAG}<header>x</header>`);
  });
});

describe("the bridge (hosts that load it by URL get the shim from it)", () => {
  // The bridge needs a DOM past its first lines; the shim runs before that, so what it left behind is read after the throw.
  const runBridge = (frame: ReturnType<typeof opaqueFrame>) => {
    try { frame.run(BRIDGE_SCRIPT); } catch {}
  };

  test("installs the shim in a sandboxed page", () => {
    const frame = opaqueFrame("about:srcdoc");
    runBridge(frame);
    frame.run(PROTOTYPE_BOOT);
    expect(frame.run("window.drawn.hash")).toBe("#state=C4&theme=light&vp=phone");
  });

  test("leaves a live app's own history and storage alone", () => {
    const parent = {};
    const frame = opaqueFrame("http://localhost:5173/", { __plannotatorLiveConfig: { token: "t", editorOrigins: [] }, parent, top: parent });
    runBridge(frame);
    expect(() => frame.run("localStorage.getItem('theme')")).toThrow("sandboxed");
    expect(frame.run("history.replaceState.plannotatorSandboxShim")).toBeUndefined();
  });
});
