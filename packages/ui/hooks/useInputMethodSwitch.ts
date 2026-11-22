import { useEffect, useRef } from 'react';
import type { InputMethod } from '../types';

const DOUBLE_TAP_WINDOW = 300; // ms — max gap between taps for double-tap
const HOLD_THRESHOLD = 300;    // ms — hold longer than this = temporary switch
/**
 * How long a lone Alt waits before it switches: the other keys of a chord
 * that starts with Alt (a Hyper key, Cmd+Ctrl+Opt+Shift) come within a few
 * milliseconds, and cancel it before anything shows.
 */
const CHORD_GRACE = 40;

/**
 * Alt/Option key to switch between input methods:
 * - Hold Alt: temporarily switch, reverts on release
 * - Double-tap Alt: permanently toggle
 *
 * Only a lone Alt counts: Alt with another modifier held, or with any other
 * key pressed while it is down (Alt+1 for a quick label, a Hyper key that
 * Karabiner makes of Caps Lock), is a chord and switches nothing. The
 * listeners live as long as the component, reading the latest method and
 * callback from refs, so a tap's pending revert outlives renders in between.
 */
export function useInputMethodSwitch(
  inputMethod: InputMethod,
  onChange: (method: InputMethod) => void,
) {
  const inputMethodRef = useRef(inputMethod);
  inputMethodRef.current = inputMethod;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    // pending: Alt is down, not yet switched (CHORD_GRACE); held: switched while
    // Alt is down; tapped: released after a short press, reverting unless Alt
    // comes down again within DOUBLE_TAP_WINDOW.
    let state: 'idle' | 'pending' | 'held' | 'tapped' = 'idle';
    let original: InputMethod = inputMethodRef.current;
    let downAt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const other = (m: InputMethod): InputMethod => (m === 'drag' ? 'pinpoint' : 'drag');

    // A chord: back to where Alt found it, with nothing left pending.
    const cancel = () => {
      clearTimeout(timer);
      if (state === 'held' || state === 'tapped') onChangeRef.current(original);
      state = 'idle';
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Alt') {
        if (state === 'pending' || state === 'held') cancel();
        return;
      }
      if (e.repeat) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey) {
        if (state !== 'idle') cancel();
        return;
      }
      // Don't interfere when user is typing
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) return;
      // Don't interfere when a quick label picker is open (it uses Alt+N shortcuts)
      if (document.querySelector('[data-quick-label-picker]')) return;

      if (state === 'idle') {
        original = inputMethodRef.current;
        downAt = Date.now();
        state = 'pending';
        timer = setTimeout(() => {
          if (state !== 'pending') return;
          state = 'held';
          onChangeRef.current(other(original));
        }, CHORD_GRACE);
      } else if (state === 'tapped') {
        // Second press within window — make it permanent
        clearTimeout(timer);
        state = 'idle';
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key !== 'Alt') return;
      if (state === 'pending') {
        // Released before the switch showed: a quick tap, switched now.
        clearTimeout(timer);
        state = 'held';
        onChangeRef.current(other(original));
      }
      if (state !== 'held') return;
      if (Date.now() - downAt >= HOLD_THRESHOLD) {
        // Long hold — revert immediately
        onChangeRef.current(original);
        state = 'idle';
        return;
      }
      // Short tap — wait for possible second tap
      state = 'tapped';
      timer = setTimeout(() => {
        if (state !== 'tapped') return;
        onChangeRef.current(original);
        state = 'idle';
      }, DOUBLE_TAP_WINDOW);
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      clearTimeout(timer);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);
}
