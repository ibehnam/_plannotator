/**
 * A review's documents as entries of the tab's history (useDocumentHistory).
 *
 * Failures to catch:
 *  - An address that names the wrong file, or one the server answers itself
 *    (`/api/…`, `/assets/…`, a share link's `/p/…`), so a reload or a pasted
 *    address opens something else or never reaches the app.
 *  - Mount pushing an entry (Back would then step onto the same review), or a
 *    reload not reopening the page its entry names.
 *  - A step back or forward pushing an entry of its own (Forward is lost), or
 *    an open the hook asked for that failed leaving the address on a page
 *    that is not on screen.
 *  - Another owner's history state taken for ours; a disabled hook touching
 *    the tab's history at all.
 */
import { afterEach, describe, expect, mock, test } from 'bun:test';
import React, { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  addressFor,
  docFromAddress,
  readHistoryEntry,
  useDocumentHistory,
  type DocumentHistory,
} from './useDocumentHistory';

const hasDom = typeof document !== 'undefined';

const BASE = '/site/r-1';
const ROOT = '/site/r-1/index.html';

describe('addressFor / docFromAddress', () => {
  const at = (address: string) => {
    const url = new URL(address, 'http://localhost:51747');
    return { pathname: url.pathname, search: url.search };
  };
  const roundTrip = (doc: string) => docFromAddress(at(addressFor(doc, BASE, '')!), BASE, ROOT);

  test('a page beside the reviewed file, or below its folder, is addressed by its path there', () => {
    expect(addressFor(`${BASE}/docs-lessons.html`, BASE, '')).toBe('/docs-lessons.html');
    expect(addressFor(`${BASE}/x/current/y.html`, BASE, '')).toBe('/x/current/y.html');
    expect(roundTrip(`${BASE}/x/current/y.html`)).toBe(`${BASE}/x/current/y.html`);
  });

  test('the root is `/`, and the reviewed file named by its own path reads as the root', () => {
    expect(addressFor(null, BASE, '')).toBe('/');
    expect(docFromAddress(at('/'), BASE, ROOT)).toBeNull();
    expect(docFromAddress(at('/index.html'), BASE, ROOT)).toBeNull();
    expect(docFromAddress(at(`/?doc=${ROOT}`), BASE, ROOT)).toBeNull();
  });

  test('a space, `#`, `%` and a non-ASCII name are escaped in the address and read back as they were', () => {
    for (const name of ['appendix #2 50% review.html', 'résumé — 日本.md', 'a+b?c.html']) {
      const doc = `${BASE}/dir one/${name}`;
      const address = addressFor(doc, BASE, '')!;
      expect(address).not.toContain('#');
      expect(address).not.toContain(' ');
      expect(roundTrip(doc)).toBe(doc);
    }
    expect(addressFor(`${BASE}/a #1.html`, BASE, '')).toBe('/a%20%231.html');
  });

  test('a page outside the folder is addressed by `?doc=` with its absolute path, slashes readable', () => {
    expect(addressFor('/site/x/r-9/y.html', BASE, '')).toBe('/?doc=/site/x/r-9/y.html');
    expect(roundTrip('/site/x/r-9/y.html')).toBe('/site/x/r-9/y.html');
    expect(addressFor('/elsewhere/a b#c.md', null, '')).toBe('/?doc=/elsewhere/a%20b%23c.md');
    expect(docFromAddress(at('/?doc=/elsewhere/a%20b%23c.md'), null, null)).toBe('/elsewhere/a b#c.md');
  });

  test('a first segment the server or a share link owns goes by `?doc=` instead', () => {
    for (const rel of ['api/notes.md', 'assets/app.html', 'p/abc123.md', 'favicon.ico']) {
      expect(addressFor(`${BASE}/${rel}`, BASE, '')).toBe(`/?doc=${BASE}/${rel}`);
      expect(roundTrip(`${BASE}/${rel}`)).toBe(`${BASE}/${rel}`);
    }
    // Only the first segment is the server's.
    expect(addressFor(`${BASE}/docs/api/x.md`, BASE, '')).toBe('/docs/api/x.md');
  });

  test("the address keeps the page's other query parameters and replaces its own `doc`", () => {
    expect(addressFor(`${BASE}/a.html`, BASE, '?preview-update=1&doc=/old.md')).toBe('/a.html?preview-update=1');
    expect(addressFor('/out/b.md', BASE, '?preview-update=1')).toBe('/?doc=/out/b.md&preview-update=1');
    expect(addressFor(null, BASE, '?doc=/old.md&x=2')).toBe('/?x=2');
  });

  test('a path an address cannot hold (a lone surrogate) has no address; a malformed escape reads as the root', () => {
    expect(addressFor(`${BASE}/bad\ud800.md`, BASE, '')).toBeNull();
    expect(docFromAddress(at('/%E0%A4%A.html'), BASE, ROOT)).toBeNull();
  });

  test('dot segments resolve as the server resolves them', () => {
    expect(docFromAddress({ pathname: '/a/..%2F..%2Fb.md', search: '' }, BASE, ROOT)).toBe('/site/b.md');
    expect(addressFor(`${BASE}/./x/../y.html`, BASE, '')).toBe('/y.html');
  });
});

