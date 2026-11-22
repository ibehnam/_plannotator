/**
 * HTML-surface chrome contract (DOM-gated).
 *
 * An HTML surface opens with the floating tools HIDDEN — the page gets the
 * whole viewport — and the header "Hide tools" eye is what reveals them.
 * Hiding removes ALL floating chrome over the page from the DOM: the sidebar
 * tongue tabs and the comment/attachments cluster, with no residual artifact.
 * The toggle itself lives in the header, so the hidden state (default, or
 * restored from a cookie) always has a way back, and a fresh cookie recording
 * shown tools still wins over the default. Sidebar/panel halves of the
 * persisted state round-trip.
 *
 * The page has Markdown's toolstrip above it and no pen: its Select and
 * Pinpoint are the one remembered choice every surface shares (Pinpoint arms
 * the page), set by the toolstrip, the compact control, the Alt keys and
 * Mod+Shift+A, and never by Escape.
 */
import { afterAll, afterEach, describe, expect, test } from "bun:test";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  resetStorageBackend,
  setStorageBackend,
  type StorageBackend,
} from "@plannotator/ui/utils/storage";
import { bridgeLinkPort } from "../ui/test-setup/bridgeLinkPort";

const hasDom = typeof document !== "undefined";

if (hasDom) {
  document.cookie = "plannotator-look-feel-announcement-seen=2; path=/";
  document.cookie = "plannotator-announce-tui-herdr-seen=1; path=/";
  document.cookie = "plannotator-announce-inbox-seen=1; path=/";
  document.cookie = "plannotator-vim-mode-announcement-seen=2; path=/";
  document.cookie = "plannotator-plan-ai-announcement-seen=1; path=/";
}

const appModule = hasDom ? await import("./App") : null;
const App = appModule?.default as typeof import("./App")["default"];
const originalFetch = globalThis.fetch;
const originalEventSource = globalThis.EventSource;
const originalMatchMedia = hasDom ? window.matchMedia : undefined;

// SAFETY: implements the MediaQueryList surface the shell hooks consume.
// Coarse-pointer matches put the app in its compact touch layout.
function coarseMatchMedia(query: string): MediaQueryList {
  return {
    matches: query.includes("pointer: coarse"),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
  } as unknown as MediaQueryList;
}

const RAW_HTML = "<h1>Rendered page</h1><p>Body copy.</p>";

// In-memory storage backend (the codebase-standard persistence-test pattern):
// keeps values across mounts within a test, so a remount simulates the next
// session with the same cookies.
const memory = new Map<string, string>();
const memoryBackend: StorageBackend = {
  getItem: (key) => memory.get(key) ?? null,
  setItem: (key, value) => void memory.set(key, value),
  removeItem: (key) => void memory.delete(key),
};

function seedAnnouncementsSeen(): void {
  memory.set("plannotator-look-feel-announcement-seen", "2");
  memory.set("plannotator-announce-tui-herdr-seen", "1");
  memory.set("plannotator-announce-inbox-seen", "1");
  memory.set("plannotator-vim-mode-announcement-seen", "2");
  memory.set("plannotator-plan-ai-announcement-seen", "1");
}

class SilentEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;

  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSED = 2;
  readonly readyState = SilentEventSource.OPEN;
  readonly url: string;
  readonly withCredentials = false;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onopen: ((event: Event) => void) | null = null;

  constructor(url: string | URL) {
    this.url = String(url);
  }

  addEventListener(): void {}
  close(): void {}
  dispatchEvent(): boolean { return true; }
  removeEventListener(): void {}
}

let root: Root | null = null;
let host: HTMLElement | null = null;

const htmlAnnotatePlan = {
  plan: "",
  origin: "codex",
  mode: "annotate",
  filePath: "/tmp/page.html",
  renderAs: "html",
  rawHtml: RAW_HTML,
  sharingEnabled: false,
  serverConfig: {},
};

const annotateFetch: typeof fetch = async (input) => {
  const rawUrl = input instanceof Request ? input.url : String(input);
  if (rawUrl.startsWith("https://api.github.com/")) return new Response(null, { status: 404 });

  const url = new URL(rawUrl, "http://localhost");
  if (url.pathname === "/api/plan") return Response.json(htmlAnnotatePlan);
  if (url.pathname === "/api/ai/capabilities") return Response.json({ available: false, providers: [] });
  if (url.pathname === "/api/draft") return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({});
};

