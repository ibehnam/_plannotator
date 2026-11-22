/**
 * The done screen's auto-close (DOM-gated): when the page's own window.close()
 * is refused, a host close (the local server, through the browser) is asked, and
 * the screen says why when that fails too.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { resetStorageBackend, setAutoCloseDelay, setStorageBackend } from '../utils/storage';
import type { HostCloseResult } from './useAutoClose';

const hasDom = typeof document !== 'undefined';
const overlayModule = hasDom ? await import('../components/CompletionOverlay') : null;

describe.if(hasDom)('the done screen closing its tab', () => {
  const memory = new Map<string, string>();
  let root: Root | null = null;
  let host: HTMLDivElement | null = null;
  const realClose = window.close;

  afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
    root = null;
    host = null;
    window.close = realClose;
    memory.clear();
    resetStorageBackend();
  });

  const wait = (ms: number) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });

  /** The done screen, its tab refusing window.close() as a tab no script opened does, auto-close at 0 s. */
  async function mountDone(hostClose?: () => Promise<HostCloseResult>) {
    if (!overlayModule) throw new Error('DOM test environment is not registered');
    setStorageBackend({
      getItem: (key) => memory.get(key) ?? null,
      setItem: (key, value) => { memory.set(key, value); },
      removeItem: (key) => { memory.delete(key); },
    });
    setAutoCloseDelay('0');
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
});