describe('readHistoryEntry', () => {
  test('reads only a state of ours', () => {
    expect(readHistoryEntry({ plannotatorDoc: null, plannotatorIndex: 0 })).toEqual({ doc: null, index: 0 });
    expect(readHistoryEntry({ plannotatorDoc: '/a.md', plannotatorIndex: 2, plannotatorPrev: null, plannotatorNext: '/b.md' }))
      .toEqual({ doc: '/a.md', index: 2, prev: null, next: '/b.md' });
    for (const state of [null, {}, { plannotatorDoc: '/a.md' }, { plannotatorDoc: 3, plannotatorIndex: 0 }, { plannotatorDoc: null, plannotatorIndex: -1 }, { plannotatorDoc: null, plannotatorIndex: 1.5 }]) {
      expect(readHistoryEntry(state)).toBeNull();
    }
  });
});

/** The tab's history as a browser keeps it: entries, a position, and popstate after a traversal. */
class FakeHistory {
  entries: Array<{ state: unknown; url: string }>;
  at = 0;
  calls: string[] = [];
  readonly target = new EventTarget();
  constructor(url = '/', state: unknown = null) {
    this.entries = [{ state, url }];
  }
  get state(): unknown { return this.entries[this.at]!.state; }
  get length(): number { return this.entries.length; }
  get url(): string { return this.entries[this.at]!.url; }
  pushState(state: unknown, _title: string, url?: string | null): void {
    this.calls.push(`push ${url}`);
    this.entries = this.entries.slice(0, this.at + 1);
    this.entries.push({ state: structuredClone(state), url: url ?? this.url });
    this.at += 1;
  }
  replaceState(state: unknown, _title: string, url?: string | null): void {
    this.calls.push(`replace ${url ?? '(same)'}`);
    this.entries[this.at] = { state: structuredClone(state), url: url ?? this.url };
  }
  go(delta: number): void {
    this.calls.push(`go ${delta}`);
    const to = this.at + delta;
    if (to < 0 || to >= this.entries.length) return;
    this.at = to;
    // A traversal ends with popstate, a task later.
    setTimeout(() => {
      const event = new Event('popstate');
      Object.defineProperty(event, 'state', { value: this.state });
      this.target.dispatchEvent(event);
    }, 0);
  }
  back(): void { this.go(-1); }
  forward(): void { this.go(1); }
  location(): Location {
    const self = this;
    return {
      get pathname() { return new URL(self.url, 'http://localhost').pathname; },
      get search() { return new URL(self.url, 'http://localhost').search; },
    } as Location;
  }
}

