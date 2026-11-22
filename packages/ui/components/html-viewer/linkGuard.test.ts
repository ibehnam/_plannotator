/**
 * The link guard (linkGuard.ts), the shipped string run in a happy-dom window
 * whose `parent` is a fake host. It runs first in a frame's document, so every
 * listener these tests add comes after it, as any page script's would (one in
 * `<head>` included).
 *
 * Guards: it offers the host one port, with the load's key, and the page never
 * sees that offer; a link goes out only while a person's click is being
 * dispatched, and only for the link that click is on; a page's own call, a
 * script's `a.click()`, another href or a `javascript:` link sends nothing; a
 * form's address goes out only for a press on a submit control, as a query
 * with no fragment; a page listener that stops the click first does not hide
 * it from the guard; the page cannot replace the guard. `withLinkKey` puts a
 * served frame's key last in the query and keeps the page's own query.
 *
 * DOM-gated: runs under DOM_TESTS=1 (happy-dom), from tests/dom-test-list.txt.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { defineShortcutScope } from '../../shortcuts/core';
import { LINK_GUARD_FUNCTION, PAGE_KEY_MESSAGE, PAGE_KEYS_MESSAGE, linkGuardScriptTag, newLinkKey, withLinkKey } from './linkGuard';
import { pageKeyClaims } from './pageKeys';

const hasDom = typeof document !== 'undefined';
const KEY = 'a'.repeat(32);

type Guard = { follow: (kind: string, msg: unknown) => boolean };
type Offer = { data: Record<string, unknown>; origin: string; transfer: Transferable[] | undefined };

describe('withLinkKey', () => {
  const base = 'http://localhost:4000/#thread=t1';
  test('the key goes last in the query; the page query and fragment stay as they were', () => {
    expect(withLinkKey('http://localhost:4000/api/inbox/pages/abc', KEY, base)).toBe(`http://localhost:4000/api/inbox/pages/abc?__pnk=${KEY}`);
    expect(withLinkKey('/api/inbox/pages/abc?variant=2&n=3#top', KEY, base)).toBe(`/api/inbox/pages/abc?variant=2&n=3&__pnk=${KEY}#top`);
  });

  test('a path on the host server stays a path, whatever the host document is at', () => {
    expect(withLinkKey('/api/inbox/pages/abc?variant=2#top', KEY, 'about:blank')).toBe(`/api/inbox/pages/abc?variant=2&__pnk=${KEY}#top`);
    expect(withLinkKey('//elsewhere.example/p', KEY, 'about:blank')).toBe('//elsewhere.example/p');
  });

  test("a key the page's own query carried is dropped, so the guard reads only the host's", () => {
    const other = 'b'.repeat(32);
    expect(withLinkKey(`/p?__pnk=${other}&v=1`, KEY, base)).toBe(`/p?v=1&__pnk=${KEY}`);
  });

  test('a new key every time, 32 hex characters; the inline tag refuses anything else', () => {
    const a = newLinkKey();
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(newLinkKey()).not.toBe(a);
    expect(() => linkGuardScriptTag("x');alert(1);('")).toThrow();
  });
});

describe('pageKeyClaims', () => {
  test("a surface's Cmd chords, once each; never a Ctrl chord, a bare key or what plain data cannot match", () => {
    const scope = (id: string, bindings: string[][]) => defineShortcutScope({
      id,
      title: id,
      shortcuts: Object.fromEntries(bindings.map((b, i) => [`a${i}`, { description: id, bindings: b, section: 'S' }])),
    });
    const registry = [
      scope('one', [['Mod+Enter'], ['Mod+Shift+A', 'Mod+.'], ['Ctrl+B'], ['Escape'], ['Shift+1'], ['G G'], ['Mod+1']]),
      scope('two', [['Mod+Enter'], ['Mod+Alt+K']]),
    ];
    expect(pageKeyClaims(registry)).toEqual([
      { key: 'Enter', shift: false, alt: false },
      { key: 'A', shift: true, alt: false },
      { key: '.', shift: false, alt: false },
      { key: 'K', shift: false, alt: true },
    ]);
  });
});

describe.if(hasDom)('the link guard in a frame', () => {
  const offers: Offer[] = [];
  const pageMessages: unknown[] = [];
  const sent: Array<Record<string, unknown>> = [];
  let guard: Guard;
  let hostPort: MessagePort | null = null;
  let realParent: PropertyDescriptor | undefined;
  const pageListener = (event: MessageEvent) => pageMessages.push(event.data);
  /** What the bridge does from its click handler: hand the click to the guard. */
  let bridgeCall: ((event: MouseEvent) => void) | null = null;
  const bridge = (event: Event) => bridgeCall?.(event as MouseEvent);

  beforeAll(async () => {
    realParent = Object.getOwnPropertyDescriptor(window, 'parent');
    const fakeHost = {
      postMessage(data: Record<string, unknown>, origin: string, transfer?: Transferable[]) {
        offers.push({ data, origin, transfer });
      },
    };
    Object.defineProperty(window, 'parent', { value: fakeHost, configurable: true });
    new Function(`${LINK_GUARD_FUNCTION}('${KEY}');`)();
    // A page script, after the guard: it listens for messages on its window.
    window.addEventListener('message', pageListener, true);
    document.addEventListener('click', bridge, true);
    guard = (window as unknown as { __plannotatorLinkGuard: Guard }).__plannotatorLinkGuard;
    hostPort = (offers[0]?.transfer?.[0] as MessagePort | undefined) ?? null;
    if (hostPort) hostPort.onmessage = (event) => sent.push(event.data as Record<string, unknown>);
    await new Promise((resolve) => setTimeout(resolve, 20));
  });

  afterAll(() => {
    window.removeEventListener('message', pageListener, true);
    document.removeEventListener('click', bridge, true);
    if (realParent) Object.defineProperty(window, 'parent', realParent);
    hostPort?.close();
  });

  afterEach(async () => {
    bridgeCall = null;
    sent.length = 0;
    document.body.replaceChildren();
  });

  const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

  /** A person's click (`isTrusted`, which only the browser sets) or a script's. */
  function click(el: Element, trusted = true): MouseEvent {
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    if (trusted) Object.defineProperty(event, 'isTrusted', { value: true });
    el.dispatchEvent(event);
    return event;
  }

  function page(html: string): HTMLElement {
    document.body.innerHTML = html;
    return document.body;
  }

  test('it offers the host one port, with the load key, and the page never sees the offer', async () => {
    expect(offers).toHaveLength(1);
    expect(offers[0]!.data).toEqual({ type: 'plannotator-bridge-link-offer', key: KEY });
    expect(offers[0]!.transfer).toHaveLength(1);
    await settle();
    expect(pageMessages).toEqual([]);
  });

  test("a person's click on a link goes out on the port, for that link", async () => {
    page('<a id="go" href="next.html?v=2#top"><span id="inner">Next</span></a>');
    bridgeCall = () => guard.follow('link', { type: 'plannotator-bridge-link-click', href: 'next.html?v=2#top' });
    click(document.querySelector('#inner')!);
    await settle();
    expect(sent).toEqual([{ type: 'plannotator-bridge-link-click', href: 'next.html?v=2#top' }]);
  });

  test("the page's own call with no click, and a script's a.click(), send nothing", async () => {
    page('<a id="go" href="/#thread=T2">Go</a>');
    expect(guard.follow('link', { href: '/#thread=T2' })).toBe(false);
    bridgeCall = () => guard.follow('link', { href: '/#thread=T2' });
    click(document.querySelector('#go')!, false);
    (document.querySelector('#go') as HTMLAnchorElement).click();
    await settle();
    expect(sent).toEqual([]);
  });

  // A page's own history.back() (md2web's Back button) moves the host's history only for a press in the page:
  // without that rule a page could step the review at its open, or bounce between two of its entries for ever.
  test("a page's history step goes out on the port only while a person's click is being dispatched", async () => {
    page('<button id="back" type="button">Back</button>');
    bridgeCall = () => guard.follow('history', { delta: -1 });
    click(document.querySelector('#back')!);
    await settle();
    expect(sent).toEqual([{ type: 'plannotator-bridge-page-history', delta: -1 }]);
  });

  test('with no click, with a script\'s click, or as no step of whole entries within 100, a history step sends nothing', async () => {
    page('<button id="back" type="button">Back</button>');
    expect(guard.follow('history', { delta: -1 })).toBe(false);
    bridgeCall = () => guard.follow('history', { delta: -1 });
    click(document.querySelector('#back')!, false);
    for (const delta of [0, -0, 0.5, 101, -101, Number.NaN, Number.POSITIVE_INFINITY, '1', null]) {
      bridgeCall = () => guard.follow('history', { delta });
      click(document.querySelector('#back')!);
    }
    bridgeCall = () => guard.follow('history', null);
    click(document.querySelector('#back')!);
    await settle();
    expect(sent).toEqual([]);
  });

  test('during a real click, another href or a javascript: link sends nothing', async () => {
    page('<a id="go" href="ok.html">Ok</a><a id="js" href="javascript:void 0">Js</a>');
    bridgeCall = () => guard.follow('link', { href: '/#thread=T2' });
    click(document.querySelector('#go')!);
    bridgeCall = () => guard.follow('link', { href: 'javascript:void 0' });
    click(document.querySelector('#js')!);
    await settle();
    expect(sent).toEqual([]);
  });

  test('once the click is over, the page cannot reuse it', async () => {
    page('<a id="go" href="ok.html">Ok</a>');
    click(document.querySelector('#go')!);
    expect(guard.follow('link', { href: 'ok.html' })).toBe(false);
    await settle();
    expect(sent).toEqual([]);
  });

  test("a form's address goes out only for a press on a submit control, as a query with no fragment", async () => {
    page('<form><input name="q" value="x"><button id="go">Go</button></form><a id="link" href="a.html">A</a>');
    bridgeCall = () => guard.follow('form', { href: 'results.html?q=x' });
    click(document.querySelector('#go')!);
    bridgeCall = () => guard.follow('form', { href: '/#thread=T2' });
    click(document.querySelector('#go')!);
    bridgeCall = () => guard.follow('form', { href: '?q=x' });
    click(document.querySelector('#link')!);
    await settle();
    expect(sent).toEqual([{ type: 'plannotator-bridge-link-click', href: 'results.html?q=x' }]);
  });

  test('a page listener that stops the click first does not hide it from the guard', async () => {
    page('<a id="go" href="ok.html">Ok</a>');
    // The page's own listener runs after the guard's: it stops the click, then calls the guard itself.
    const stop = (event: Event) => {
      event.stopImmediatePropagation();
      guard.follow('link', { href: 'ok.html' });
    };
    window.addEventListener('click', stop, true);
    try {
      click(document.querySelector('#go')!);
    } finally {
      window.removeEventListener('click', stop, true);
    }
    await settle();
    // The guard saw the click first: a real click on that link follows, as the person meant.
    expect(sent).toEqual([{ type: 'plannotator-bridge-link-click', href: 'ok.html' }]);
  });

  test('the page cannot replace the guard, and a second run makes no second offer', () => {
    const w = window as unknown as Record<string, unknown>;
    expect(() => Object.defineProperty(window, '__plannotatorLinkGuard', { value: { follow: () => true } })).toThrow();
    try { w.__plannotatorLinkGuard = { follow: () => true }; } catch { /* strict-mode assignment to a read-only property */ }
    expect(w.__plannotatorLinkGuard).toBe(guard);
    new Function(`${LINK_GUARD_FUNCTION}('${'c'.repeat(32)}');`)();
    expect(offers).toHaveLength(1);
  });

  // Keys (HtmlViewer's forwardPageKeys): the host asks on the port for the
  // keys a person presses in the page, naming the Cmd chords it serves first.
  describe('keys', () => {
    const ENTER = { key: 'Enter', shift: false, alt: false };
    const TOGGLE = { key: 'A', shift: true, alt: false };
    /** What the host sends on its end of the port. */
    async function hostAsks(claims: unknown, escape = false): Promise<void> {
      hostPort!.postMessage({ type: PAGE_KEYS_MESSAGE, claims, escape });
      await settle();
    }
    /** A key pressed by a person (`isTrusted`, which only the browser sets) or dispatched by a script. */
    function press(el: Element, init: KeyboardEventInit, { trusted = true, type = 'keydown' } = {}): KeyboardEvent {
      const event = new KeyboardEvent(type, { bubbles: true, cancelable: true, ...init });
      if (trusted) Object.defineProperty(event, 'isTrusted', { value: true });
      el.dispatchEvent(event);
      return event;
    }
    const keysSent = () => sent.filter((m) => m.type === PAGE_KEY_MESSAGE).map((m) => `${m.event} ${m.metaKey ? 'Meta+' : ''}${m.shiftKey ? 'Shift+' : ''}${m.key}`);
    /** A page listener after the guard's: what the page saw. */
    let pageSaw: string[] = [];
    const pageListener = (e: Event) => pageSaw.push((e as KeyboardEvent).key);
    beforeAll(() => window.addEventListener('keydown', pageListener, true));
    afterAll(() => window.removeEventListener('keydown', pageListener, true));
    afterEach(async () => {
      pageSaw = [];
      await hostAsks(null);
      sent.length = 0;
    });

    test('nothing goes out until the host asks for keys, and nothing once it stops', async () => {
      page('<p id="p">Text</p>');
      press(document.querySelector('#p')!, { key: 'x', code: 'KeyX' });
      await hostAsks([ENTER]);
      await hostAsks(null);
      press(document.querySelector('#p')!, { key: 'y', code: 'KeyY' });
      await settle();
      expect(keysSent()).toEqual([]);
    });

    test('a key the page did not use goes out once every listener had its turn, and its keyup too', async () => {
      page('<p id="p">Text</p>');
      await hostAsks([ENTER]);
      const event = press(document.querySelector('#p')!, { key: 'x', code: 'KeyX' });
      press(document.querySelector('#p')!, { key: 'Alt', code: 'AltLeft', altKey: true });
      press(document.querySelector('#p')!, { key: 'Alt', code: 'AltLeft' }, { type: 'keyup' });
      expect(keysSent()).toEqual([]);
      expect(event.defaultPrevented).toBe(false);
      await settle();
      expect(keysSent()).toEqual(['keydown x', 'keydown Alt', 'keyup Alt']);
      expect(sent[0]).toEqual({
        type: PAGE_KEY_MESSAGE, event: 'keydown', key: 'x', code: 'KeyX', location: 0, repeat: false,
        metaKey: false, ctrlKey: false, shiftKey: false, altKey: false,
      });
    });

    test('a key the page used, stopped on its way, typed into its field, mid-composition or synthetic stays the page\'s', async () => {
      page('<p id="p">Text</p><input id="field"><div contenteditable="true"><span id="rich">Rich</span></div>');
      await hostAsks([ENTER]);
      const p = document.querySelector('#p')!;
      const used = (e: Event) => { if ((e as KeyboardEvent).key === 'u') e.preventDefault(); };
      const stopped = (e: Event) => { if ((e as KeyboardEvent).key === 's') e.stopPropagation(); };
      document.addEventListener('keydown', used);
      document.addEventListener('keydown', stopped);
      try {
        press(p, { key: 'u', code: 'KeyU' });
        press(p, { key: 's', code: 'KeyS' });
        press(document.querySelector('#field')!, { key: 'f', code: 'KeyF' });
        press(document.querySelector('#field')!, { key: 'Enter', code: 'Enter', metaKey: true });
        press(document.querySelector('#rich')!, { key: 'r', code: 'KeyR' });
        press(p, { key: 'c', code: 'KeyC', isComposing: true });
        press(p, { key: 'z', code: 'KeyZ' }, { trusted: false });
        press(p, { key: 'Enter', code: 'Enter', metaKey: true }, { trusted: false });
        await settle();
      } finally {
        document.removeEventListener('keydown', used);
        document.removeEventListener('keydown', stopped);
      }
      expect(keysSent()).toEqual([]);
    });

    test('a chord the host claims is taken before the page: used at once, never seen by the page, and sent', async () => {
      page('<p id="p">Text</p>');
      await hostAsks([ENTER, TOGGLE]);
      const p = document.querySelector('#p')!;
      const submit = press(p, { key: 'Enter', code: 'Enter', metaKey: true });
      const toggle = press(p, { key: 'a', code: 'KeyA', metaKey: true, shiftKey: true });
      expect(submit.defaultPrevented).toBe(true);
      expect(toggle.defaultPrevented).toBe(true);
      expect(pageSaw).toEqual([]);
      // With Ctrl held it is no claim (Ctrl+Cmd is the browser's): the page gets it first.
      const withCtrl = press(p, { key: 'Enter', code: 'Enter', metaKey: true, ctrlKey: true });
      expect(withCtrl.defaultPrevented).toBe(false);
      expect(pageSaw).toEqual(['Enter']);
      await settle();
      expect(keysSent()).toEqual(['keydown Meta+Enter', 'keydown Meta+Shift+a', 'keydown Meta+Enter']);
    });

    test('the claims update: a chord no longer claimed goes to the page first, and Escape is claimed while the host asks', async () => {
      page('<p id="p">Text</p>');
      const p = document.querySelector('#p')!;
      await hostAsks([ENTER], true);
      expect(press(p, { key: 'Escape', code: 'Escape' }).defaultPrevented).toBe(true);
      expect(press(p, { key: 'Enter', code: 'Enter', metaKey: true }).defaultPrevented).toBe(true);
      expect(pageSaw).toEqual([]);
      await hostAsks([], false);
      expect(press(p, { key: 'Escape', code: 'Escape' }).defaultPrevented).toBe(false);
      expect(press(p, { key: 'Enter', code: 'Enter', metaKey: true }).defaultPrevented).toBe(false);
      expect(pageSaw).toEqual(['Escape', 'Enter']);
      await settle();
      // Unused by the page, so both still reach the host, after the page.
      expect(keysSent()).toEqual(['keydown Escape', 'keydown Meta+Enter', 'keydown Escape', 'keydown Meta+Enter']);
    });

    test('Cmd+C, X, V and A stay the page\'s, claimed or not; Cmd+Shift+A is a chord of its own', async () => {
      page('<p id="p">Text</p>');
      await hostAsks([{ key: 'C', shift: false, alt: false }, { key: 'A', shift: false, alt: false }, TOGGLE]);
      const p = document.querySelector('#p')!;
      for (const key of ['c', 'x', 'v', 'a']) {
        expect(press(p, { key, code: `Key${key.toUpperCase()}`, metaKey: true }).defaultPrevented).toBe(false);
      }
      expect(press(p, { key: 'a', code: 'KeyA', metaKey: true, shiftKey: true }).defaultPrevented).toBe(true);
      await settle();
      expect(keysSent()).toEqual(['keydown Meta+Shift+a']);
    });
  });
});
