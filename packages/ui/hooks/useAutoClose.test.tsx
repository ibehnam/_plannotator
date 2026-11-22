/**
 * The done screen's auto-close (DOM-gated): when the page's own window.close()
 * is refused, a host close (the local server, through the browser) is asked, and
 * the screen says why when that fails too.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { resetStorageBackend, setAutoCloseDelay, setStorageBackend } from '../utils/storage';
import { ENDED_HINT, REFUSAL_HINTS, requestServerTabClose } from '../utils/serverTabClose';
import type { HostCloseResult } from './useAutoClose';

const hasDom = typeof document !== 'undefined';
const overlayModule = hasDom ? await import('../components/CompletionOverlay') : null;

describe.if(hasDom)('the done screen closing its tab', () => {
  const memory = new Map<string, string>();
  let root: Root | null = null;
  let host: HTMLDivElement | null = null;
  const realClose = window.close;

  const realFetch = globalThis.fetch;
  afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
    root = null;
    host = null;
    window.close = realClose;
    globalThis.fetch = realFetch;
    delete (window.history as unknown as { length?: number }).length;
    memory.clear();
    resetStorageBackend();
  });

  /** The tab's history, as many entries long as a review that followed links leaves it. */
  function historyOf(entries: number): void {
    Object.defineProperty(window.history, 'length', { configurable: true, get: () => entries });
  }

  const wait = (ms: number) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });

  /** The done screen, its tab refusing window.close() as a tab no script opened does, auto-close at 0 s. */
  async function mountDone(hostClose?: (afterMs: number) => Promise<HostCloseResult>, delay: '0' | '3' | 'off' = '0') {
    if (!overlayModule) throw new Error('DOM test environment is not registered');
    setStorageBackend({
      getItem: (key) => memory.get(key) ?? null,
      setItem: (key, value) => { memory.set(key, value); },
      removeItem: (key) => { memory.delete(key); },
    });
    setAutoCloseDelay(delay);
    let closes = 0;
    window.close = () => { closes += 1; };
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    const { CompletionOverlay } = overlayModule;
    await act(async () => {
      root?.render(
        <CompletionOverlay submitted="done" title="Done" subtitle="Nothing was sent" agentLabel="Claude Code" hostClose={hostClose} />,
      );
    });
    return { closes: () => closes };
  }

  const hint = () => document.querySelector('[data-close-hint]')?.textContent ?? null;

  test('with no host close, a refused window.close() says so, as before', async () => {
    const tab = await mountDone();
    await wait(400);
    expect(tab.closes()).toBe(1);
    expect(hint()).toBe('Auto-close works when the tab is opened by Claude Code.');
  });

  test('a refused window.close() asks the host, and when the host cannot either the screen gives its reason', async () => {
    const asked: number[] = [];
    await mountDone(async () => {
      asked.push(1);
      return { closed: false, hint: 'Allow it under Automation.' };
    });
    await wait(400);
    expect(asked).toHaveLength(1);
    expect(hint()).toBe('Allow it under Automation.');
  });

  test('a host that closed the tab is trusted for two seconds, then a tab still open says it could not close', async () => {
    await mountDone(async () => ({ closed: true }));
    await wait(400);
    expect(hint()).toBeNull();
    await wait(2200);
    expect(hint()).toBe('Auto-close works when the tab is opened by Claude Code.');
  });

  // Chromium and WebKit let a script close only a tab a script opened or one
  // whose history holds a single entry: a review that followed a link leaves
  // two, so the page asks the server at once, for the end of its countdown,
  // while the session is certainly up.
  test('a tab that cannot close itself is closed by the host, asked at once for the end of the countdown', async () => {
    historyOf(2);
    const asked: number[] = [];
    let answer: (result: HostCloseResult) => void = () => {};
    const tab = await mountDone((afterMs) => {
      asked.push(afterMs);
      return new Promise((resolve) => { answer = resolve; });
    }, '3');
    await wait(50);
    expect(asked).toEqual([3000]);
    expect(tab.closes()).toBe(0);
    expect(document.body.textContent).toContain('This tab will close in');
    await act(async () => answer({ closed: false, hint: 'Allow it under Automation.' }));
    expect(hint()).toBe('Allow it under Automation.');
    expect(asked).toEqual([3000]);
  });

  test('a tab that can close itself closes itself, and asks the host nothing first', async () => {
    historyOf(1);
    const asked: number[] = [];
    const tab = await mountDone(async (afterMs) => {
      asked.push(afterMs);
      return { closed: false };
    });
    await wait(50);
    expect(tab.closes()).toBe(1);
    expect(asked).toEqual([]);
  });

  test('turned on once the session was over: the request fails, and the screen says the session had ended', async () => {
    historyOf(2);
    globalThis.fetch = (async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch;
    await mountDone(requestServerTabClose, 'off');
    const optIn = document.querySelector<HTMLInputElement>('input[type="checkbox"]');
    if (!optIn) throw new Error('the auto-close checkbox is missing');
    await act(async () => optIn.click());
    await wait(50);
    expect(hint()).toBe(ENDED_HINT);
  });

  test('a close the browser did not answer in time (macOS asking about Automation) says so', async () => {
    historyOf(2);
    const bodies: unknown[] = [];
    globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return Response.json({ closed: 0, reason: 'timeout', browsers: ['com.brave.Browser'] });
    }) as unknown as typeof fetch;
    await mountDone(requestServerTabClose);
    await wait(50);
    expect(bodies).toEqual([{ afterMs: 0 }]);
    expect(hint()).toBe(REFUSAL_HINTS.timeout);
  });
});
