/**
 * The Alt keys' switch between Select and Pinpoint (DOM-gated): held, the
 * other method until release; tapped twice, the other method for good. Only a
 * lone Alt counts: Alt in a chord (a Hyper key, Cmd+Ctrl+Opt held and Escape
 * tapped alone, that Karabiner makes of Caps Lock; Alt+1 for a quick label)
 * never switches, in whatever order the chord's keys arrive. A tap's revert
 * outlives the component's renders in between.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import React, { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { InputMethod } from '../types';
import { useInputMethodSwitch } from './useInputMethodSwitch';

const hasDom = typeof document !== 'undefined';

describe.if(hasDom)('useInputMethodSwitch', () => {
  let root: Root | null = null;
  let host: HTMLDivElement | null = null;
  /** Every method the hook asked for, in order. */
  let changes: InputMethod[] = [];
  let shown: () => InputMethod = () => 'drag';
  let rerender: () => void = () => {};

  function Harness() {
    const [method, setMethod] = useState<InputMethod>('drag');
    const [, setTick] = useState(0);
    shown = () => method;
    rerender = () => setTick((n) => n + 1);
    // A new callback every render, as the app passes one.
    useInputMethodSwitch(method, (next) => {
      changes.push(next);
      setMethod(next);
    });
    return null;
  }

  async function mount(): Promise<void> {
    changes = [];
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root?.render(<Harness />));
  }

  afterEach(async () => {
    if (root) await act(async () => root?.unmount());
    root = null;
    host?.remove();
    host = null;
  });

  const wait = (ms: number) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });

  /** A key going down or up, with the modifiers held at that moment. */
  async function key(type: 'keydown' | 'keyup', name: string, held: KeyboardEventInit = {}): Promise<void> {
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent(type, { key: name, bubbles: true, cancelable: true, ...held }));
    });
  }

  test('Alt held alone switches to the other method, and its release switches back', async () => {
    await mount();
    await key('keydown', 'Alt', { altKey: true });
    await wait(120);
    expect(shown()).toBe('pinpoint');
    await wait(300);
    await key('keyup', 'Alt');
    expect(shown()).toBe('drag');
  });

  test('Alt tapped twice switches for good', async () => {
    await mount();
    await key('keydown', 'Alt', { altKey: true });
    await wait(80);
    await key('keyup', 'Alt');
    await wait(60);
    await key('keydown', 'Alt', { altKey: true });
    await wait(40);
    await key('keyup', 'Alt');
    await wait(450);
    expect(shown()).toBe('pinpoint');
  });

  test('a single tap reverts, even when the component renders in between', async () => {
    await mount();
    await key('keydown', 'Alt', { altKey: true });
    await wait(80);
    await key('keyup', 'Alt');
    await act(async () => rerender());
    await wait(450);
    expect(shown()).toBe('drag');
  });

  test('Alt in a Hyper chord never switches, its modifiers in either order', async () => {
    await mount();
    // Karabiner's Hyper here: Caps Lock is left_command with left_control and
    // left_option held, and Escape when tapped alone. The modifiers first,
    // then Cmd; released, then Escape.
    await key('keydown', 'Control', { ctrlKey: true });
    await key('keydown', 'Alt', { ctrlKey: true, altKey: true });
    await key('keydown', 'Meta', { ctrlKey: true, altKey: true, metaKey: true });
    await key('keyup', 'Meta', { ctrlKey: true, altKey: true });
    await key('keyup', 'Alt', { ctrlKey: true });
    await key('keyup', 'Control');
    await key('keydown', 'Escape');
    await key('keyup', 'Escape');
    // Alt first, with nothing else held yet: the rest follows within a moment.
    await key('keydown', 'Alt', { altKey: true });
    await key('keydown', 'Control', { altKey: true, ctrlKey: true });
    await key('keydown', 'Meta', { altKey: true, ctrlKey: true, metaKey: true });
    await key('keyup', 'Meta', { altKey: true, ctrlKey: true });
    await key('keyup', 'Control', { altKey: true });
    await key('keyup', 'Alt');
    await key('keydown', 'Escape');
    await key('keyup', 'Escape');
    await wait(450);
    expect(changes).toEqual([]);
    expect(shown()).toBe('drag');
  });

  test('Alt with another key (Alt+1, a quick label) never switches', async () => {
    await mount();
    await key('keydown', 'Alt', { altKey: true });
    await key('keydown', '1', { altKey: true, code: 'Digit1' } as KeyboardEventInit);
    await key('keyup', '1', { altKey: true });
    await wait(120);
    await key('keyup', 'Alt');
    await wait(450);
    expect(changes).toEqual([]);
  });
});