// A session whose file has a saved previous version: /api/plan carries the
// rendered diff, and the root's /api/doc read (what Refresh performs) carries
// the diff recomputed against the bytes just read.
const DIFF_HTML = "<h1>Rendered <ins>page</ins></h1><p>Body copy.</p>";
const REFRESHED_HTML = "<h1>Rendered page</h1><p>Body copy, edited.</p>";
const REFRESHED_DIFF_HTML = "<h1>Rendered page</h1><p>Body copy<ins>, edited</ins>.</p>";
const versionedPlan = {
  ...htmlAnnotatePlan,
  diffHtml: DIFF_HTML,
  previousPlan: "<h1>Rendered</h1><p>Body copy.</p>",
  versionInfo: { version: 2, totalVersions: 2, project: "test" },
};
const versionedFetch: typeof fetch = async (input) => {
  const rawUrl = input instanceof Request ? input.url : String(input);
  const url = new URL(rawUrl, "http://localhost");
  if (url.pathname === "/api/plan") return Response.json(versionedPlan);
  if (url.pathname === "/api/doc" && url.searchParams.get("path") === htmlAnnotatePlan.filePath) {
    return Response.json({
      rawHtml: REFRESHED_HTML,
      renderAs: "html",
      filepath: htmlAnnotatePlan.filePath,
      diffHtml: REFRESHED_DIFF_HTML,
      previousPlan: versionedPlan.previousPlan,
      versionInfo: versionedPlan.versionInfo,
    });
  }
  return annotateFetch(input);
};

// A folder annotate session that happens to be rendering an HTML document.
// Its file browser owns the left sidebar, which is why the sidebar/panel halves
// of the persisted chrome do not apply here — but the eye does.
const folderAnnotatePlan = {
  ...htmlAnnotatePlan,
  mode: "annotate-folder",
  filePath: "/tmp/docs",
};

const folderFetch: typeof fetch = async (input) => {
  const rawUrl = input instanceof Request ? input.url : String(input);
  const url = new URL(rawUrl, "http://localhost");
  if (url.pathname === "/api/plan") return Response.json(folderAnnotatePlan);
  return annotateFetch(input);
};

function diffToggle(): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll("button"))
    .find((button) => /changes vs previous version/.test(button.title));
}

function refreshButton(): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>("[data-html-refresh]");
}

function findButtonByText(label: string): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll("button"))
    .find((button) => button.textContent?.trim() === label);
}

/** Upstream's header pen, which the app no longer shows. */
function pen(): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>("[data-html-annotate-toggle]");
}

function htmlToolstrip(): HTMLElement | null {
  return document.querySelector<HTMLElement>("[data-html-toolstrip]");
}

function toolsToggle(): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>("[data-html-tools-toggle]");
}

function floatingCluster(): HTMLElement | null {
  // The full-viewport comment/attachments cluster over the page.
  return document.querySelector<HTMLElement>('[data-print-hide].absolute.top-3.right-3');
}

function sidebarTabs(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-sidebar-tabs="true"]');
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function mountHtmlAnnotate(fetchImpl: typeof fetch = annotateFetch): Promise<void> {
  globalThis.fetch = fetchImpl;
  // SAFETY: the App only uses EventSource's constructor, handlers, and close;
  // this test double implements those browser-facing members without I/O.
  globalThis.EventSource = SilentEventSource as unknown as typeof EventSource;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(<App />);
  });
  for (let attempt = 0; attempt < 20 && !htmlToolstrip(); attempt += 1) {
    await settle();
  }
  if (!htmlToolstrip()) throw new Error("HTML surface did not finish mounting (toolstrip missing)");
}

function armedRing(): HTMLElement | null {
  return document.querySelector<HTMLElement>("[data-annotate-armed-ring]");
}

/** Compact mounts wait on the page's frame: the eye toggle does not exist on
 * the compact touch shell (that absence is what these tests guard). */
async function mountCompactHtmlAnnotate(fetchImpl: typeof fetch = annotateFetch): Promise<void> {
  globalThis.fetch = fetchImpl;
  // SAFETY: the App only uses EventSource's constructor, handlers, and close.
  globalThis.EventSource = SilentEventSource as unknown as typeof EventSource;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(<App />);
  });
  const frame = () => document.querySelector("iframe[srcdoc]");
  for (let attempt = 0; attempt < 20 && !frame(); attempt += 1) {
    await settle();
  }
  if (!frame()) throw new Error("compact HTML surface did not finish mounting (page frame missing)");
}

async function openOptionsMenu(): Promise<void> {
  const trigger = document.querySelector<HTMLButtonElement>('button[aria-label="Options"]');
  if (!trigger) throw new Error("Options menu trigger missing");
  await act(async () => trigger.click());
}

function findMenuItem(label: string): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll("button"))
    .find((button) => button.textContent?.includes(label));
}

async function unmountHtmlAnnotate(): Promise<void> {
  if (root) await act(async () => root?.unmount());
  root = null;
  host?.remove();
  host = null;
}

afterEach(async () => {
  await unmountHtmlAnnotate();
  globalThis.fetch = originalFetch;
  globalThis.EventSource = originalEventSource;
  memory.clear();
  resetStorageBackend();
  if (hasDom) {
    if (originalMatchMedia) window.matchMedia = originalMatchMedia;
    document.body.replaceChildren();
  }
});

afterAll(() => {
  resetStorageBackend();
});

