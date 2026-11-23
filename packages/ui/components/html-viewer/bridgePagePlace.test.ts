/**
 * The bridge reporting where the reader is in the page (`page-place`) and
 * putting them back there (`restore-place`): a host's history keeps each
 * page's place for its entry and gives it back on a step back or forward.
 *
 * These evaluate the SHIPPED functions out of the bridge's string with small
 * fakes. Guards: nothing is reported until the host asks; a run of scrolls
 * posts the latest place at most every 100 ms and once more after the last;
 * a live session reports nothing. A restore goes to the place on a page of the
 * same width and to the same share of the height on one of another width;
 * reaches it once a page still laying out is tall enough (at load, or as it
 * settles); ends on the reader's own input, on a scroll of the page's own
 * once the place was reached, on a newer restore, and by itself after its
 * last settle; and a malformed place moves nothing.
 */
import { describe, expect, test } from 'bun:test';
import { BRIDGE_SCRIPT } from './bridge-script';

function extractFunction(name: string): string {
  const start = BRIDGE_SCRIPT.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`bridge no longer defines ${name}`);
  let depth = 0;
  for (let i = BRIDGE_SCRIPT.indexOf('{', start); i < BRIDGE_SCRIPT.length; i += 1) {
    if (BRIDGE_SCRIPT[i] === '{') depth += 1;
    else if (BRIDGE_SCRIPT[i] === '}') {
      depth -= 1;
      if (depth === 0) return BRIDGE_SCRIPT.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced braces around ${name}`);
}

interface Api {
  notePlaceForHost: () => void;
  restorePagePlace: (place: unknown) => void;
  setPageReports: (data: Record<string, unknown>) => void;
}

/** A page of HEIGHT px laid out WIDTH px wide in a window 800 px tall, with a fake clock. */
function bridge(options: { live?: boolean; height?: number; width?: number; loading?: boolean } = {}) {
  const posted: Record<string, unknown>[] = [];
  const scrolledTo: number[] = [];
  const root = { scrollTop: 0, scrollHeight: options.height ?? 10_000, clientWidth: options.width ?? 1000 };
  const listeners = new Map<string, Set<() => void>>();
  const fakeWindow = {
    scrollY: 0,
    scrollX: 0,
    innerWidth: options.width ?? 1000,
    innerHeight: 800,
    addEventListener: (type: string, fn: () => void) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    removeEventListener: (type: string, fn: () => void) => { listeners.get(type)?.delete(fn); },
    scrollTo(arg: { top: number } | number, y?: number) {
      const top = typeof arg === 'number' ? (y ?? 0) : arg.top;
      const clamped = Math.max(0, Math.min(top, root.scrollHeight - fakeWindow.innerHeight));
      scrolledTo.push(top);
      fakeWindow.scrollY = clamped;
      root.scrollTop = clamped;
    },
  };
  const fakeDocument = { scrollingElement: root, documentElement: root, readyState: options.loading ? 'loading' : 'complete' };
  // A fake clock: timers run, in order, as `advance` passes their time.
  let now = 0;
  let nextId = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const setTimeoutFake = (fn: () => void, ms: number) => { const id = nextId++; timers.set(id, { at: now + ms, fn }); return id; };
  const clearTimeoutFake = (id: number) => { timers.delete(id); };
  const advance = (ms: number) => {
    const until = now + ms;
    for (;;) {
      const due = [...timers.entries()].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]);
      now = due[1].at;
      due[1].fn();
    }
    now = until;
  };
  const api = new Function(
    'window',
    'document',
    'setTimeout',
    'clearTimeout',
    'LIVE',
    'PREFIX',
    'postToParent',
    `var pageReports = { contentWidth: false, scrollUp: false, tap: false, place: false, scale: 1 };
     var pageReportListeners = { contentWidth: false, motion: false, place: false };
     var lastContentWidth = '';
     var scrollTops = new WeakMap();
     var scrollUpRun = 0;
     var lastScrollUpPost = 0;
     var tapStart = null;
     var placeTimer = null;
     var stopPlaceRestore = null;
     ${extractFunction('postContentWidth')}
     ${extractFunction('noteScrollForHost')}
     ${extractFunction('noteTapStart')}
     ${extractFunction('noteTapEnd')}
     ${extractFunction('setPageReports')}
     ${extractFunction('pagePlace')}
     ${extractFunction('notePlaceForHost')}
     ${extractFunction('restorePagePlace')}
     return { notePlaceForHost: notePlaceForHost, restorePagePlace: restorePagePlace, setPageReports: setPageReports };`,
  )(
    fakeWindow,
    fakeDocument,
    setTimeoutFake,
    clearTimeoutFake,
    options.live ? { token: 't' } : null,
    'plannotator-bridge-',
    (msg: Record<string, unknown>) => posted.push(msg),
  ) as Api;
  /** The page scrolls to TOP, and its scroll event reaches every listener the bridge put on. */
  const scrollPage = (top: number) => {
    fakeWindow.scrollY = top;
    root.scrollTop = top;
    for (const fn of listeners.get('scroll') ?? []) fn();
  };
  const fire = (type: string) => { for (const fn of [...(listeners.get(type) ?? [])]) fn(); };
  return { ...api, posted, scrolledTo, root, win: fakeWindow, doc: fakeDocument, listeners, advance, scrollPage, fire };
}

const places = (posted: Record<string, unknown>[]) => posted.filter((m) => m.type === 'plannotator-bridge-page-place');

describe('page-place', () => {
  test('nothing is reported until the host asks; then a run of scrolls posts the latest place every 100 ms, and once after the last', () => {
    const b = bridge();
    b.scrollPage(300);
    b.notePlaceForHost();
    b.advance(500);
    expect(b.posted).toEqual([]);

    b.setPageReports({ place: true });
    b.scrollPage(500);
    b.advance(50);
    b.scrollPage(800);
    b.advance(60);
    expect(places(b.posted)).toEqual([{ type: 'plannotator-bridge-page-place', top: 800, height: 10_000, width: 1000 }]);
    b.scrollPage(900);
    b.advance(100);
    expect(places(b.posted).map((m) => m.top)).toEqual([800, 900]);
    b.advance(1000);
    expect(places(b.posted)).toHaveLength(2);
  });

  test('a live session reports nothing', () => {
    const b = bridge({ live: true });
    b.setPageReports({ place: true });
    b.scrollPage(800);
    b.notePlaceForHost();
    b.advance(500);
    expect(b.posted).toEqual([]);
  });
});

describe('restore-place', () => {
  test('a page of the same width goes to the place; one of another width to the same share of its height', () => {
    const b = bridge();
    b.restorePagePlace({ top: 4000, height: 10_000, width: 1000 });
    expect(b.win.scrollY).toBe(4000);
    // Taken 500 px wide on a page then 20,000 tall: 4000 of 20,000 is a fifth of this page.
    b.restorePagePlace({ top: 4000, height: 20_000, width: 500 });
    expect(b.win.scrollY).toBe(2000);
  });

  test('a page still laying out: the place is reached once the page is tall enough, at load or as it settles', () => {
    const b = bridge({ height: 2000, loading: true });
    b.restorePagePlace({ top: 4000, height: 10_000, width: 1000 });
    expect(b.win.scrollY).toBe(1200);
    b.root.scrollHeight = 10_000;
    b.fire('load');
    expect(b.win.scrollY).toBe(4000);

    const c = bridge({ height: 2000 });
    c.restorePagePlace({ top: 4000, height: 10_000, width: 1000 });
    c.root.scrollHeight = 10_000;
    c.advance(150);
    expect(c.win.scrollY).toBe(4000);
  });

  test("the reader's own input ends it", () => {
    const b = bridge({ height: 2000 });
    b.restorePagePlace({ top: 4000, height: 10_000, width: 1000 });
    b.fire('pointerdown');
    b.root.scrollHeight = 10_000;
    b.advance(3000);
    expect(b.win.scrollY).toBe(1200);
    for (const type of ['wheel', 'touchstart', 'keydown', 'pointerdown', 'load']) {
      expect(b.listeners.get(type)?.size ?? 0).toBe(0);
    }
  });

  test("a scroll of the page's own once the place was reached ends it", () => {
    const b = bridge();
    b.restorePagePlace({ top: 4000, height: 10_000, width: 1000 });
    b.scrollPage(100);
    b.advance(3000);
    expect(b.win.scrollY).toBe(100);
  });

  test('a newer restore replaces one still settling, and each ends by itself after its last settle', () => {
    const b = bridge({ height: 2000 });
    b.restorePagePlace({ top: 4000, height: 10_000, width: 1000 });
    b.restorePagePlace({ top: 500, height: 10_000, width: 1000 });
    b.root.scrollHeight = 10_000;
    b.advance(3000);
    expect(b.win.scrollY).toBe(500);
    expect(b.scrolledTo.filter((top) => top === 4000)).toHaveLength(1);
    for (const type of ['wheel', 'touchstart', 'keydown', 'pointerdown', 'load']) {
      expect(b.listeners.get(type)?.size ?? 0).toBe(0);
    }
  });

  test('a malformed place, or a live session, moves nothing', () => {
    const b = bridge();
    for (const place of [null, {}, { top: -5 }, { top: '400' }, { top: Number.NaN }, { top: Number.POSITIVE_INFINITY }]) {
      b.restorePagePlace(place);
    }
    b.advance(3000);
    expect(b.scrolledTo).toEqual([]);
    const live = bridge({ live: true });
    live.restorePagePlace({ top: 4000, height: 10_000, width: 1000 });
    expect(live.scrolledTo).toEqual([]);
  });
});