describe.if(hasDom)('useDocumentHistory', () => {
  let root: Root | null = null;
  let host: HTMLElement | null = null;
  let api: (DocumentHistory & { show: (doc: string | null) => void }) | null = null;
  let fake: FakeHistory;
  // The host's router: opens DOC a beat later, unless it is missing.
  let missing = new Set<string>();
  const open = mock(async (doc: string) => {
    await new Promise((r) => setTimeout(r, 1));
    if (!missing.has(doc)) api!.show(doc);
  });
  const showRoot = mock(() => { api!.show(null); });

  const Harness: React.FC<{ enabled?: boolean; ready?: boolean }> = ({ enabled = true, ready = true }) => {
    const [activeDoc, setActiveDoc] = useState<string | null>(null);
    const history = useDocumentHistory({
      enabled,
      ready,
      activeDoc,
      base: BASE,
      rootFile: ROOT,
      session: 'session-1',
      open: (doc) => open(doc),
      showRoot: () => showRoot(),
      opensFromAddress: (doc) => /\.(md|html?)$/.test(doc),
      history: fake as unknown as History,
      location: fake.location(),
      eventTarget: fake.target as unknown as Window,
    });
    api = { ...history, show: setActiveDoc };
    return null;
  };

  async function mount(props: { enabled?: boolean; ready?: boolean } = {}): Promise<void> {
    host = document.createElement('div');
    document.body.appendChild(host);
    await act(async () => {
      root = createRoot(host!);
      root.render(<Harness {...props} />);
    });
  }
  async function settle(ms = 20): Promise<void> {
    await act(async () => { await new Promise((r) => setTimeout(r, ms)); });
  }
  async function show(doc: string | null): Promise<void> {
    await act(async () => { api!.show(doc); });
  }

  afterEach(async () => {
    await act(async () => { root?.unmount(); });
    host?.remove();
    root = null;
    host = null;
    api = null;
    missing = new Set();
    open.mockClear();
    showRoot.mockClear();
  });

  test('mount tags the entry on screen and pushes nothing', async () => {
    fake = new FakeHistory('/');
    await mount();
    expect(fake.calls).toEqual(['replace /']);
    expect(fake.length).toBe(1);
    expect(readHistoryEntry(fake.state)).toEqual({ doc: null, index: 0, session: 'session-1' });
    expect(api!.canGoBack).toBe(false);
    expect(api!.canGoForward).toBe(false);
  });

  test('each document opened is one entry, at its own address, numbered after the last', async () => {
    fake = new FakeHistory('/');
    await mount();
    await show(`${BASE}/second.html`);
    await show(`${BASE}/x/current/y.html`);
    expect(fake.entries.map((e) => e.url)).toEqual(['/', '/second.html', '/x/current/y.html']);
    expect(readHistoryEntry(fake.state)).toMatchObject({ doc: `${BASE}/x/current/y.html`, index: 2 });
    // The same document again is no entry.
    await show(`${BASE}/x/current/y.html`);
    expect(fake.length).toBe(3);
  });

  test('a step back opens its page with the reader\'s place and pushes nothing; the root comes back by showRoot', async () => {
    fake = new FakeHistory('/');
    await mount();
    await show(`${BASE}/second.html`);
    await show(`${BASE}/third.html`);
    const before = fake.calls.length;
    await act(async () => { api!.back(); });
    await settle();
    expect(open).toHaveBeenCalledTimes(1);
    expect(open.mock.calls[0]![0]).toBe(`${BASE}/second.html`);
    await act(async () => { api!.back(); });
    await settle();
    expect(showRoot).toHaveBeenCalledTimes(1);
    expect(fake.calls.slice(before)).toEqual(['go -1', 'go -1']);
    expect(fake.at).toBe(0);
    expect(fake.length).toBe(3);
    // Forward reopens the page ahead, still without a push.
    await act(async () => { api!.forward(); });
    await settle();
    expect(open.mock.calls[1]![0]).toBe(`${BASE}/second.html`);
    expect(fake.calls.slice(before)).toEqual(['go -1', 'go -1', 'go 1']);
  });

  test("another owner's history state is ignored", async () => {
    fake = new FakeHistory('/');
    await mount();
    await show(`${BASE}/second.html`);
    fake.entries.push({ state: { someoneElse: true }, url: '/elsewhere' });
    const before = fake.calls.length;
    await act(async () => { fake.go(1); });
    await settle();
    expect(open).not.toHaveBeenCalled();
    expect(showRoot).not.toHaveBeenCalled();
    expect(fake.calls.slice(before)).toEqual(['go 1']);
  });

  test('a step to a page that no longer opens puts the address back to the page on screen', async () => {
    fake = new FakeHistory('/');
    await mount();
    await show(`${BASE}/gone.html`);
    await show(`${BASE}/third.html`);
    missing.add(`${BASE}/gone.html`);
    await act(async () => { api!.back(); });
    await settle();
    expect(open).toHaveBeenCalledTimes(1);
    expect(fake.at).toBe(1);
    expect(fake.url).toBe('/third.html');
    expect(readHistoryEntry(fake.state)).toMatchObject({ doc: `${BASE}/third.html`, index: 1 });
    expect(fake.length).toBe(3);
  });

  test('a reload on a page reopens it from its entry, and the open becomes that entry, not a new one', async () => {
    fake = new FakeHistory('/second.html', { plannotatorDoc: `${BASE}/second.html`, plannotatorIndex: 1, plannotatorPrev: null, plannotatorSession: 'session-1' });
    await mount();
    await settle();
    expect(open.mock.calls.map((c) => c[0])).toEqual([`${BASE}/second.html`]);
    expect(fake.calls).toEqual([]);
    expect(api!.restoresPage()).toBe(true);
    expect(api!.canGoBack).toBe(true);
  });

  // A later session on the same port, in the same tab: its entries are not this review's pages.
  test("an entry another session wrote is read as a pasted address, never as this review's entry", async () => {
    fake = new FakeHistory('/gone-elsewhere.md', { plannotatorDoc: '/other/review/x.md', plannotatorIndex: 4, plannotatorSession: 'session-0' });
    await mount();
    await settle();
    expect(open.mock.calls.map((c) => c[0])).toEqual([`${BASE}/gone-elsewhere.md`]);
    expect(readHistoryEntry(fake.state)).toEqual({ doc: `${BASE}/gone-elsewhere.md`, index: 0, session: 'session-1' });
    expect(api!.canGoBack).toBe(false);
  });

  test('a pasted address naming a document opens it, as the first entry', async () => {
    fake = new FakeHistory('/notes/b.md');
    await mount();
    await settle();
    expect(open.mock.calls.map((c) => c[0])).toEqual([`${BASE}/notes/b.md`]);
    expect(fake.length).toBe(1);
    expect(readHistoryEntry(fake.state)).toEqual({ doc: `${BASE}/notes/b.md`, index: 0, session: 'session-1' });
  });

  test('a pasted address naming no kind of document Plannotator annotates is not opened, and reads as the root', async () => {
    // `/api/doc` reads any path as markdown: /dev/zero would be read forever.
    fake = new FakeHistory('/?doc=/dev/zero');
    await mount();
    await settle();
    expect(open).not.toHaveBeenCalled();
    expect(fake.calls).toEqual(['replace /']);
  });

  test('replaceNext: the next document opened takes the entry on screen', async () => {
    fake = new FakeHistory('/');
    await mount();
    act(() => { api!.replaceNext(); });
    await show(`${BASE}/first.md`);
    expect(fake.length).toBe(1);
    expect(fake.url).toBe('/first.md');
    await show(`${BASE}/second.md`);
    expect(fake.length).toBe(2);
  });

  // A page's own Back is forwarded here (HtmlViewer's onPageHistory): it must never leave the review.
  test('go never steps before the review\'s first entry', async () => {
    fake = new FakeHistory('/');
    await mount();
    act(() => { api!.go(-1); });
    expect(fake.calls).toEqual(['replace /']);
    await show(`${BASE}/second.html`);
    await show(`${BASE}/third.html`);
    act(() => { api!.go(-3); api!.go(0); api!.go(1.5); });
    expect(fake.calls.filter((c) => c.startsWith('go'))).toEqual([]);
    act(() => { api!.go(-2); });
    await settle();
    expect(fake.calls.filter((c) => c.startsWith('go'))).toEqual(['go -2']);
    expect(showRoot).toHaveBeenCalledTimes(1);
  });

  // A page's own Back pressed once can call history.back() in a loop: each call read the same entry, so the steps
  // together ran past the review's first page.
  test('a burst of steps takes one, until it lands; a step that lands nowhere frees the next one in time', async () => {
    fake = new FakeHistory('/');
    await mount();
    await show(`${BASE}/second.html`);
    await show(`${BASE}/third.html`);
    act(() => { for (let i = 0; i < 5; i += 1) api!.go(-1); });
    expect(fake.calls.filter((c) => c.startsWith('go'))).toEqual(['go -1']);
    await settle();
    act(() => { api!.go(-1); });
    expect(fake.calls.filter((c) => c.startsWith('go'))).toEqual(['go -1', 'go -1']);
    await settle();
    expect(fake.at).toBe(0);
    // Past the last entry nothing happens, and no popstate comes: the next step waits a second at most.
    act(() => { api!.go(5); });
    act(() => { api!.go(1); });
    expect(fake.calls.filter((c) => c.startsWith('go'))).toEqual(['go -1', 'go -1', 'go 5']);
    await settle(1100);
    act(() => { api!.go(1); });
    expect(fake.calls.filter((c) => c.startsWith('go'))).toEqual(['go -1', 'go -1', 'go 5', 'go 1']);
  });

  // Back and Forward are named after their pages from the entry on screen alone.
  test('each entry names the page before it and, once left, the page after it; a new page after a Back renames it', async () => {
    fake = new FakeHistory('/');
    await mount();
    await show(`${BASE}/second.html`);
    expect(api!.canGoBack).toBe(true);
    expect(api!.backDoc).toBeNull();
    expect(api!.canGoForward).toBe(false);
    await show(`${BASE}/third.html`);
    expect(api!.backDoc).toBe(`${BASE}/second.html`);
    await act(async () => { api!.back(); });
    await settle();
    expect(api!.canGoForward).toBe(true);
    expect(api!.forwardDoc).toBe(`${BASE}/third.html`);
    expect(api!.backDoc).toBeNull();
    await show(`${BASE}/other.md`);
    await act(async () => { api!.back(); });
    await settle();
    expect(api!.forwardDoc).toBe(`${BASE}/other.md`);
    expect(fake.entries.map((e) => e.url)).toEqual(['/', '/second.html', '/other.md']);
  });

  test('disabled: the tab\'s history is never read or written', async () => {
    fake = new FakeHistory('/second.html', { plannotatorDoc: `${BASE}/second.html`, plannotatorIndex: 1 });
    await mount({ enabled: false });
    await show(`${BASE}/third.html`);
    await act(async () => { api!.back(); api!.go(-1); });
    await settle();
    expect(fake.calls).toEqual([]);
    expect(open).not.toHaveBeenCalled();
  });

  test('not ready: nothing until the root has loaded', async () => {
    fake = new FakeHistory('/');
    await mount({ ready: false });
    expect(fake.calls).toEqual([]);
  });
});