// A toolstrip button holds its label twice (the visible one, and a hidden copy
// that sizes it): the first span is the visible one.
function toolstripButton(strip: ParentNode, label: string): HTMLButtonElement | undefined {
  return Array.from(strip.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.querySelector("span")?.textContent === label);
}

function stripButton(label: string): HTMLButtonElement | undefined {
  const strip = htmlToolstrip();
  if (!strip) throw new Error("HTML toolstrip missing");
  return toolstripButton(strip, label);
}

/** A Markdown document's toolstrip (the only one on its page). */
function markdownStripButton(label: string): HTMLButtonElement | undefined {
  return toolstripButton(document, label);
}

const markdownAnnotatePlan = {
  plan: "# Notes\n\nSome body text.\n",
  origin: "codex",
  mode: "annotate",
  filePath: "/tmp/notes.md",
  sharingEnabled: false,
  serverConfig: {},
};

async function mountMarkdownAnnotate(): Promise<void> {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : String(input), "http://localhost");
    if (url.pathname === "/api/plan") return Response.json(markdownAnnotatePlan);
    return annotateFetch(input);
  }) as typeof fetch;
  // SAFETY: the App only uses EventSource's constructor, handlers, and close.
  globalThis.EventSource = SilentEventSource as unknown as typeof EventSource;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(<App />);
  });
  for (let attempt = 0; attempt < 20 && !markdownStripButton("Pinpoint"); attempt += 1) {
    await settle();
  }
  if (!markdownStripButton("Pinpoint")) throw new Error("the Markdown document did not finish mounting (toolstrip missing)");
}

describe.if(hasDom)("HTML annotate chrome (tools toggle + the toolstrip's Select and Pinpoint)", () => {
  test("tools default HIDDEN: no tongue tabs or cluster, and the eye renders its hidden state", async () => {
    setStorageBackend(memoryBackend);
    seedAnnouncementsSeen();
    await mountHtmlAnnotate();

    expect(sidebarTabs()).toBeNull();
    expect(floatingCluster()).toBeNull();
    // The eye is the way back, and it reports "hidden" from the first paint.
    expect(toolsToggle()).not.toBeNull();
    expect(toolsToggle()!.getAttribute("aria-pressed")).toBe("true");
  });

  test("Show tools brings ALL floating chrome back; Hide removes it again with no residual artifact", async () => {
    setStorageBackend(memoryBackend);
    seedAnnouncementsSeen();
    await mountHtmlAnnotate();

    const toggle = toolsToggle();
    if (!toggle) throw new Error("tools toggle missing");
    await act(async () => toggle.click());

    expect(sidebarTabs()).not.toBeNull();
    expect(floatingCluster()).not.toBeNull();
    expect(toolsToggle()!.getAttribute("aria-pressed")).toBe("false");

    await act(async () => toolsToggle()!.click());
    expect(sidebarTabs()).toBeNull();
    expect(floatingCluster()).toBeNull();
    // No leftover pill/expander: the toggle in the header is the only way back.
    expect(toolsToggle()).not.toBeNull();
    expect(toolsToggle()!.getAttribute("aria-pressed")).toBe("true");
  });

  test("a fresh cookie recording toolsHidden:false still shows the tools (the default never overrides an explicit choice)", async () => {
    setStorageBackend(memoryBackend);
    seedAnnouncementsSeen();
    memory.set(
      "plannotator-html-chrome",
      JSON.stringify({ toolsHidden: false, sidebarOpen: false, panelOpen: false, savedAt: Date.now() }),
    );
    await mountHtmlAnnotate();
    await settle();

    expect(floatingCluster()).not.toBeNull();
    expect(toolsToggle()!.getAttribute("aria-pressed")).toBe("false");
  });

  test("a cookie recording toolsHidden:true restores hidden, and the header toggle is the way back", async () => {
    setStorageBackend(memoryBackend);
    seedAnnouncementsSeen();
    memory.set(
      "plannotator-html-chrome",
      JSON.stringify({ toolsHidden: true, sidebarOpen: false, panelOpen: false, savedAt: Date.now() }),
    );
    await mountHtmlAnnotate();
    await settle();

    expect(sidebarTabs()).toBeNull();
    expect(floatingCluster()).toBeNull();
    const toggle = toolsToggle();
    expect(toggle).not.toBeNull();
    expect(toggle!.getAttribute("aria-pressed")).toBe("true");
    await act(async () => toggle!.click());
    expect(sidebarTabs()).not.toBeNull();
  });

  test("compact touch layout: the hidden-by-default tools are undoable through the Options menu 'Show tools' action", async () => {
    setStorageBackend(memoryBackend);
    seedAnnouncementsSeen();
    window.matchMedia = coarseMatchMedia as typeof window.matchMedia;
    await mountCompactHtmlAnnotate();

    // Hidden applies on compact too (desktop parity), but compact is not
    // stranded: the desktop-only eye toggle is absent and the menu action is
    // the way back — and it must read "Show tools", not "Hide tools".
    expect(floatingCluster()).toBeNull();
    expect(toolsToggle()).toBeNull();

    await openOptionsMenu();
    const show = findMenuItem("Show tools");
    if (!show) throw new Error('compact menu is missing the "Show tools" action');
    await act(async () => show.click());
    expect(floatingCluster()).not.toBeNull();
  });

  test("compact touch layout: the compact Select/Pinpoint control above the page arms it, and Options has no Annotate page", async () => {
    setStorageBackend(memoryBackend);
    seedAnnouncementsSeen();
    window.matchMedia = coarseMatchMedia as typeof window.matchMedia;
    await mountCompactHtmlAnnotate();

    expect(pen() !== null).toBe(false);
    expect(armedRing() !== null).toBe(false);
    await openOptionsMenu();
    expect(findMenuItem("Annotate page")).toBeUndefined();
    expect(findMenuItem("Interact with page")).toBeUndefined();

    // The compact control Markdown has: its entry opens the two choices.
    const choice = async (label: string) => {
      const entry = document.querySelector<HTMLButtonElement>("[data-html-toolstrip] [data-pn-compact-annotate-entry]");
      if (!entry) throw new Error("the compact Select/Pinpoint control is missing above the page");
      await act(async () => entry.click());
      const button = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-pn-compact-annotate-choices] button"))
        .find((b) => b.textContent?.includes(label));
      if (!button) throw new Error(`the compact control has no ${label} choice`);
      await act(async () => button.click());
    };
    await choice("Pinpoint");
    expect(armedRing() !== null).toBe(true);
    await choice("Select text");
    expect(armedRing() !== null).toBe(false);
  });

  test("compact touch layout: Refresh from disk is offered through the Options menu (the header refresh is absent)", async () => {
    setStorageBackend(memoryBackend);
    seedAnnouncementsSeen();
    window.matchMedia = coarseMatchMedia as typeof window.matchMedia;
    await mountCompactHtmlAnnotate(versionedFetch);

    // The desktop-only header refresh is not rendered on compact, so the
    // menu action is the only way to re-read the file.
    expect(refreshButton()).toBeNull();

    await openOptionsMenu();
    const refresh = findMenuItem("Refresh from disk");
    if (!refresh) throw new Error('compact menu is missing the "Refresh from disk" action');
    expect(refresh.disabled).toBe(false);
    await act(async () => refresh.click());
    for (let attempt = 0; attempt < 20 && !document.querySelector('iframe[srcdoc*="edited"]'); attempt += 1) {
      await settle();
    }
    // The refreshed bytes reached the viewer.
    expect(document.querySelector<HTMLIFrameElement>("iframe[srcdoc]")?.getAttribute("srcdoc")).toContain("Body copy, edited.");
  });

  test("the restore commit never writes stale pre-restore values to the cookie", async () => {
    // The chrome writer runs in the same commit as the restore effect, before
    // the restored state has landed. If it saved there, a returning user's
    // remembered state would be transiently inverted in the cookie — and a
    // page ending between the two writes would freeze the inversion.
    // Instrument every chrome write: no write may ever carry a state other
    // than the remembered one, because this session never changes any chrome.
    const chromeWrites: string[] = [];
    setStorageBackend({
      getItem: (key) => memory.get(key) ?? null,
      setItem: (key, value) => {
        if (key === "plannotator-html-chrome") chromeWrites.push(value);
        memory.set(key, value);
      },
      removeItem: (key) => void memory.delete(key),
    });
    seedAnnouncementsSeen();
    const rememberedState = { toolsHidden: false, sidebarOpen: true, panelOpen: false };
    memory.set(
      "plannotator-html-chrome",
      JSON.stringify({ ...rememberedState, savedAt: Date.now() }),
    );
    await mountHtmlAnnotate();
    await settle();

    // Writes re-stamp savedAt, so compare the semantic fields, not bytes.
    const semantic = (raw: string) => {
      const { toolsHidden, sidebarOpen, panelOpen } = JSON.parse(raw) as Record<string, unknown>;
      return { toolsHidden, sidebarOpen, panelOpen };
    };
    for (const write of chromeWrites) {
      expect(semantic(write)).toEqual(rememberedState);
    }
    expect(semantic(memory.get("plannotator-html-chrome")!)).toEqual(rememberedState);
  });

  test("the sidebar is still reachable by keyboard (Mod+B) while tools are hidden", async () => {
    setStorageBackend(memoryBackend);
    seedAnnouncementsSeen();
    memory.set(
      "plannotator-html-chrome",
      JSON.stringify({ toolsHidden: true, sidebarOpen: false, panelOpen: false, savedAt: Date.now() }),
    );
    await mountHtmlAnnotate();
    await settle();
    expect(sidebarTabs()).toBeNull();

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "b", metaKey: true, bubbles: true }));
    });
    await settle();

    expect(findButtonByText("Contents")).not.toBeUndefined();
  });

  test("the sidebar-open half of the persisted chrome still restores", async () => {
    setStorageBackend(memoryBackend);
    seedAnnouncementsSeen();
    memory.set(
      "plannotator-html-chrome",
      JSON.stringify({ sidebarOpen: true, panelOpen: false, savedAt: Date.now() }),
    );
    await mountHtmlAnnotate();
    await settle();

    // Open sidebar renders the full tab strip (Contents label), and the
    // collapsed flags are gone.
    expect(findButtonByText("Contents")).not.toBeUndefined();
  });

  test("Refresh keeps the version-diff toggle available (the server recomputes the diff for the root document)", async () => {
    setStorageBackend(memoryBackend);
    seedAnnouncementsSeen();
    // The version-diff toggle lives in the floating cluster over the page,
    // which an HTML surface hides by default — this test is about refresh, so
    // start from a session whose reviewer had the tools showing.
    memory.set(
      "plannotator-html-chrome",
      JSON.stringify({ toolsHidden: false, sidebarOpen: false, panelOpen: false, savedAt: Date.now() }),
    );
    await mountHtmlAnnotate(versionedFetch);
    await settle();

    // The toggle is offered on load, in normal (non-diff) mode.
    expect(diffToggle()).not.toBeUndefined();
    expect(diffToggle()!.title).toBe("Show changes vs previous version");

    // Enter the diff view, then refresh: the view returns to normal mode and
    // the toggle is still there (it used to disappear for the session).
    await act(async () => diffToggle()!.click());
    expect(diffToggle()!.title).toBe("Hide changes vs previous version");

    const refresh = refreshButton();
    if (!refresh) throw new Error("refresh button missing");
    await act(async () => refresh.click());
    for (let attempt = 0; attempt < 20 && refreshButton()?.getAttribute("aria-disabled") !== "false"; attempt += 1) {
      await settle();
    }

    expect(diffToggle()).not.toBeUndefined();
    expect(diffToggle()!.title).toBe("Show changes vs previous version");
    // And the recomputed diff is what a second toggle renders.
    await act(async () => diffToggle()!.click());
    await settle();
    const frame = document.querySelector<HTMLIFrameElement>("iframe[srcdoc]");
    expect(frame?.getAttribute("srcdoc")).toContain("<ins>, edited</ins>");
  });

  test("an Unanchored chip from one refresh clears when the next refresh's restore report is empty", async () => {
    // The bridge answers the parent's post-restore report request with the
    // complete set, empty included (pinned in htmlPinpointProtocol.test);
    // the App replaces its chip set with each report, so a chip from
    // refresh 1 must not survive a refresh 2 on which everything anchors.
    setStorageBackend(memoryBackend);
    seedAnnouncementsSeen();
    const draftedFetch: typeof fetch = async (input) => {
      const rawUrl = input instanceof Request ? input.url : String(input);
      const url = new URL(rawUrl, "http://localhost");
      if (url.pathname === "/api/draft" && (!(input instanceof Request) || input.method === "GET")) {
        return Response.json({
          annotations: [{
            id: "X",
            blockId: "",
            startOffset: 0,
            endOffset: 0,
            type: "COMMENT",
            text: "pinned note",
            originalText: "Body copy.",
            createdA: 1,
            htmlAnchor: { selector: "p", tagName: "p", text: "Body copy." },
          }],
          codeAnnotations: [],
          globalAttachments: [],
        });
      }
      return versionedFetch(input);
    };
    await mountHtmlAnnotate(draftedFetch);
    await settle();
    // The draft arrives behind the "Draft Recovered" dialog; restore it.
    for (let attempt = 0; attempt < 20 && !findButtonByText("Restore"); attempt += 1) {
      await settle();
    }
    const restore = findButtonByText("Restore");
    if (!restore) throw new Error("draft restore dialog missing");
    await act(async () => restore.click());
    await settle();
    // The chip lives on the panel card; the HTML surface opens with the
    // panel collapsed, so open it.
    const showPanel = document.querySelector<HTMLButtonElement>('button[title="Show annotations"]');
    if (showPanel) await act(async () => showPanel.click());
    await settle();
    expect(document.querySelector('[data-annotation-id="X"]')).not.toBeNull();
    const chip = () => document.querySelector('[data-annotation-unanchored]');
    const frame = () => document.querySelector<HTMLIFrameElement>("iframe[srcdoc]");
    const report = async (ids: string[]) => {
      const iframe = frame();
      if (!iframe?.contentWindow) throw new Error("HTML iframe missing");
      await act(async () => {
        window.dispatchEvent(new MessageEvent("message", {
          source: iframe.contentWindow,
          data: { type: "plannotator-bridge-unanchored", ids },
        }));
      });
    };
    const refresh = async () => {
      const button = refreshButton();
      if (!button) throw new Error("refresh button missing");
      await act(async () => button.click());
      for (let attempt = 0; attempt < 20 && refreshButton()?.getAttribute("aria-disabled") !== "false"; attempt += 1) {
        await settle();
      }
    };
    expect(chip()).toBeNull();

    // Refresh 1: the remounted viewer's bridge reports X unanchored.
    await refresh();
    await report(["X"]);
    expect(chip()).not.toBeNull();

    // Refresh 2: the page anchors everything; the report is the empty set.
    await refresh();
    await report([]);
    expect(chip()).toBeNull();
  });

  const pressModShiftA = async () => {
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", {
        key: "a", metaKey: true, shiftKey: true, bubbles: true,
      }));
    });
  };

  test("Mod+Shift+A switches the page between Select and Pinpoint, both ways", async () => {
    setStorageBackend(memoryBackend);
    seedAnnouncementsSeen();
    await mountHtmlAnnotate();

    expect(stripButton("Select")!.getAttribute("aria-pressed")).toBe("true");
    await pressModShiftA();
    expect(stripButton("Pinpoint")!.getAttribute("aria-pressed")).toBe("true");
    expect(armedRing() !== null).toBe(true);
    await pressModShiftA();
    expect(stripButton("Select")!.getAttribute("aria-pressed")).toBe("true");
    expect(armedRing() !== null).toBe(false);
  });

  test("Mod+Shift+A switches a Markdown document's toolstrip too", async () => {
    setStorageBackend(memoryBackend);
    seedAnnouncementsSeen();
    await mountMarkdownAnnotate();

    expect(markdownStripButton("Select")!.getAttribute("aria-pressed")).toBe("true");
    await pressModShiftA();
    expect(markdownStripButton("Pinpoint")!.getAttribute("aria-pressed")).toBe("true");
    await pressModShiftA();
    expect(markdownStripButton("Select")!.getAttribute("aria-pressed")).toBe("true");
  });

  test("Escape with nothing open keeps Pinpoint, from the app and from inside the page", async () => {
    setStorageBackend(memoryBackend);
    seedAnnouncementsSeen();
    await mountHtmlAnnotate();
    await act(async () => stripButton("Pinpoint")!.click());
    expect(armedRing() !== null).toBe(true);

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    });
    // What the bridge posts for an Escape inside the armed page.
    const iframe = document.querySelector<HTMLIFrameElement>("iframe[srcdoc]");
    if (!iframe?.contentWindow) throw new Error("HTML iframe missing");
    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        source: iframe.contentWindow,
        data: { type: "plannotator-bridge-annotate-exit" },
      }));
    });

    expect(stripButton("Pinpoint")!.getAttribute("aria-pressed")).toBe("true");
    expect(armedRing() !== null).toBe(true);
  });

  test("the choice is remembered: across a remount, and from a Markdown document to an HTML page", async () => {
    setStorageBackend(memoryBackend);
    seedAnnouncementsSeen();
    await mountMarkdownAnnotate();
    await act(async () => markdownStripButton("Pinpoint")!.click());
    await unmountHtmlAnnotate();

    await mountHtmlAnnotate();
    expect(stripButton("Pinpoint")!.getAttribute("aria-pressed")).toBe("true");
    expect(armedRing() !== null).toBe(true);
    await act(async () => stripButton("Select")!.click());
    await unmountHtmlAnnotate();

    await mountHtmlAnnotate();
    expect(stripButton("Select")!.getAttribute("aria-pressed")).toBe("true");
    expect(armedRing() !== null).toBe(false);
  });

  test("Alt held arms the page, and its release hands the clicks back", async () => {
    setStorageBackend(memoryBackend);
    seedAnnouncementsSeen();
    await mountHtmlAnnotate();
    expect(armedRing() !== null).toBe(false);

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Alt", altKey: true, bubbles: true }));
    });
    // A lone Alt switches a moment after it goes down (useInputMethodSwitch's
    // chord grace, in which a chord's other keys cancel it).
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    expect(armedRing() !== null).toBe(true);
    // Past the hold threshold (useInputMethodSwitch: 300 ms), so the release reverts.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
    });
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keyup", { key: "Alt", bubbles: true }));
    });
    expect(armedRing() !== null).toBe(false);
    expect(stripButton("Select")!.getAttribute("aria-pressed")).toBe("true");
  });

  // Karabiner's Hyper key: Caps Lock held is Cmd+Ctrl+Opt+Shift, tapped alone
  // it is Escape. Its Alt is part of a chord, so taps pressed in the page never
  // arm it, however many and however fast.
  test("Hyper taps pressed in the page (Cmd+Ctrl+Opt+Shift, then Escape) never arm it", async () => {
    setStorageBackend(memoryBackend);
    seedAnnouncementsSeen();
    await mountHtmlAnnotate();
    const chord = ["Meta", "Control", "Alt", "Shift"];
    const held = (n: number) => ({ metaKey: n > 0, ctrlKey: n > 1, altKey: n > 2, shiftKey: n > 3 });
    const armedSeen: boolean[] = [];
    for (let tap = 0; tap < 3; tap += 1) {
      for (let i = 0; i < chord.length; i += 1) {
        await pressInPage({ key: chord[i], ...held(i + 1) });
        armedSeen.push(armedRing() !== null);
      }
      for (let i = chord.length - 1; i >= 0; i -= 1) {
        await pressInPage({ event: "keyup", key: chord[i], ...held(i) });
        armedSeen.push(armedRing() !== null);
      }
      await pressInPage({ key: "Escape", code: "Escape" });
      await pressInPage({ event: "keyup", key: "Escape", code: "Escape" });
    }
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 450));
    });
    expect(armedSeen.filter(Boolean)).toEqual([]);
    expect(armedRing() !== null).toBe(false);
    expect(stripButton("Select")!.getAttribute("aria-pressed")).toBe("true");
  });

  test("Mod+Shift+X flips the tools, from the parent document and from inside the iframe", async () => {
    setStorageBackend(memoryBackend);
    seedAnnouncementsSeen();
    await mountHtmlAnnotate();

    const pressInParent = async () => {
      await act(async () => {
        window.dispatchEvent(new KeyboardEvent("keydown", {
          key: "x", metaKey: true, shiftKey: true, bubbles: true,
        }));
      });
    };
    // What the bridge posts when the same chord is pressed with focus inside
    // the sandboxed page (the parent's listener never sees that keystroke).
    const pressInFrame = async () => {
      const iframe = document.querySelector<HTMLIFrameElement>("iframe[srcdoc]");
      if (!iframe?.contentWindow) throw new Error("HTML iframe missing");
      await act(async () => {
        window.dispatchEvent(new MessageEvent("message", {
          source: iframe.contentWindow,
          data: { type: "plannotator-bridge-tools-toggle" },
        }));
      });
    };

    expect(floatingCluster()).toBeNull();
    await pressInParent();
    expect(floatingCluster()).not.toBeNull();
    expect(toolsToggle()!.getAttribute("aria-pressed")).toBe("false");

    await pressInFrame();
    expect(floatingCluster()).toBeNull();
    expect(toolsToggle()!.getAttribute("aria-pressed")).toBe("true");
  });

  test("no pen in the header: a fresh setup opens the page in Select", async () => {
    setStorageBackend(memoryBackend);
    seedAnnouncementsSeen();
    await mountHtmlAnnotate();

    expect(pen() !== null).toBe(false);
    expect(stripButton("Select")!.getAttribute("aria-pressed")).toBe("true");
    expect(armedRing() !== null).toBe(false);
  });

  test("an HTML page has the Markdown toolstrip above it: its Pinpoint arms the page and its Select disarms it", async () => {
    setStorageBackend(memoryBackend);
    seedAnnouncementsSeen();
    await mountHtmlAnnotate();
    for (const label of ["Select", "Pinpoint", "Markup", "Comment", "Redline", "Label"]) {
      expect(stripButton(label)).toBeDefined();
    }
    expect(stripButton("Select")!.getAttribute("aria-pressed")).toBe("true");
    expect(armedRing() !== null).toBe(false);
    await act(async () => stripButton("Pinpoint")!.click());
    expect(armedRing() !== null).toBe(true);
    await act(async () => stripButton("Select")!.click());
    expect(armedRing() !== null).toBe(false);
  });

  // A key pressed inside the page, as the link guard hands it over on its port
  // with focus in the page (the guard does not run in happy-dom's frame;
  // linkGuard.test.ts holds its side): the app's own shortcuts run for it.
  async function pressInPage(init: Record<string, unknown>): Promise<void> {
    const iframe = document.querySelector<HTMLIFrameElement>("iframe[srcdoc]");
    if (!iframe) throw new Error("HTML iframe missing");
    const port = await bridgeLinkPort(iframe);
    iframe.focus();
    await act(async () => {
      port.postMessage({
        type: "plannotator-bridge-page-key", event: "keydown", code: "", location: 0, repeat: false,
        metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...init,
      });
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }

  test("Mod+Enter pressed inside the page sends the review's Done", async () => {
    setStorageBackend(memoryBackend);
    seedAnnouncementsSeen();
    const sent: string[] = [];
    await mountHtmlAnnotate(async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input), "http://localhost");
      if (url.pathname === "/api/feedback" && init?.method === "POST") sent.push(url.pathname);
      return annotateFetch(input);
    });
    await pressInPage({ key: "Enter", code: "Enter", metaKey: true });
    expect(sent).toEqual(["/api/feedback"]);
  });

  test("Shift+2 pressed inside the page picks Comment", async () => {
    setStorageBackend(memoryBackend);
    seedAnnouncementsSeen();
    await mountHtmlAnnotate();
    expect(stripButton("Comment")!.getAttribute("aria-pressed")).toBe("false");
    await pressInPage({ key: "@", code: "Digit2", shiftKey: true });
    expect(stripButton("Comment")!.getAttribute("aria-pressed")).toBe("true");
  });

  test("Escape pressed inside the page closes the comment composer", async () => {
    setStorageBackend(memoryBackend);
    seedAnnouncementsSeen();
    memory.set(
      "plannotator-html-chrome",
      JSON.stringify({ toolsHidden: false, sidebarOpen: false, panelOpen: false, savedAt: Date.now() }),
    );
    await mountHtmlAnnotate();
    await settle();
    const commentButton = findButtonByText("Comment");
    if (!commentButton) throw new Error("the floating cluster did not render its Comment button");
    await act(async () => commentButton.click());
    await settle();
    const composerOpen = () => document.querySelector('[data-comment-popover="true"]') !== null;
    expect(composerOpen()).toBe(true);

    await pressInPage({ key: "Escape", code: "Escape" });
    expect(composerOpen()).toBe(false);
  });

  test("Shift+3 picks Redline on an HTML page as on a Markdown one, and the toolstrip shows it; Shift+1 returns to Markup", async () => {
    setStorageBackend(memoryBackend);
    seedAnnouncementsSeen();
    await mountHtmlAnnotate();
    expect(stripButton("Markup")!.getAttribute("aria-pressed")).toBe("true");
    expect(stripButton("Redline")!.getAttribute("aria-pressed")).toBe("false");
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "#", code: "Digit3", shiftKey: true, bubbles: true }));
    });
    expect(stripButton("Redline")!.getAttribute("aria-pressed")).toBe("true");
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "!", code: "Digit1", shiftKey: true, bubbles: true }));
    });
    expect(stripButton("Markup")!.getAttribute("aria-pressed")).toBe("true");
  });
});

describe.if(hasDom)("HTML chrome in a folder annotate session", () => {
  function persistedChrome(): Record<string, unknown> {
    const raw = memory.get("plannotator-html-chrome");
    if (!raw) throw new Error("no persisted chrome record");
    const { toolsHidden, sidebarOpen, panelOpen } = JSON.parse(raw) as Record<string, unknown>;
    return { toolsHidden, sidebarOpen, panelOpen };
  }

  test("a saved 'tools shown' record is honoured (the flipped default is not permanent here)", async () => {
    // The whole chrome restore used to be suppressed in folder sessions, so
    // the eye could never remember anything: every folder session opened with
    // the tools hidden no matter how many times the reviewer showed them.
    setStorageBackend(memoryBackend);
    seedAnnouncementsSeen();
    memory.set(
      "plannotator-html-chrome",
      JSON.stringify({ toolsHidden: false, sidebarOpen: false, panelOpen: false, savedAt: Date.now() }),
    );
    await mountHtmlAnnotate(folderFetch);
    await settle();

    expect(floatingCluster()).not.toBeNull();
    expect(toolsToggle()!.getAttribute("aria-pressed")).toBe("false");
  });

  test("the eye persists, and a folder session never records its own sidebar/panel state", async () => {
    setStorageBackend(memoryBackend);
    seedAnnouncementsSeen();
    memory.set(
      "plannotator-html-chrome",
      JSON.stringify({ toolsHidden: false, sidebarOpen: true, panelOpen: true, savedAt: Date.now() }),
    );
    await mountHtmlAnnotate(folderFetch);
    await settle();

    await act(async () => toolsToggle()!.click());
    await settle();

    // The eye's own half is recorded; the two halves the folder file browser
    // owns keep whatever the last ordinary HTML session left.
    expect(persistedChrome()).toEqual({ toolsHidden: true, sidebarOpen: true, panelOpen: true });
  });

  test("annotation activity re-stamps the record without recording the folder sidebar", async () => {
    // Annotating re-stamps the record so the preference does not expire for
    // an active reviewer. That re-stamp used to write the live chrome raw,
    // bypassing the merge: one comment in a folder session (whose file
    // browser forces the sidebar open) rewrote both halves, and the next
    // ordinary `annotate page.html` session opened with the sidebar and the
    // annotations drawer forced open.
    setStorageBackend(memoryBackend);
    seedAnnouncementsSeen();
    memory.set(
      "plannotator-html-chrome",
      JSON.stringify({ toolsHidden: false, sidebarOpen: false, panelOpen: false, savedAt: Date.now() }),
    );
    await mountHtmlAnnotate(folderFetch);
    await settle();

    const commentButton = findButtonByText("Comment");
    if (!commentButton) throw new Error("the floating cluster did not render its Comment button");
    await act(async () => commentButton.click());
    await settle();

    const input = document.querySelector<HTMLTextAreaElement>('[data-comment-popover="true"] textarea');
    if (!input) throw new Error("the global comment composer did not open");
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
      setter.call(input, "one comment from a folder session");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const submit = findButtonByText("Add");
    if (!submit) throw new Error("the global comment composer has no submit control");
    await act(async () => submit.click());
    await settle();

    expect(persistedChrome()).toEqual({ toolsHidden: false, sidebarOpen: false, panelOpen: false });
  });
});
