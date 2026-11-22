import { useState, useEffect, useCallback, useRef } from 'react';
import { getAutoCloseDelay, setAutoCloseDelay } from '../utils/storage';

/**
 * Phases of the auto-close lifecycle after a form submission.
 *
 * - idle:        nothing submitted yet
 * - counting:    countdown is ticking (seconds remaining in `remaining`)
 * - prompt:      auto-close is disabled; offer the user a checkbox to opt in
 * - closed:      window.close() succeeded (terminal state)
 * - closeFailed: window.close() was blocked by the browser
 */
type AutoClosePhase =
  | { phase: 'idle' }
  | { phase: 'counting'; remaining: number }
  | { phase: 'prompt' }
  | { phase: 'closed' }
  | { phase: 'closeFailed'; hint?: string };

/**
 * What a host that can close the tab itself answered (the local server, through
 * the browser: packages/server/close-tab.ts): whether it closed it, and when not,
 * a line for the done screen on why.
 */
export interface HostCloseResult {
  closed: boolean;
  hint?: string;
}

interface UseAutoCloseReturn {
  state: AutoClosePhase;
  /** User opted in via the checkbox — persist "3s" and start countdown. */
  enableAndStart: () => void;
}

type GlimpseWindow = Window & {
  glimpse?: {
    close?: () => void;
  };
};

function requestGlimpseClose(): boolean {
  const glimpseClose = (window as GlimpseWindow).glimpse?.close;
  if (typeof glimpseClose === 'function') {
    glimpseClose();
    return true;
  }

  if (window.parent && window.parent !== window) {
    window.parent.postMessage({ __plannotator_glimpse_close: true }, '*');
    return true;
  }

  return false;
}

function tryClose(onFail: (hint?: string) => void, hostClose?: () => Promise<HostCloseResult>): void {
  const requestedNativeClose = requestGlimpseClose();
  if (requestedNativeClose) {
    return;
  }

  window.close();
  // window.close() is silently ignored when the tab wasn't opened by script and
  // its history holds more than one entry (a review that followed a link).
  // Check after a short delay whether we're still alive; then a host that can
  // close the tab itself is asked, and given two seconds to have done it.
  setTimeout(() => {
    if (window.closed) return;
    if (!hostClose) {
      onFail();
      return;
    }
    hostClose().then(
      (result) => {
        if (!result.closed) onFail(result.hint);
        else setTimeout(() => { if (!window.closed) onFail(); }, 2000);
      },
      () => onFail(),
    );
  }, 300);
}

/**
 * Manages the auto-close countdown that runs after a submission overlay appears.
 *
 * @param active - pass `true` once the overlay should appear (i.e. form was submitted)
 */
export function useAutoClose(active: boolean, hostClose?: () => Promise<HostCloseResult>): UseAutoCloseReturn {
  const [state, setState] = useState<AutoClosePhase>({ phase: 'idle' });
  const hostCloseRef = useRef(hostClose);
  hostCloseRef.current = hostClose;
  const fail = useCallback((hint?: string) => setState({ phase: 'closeFailed', hint }), []);

  // On activation, read persisted delay and transition to the right phase.
  useEffect(() => {
    if (!active) return;

    const delay = getAutoCloseDelay();
    if (delay === '0') {
      tryClose(fail, hostCloseRef.current);
      setState({ phase: 'closed' });
    } else if (delay !== 'off') {
      setState({ phase: 'counting', remaining: Number(delay) });
    } else {
      setState({ phase: 'prompt' });
    }
  }, [active, fail]);

  // Tick the countdown once per second.
  useEffect(() => {
    if (state.phase !== 'counting') return;
    if (state.remaining <= 0) {
      tryClose(fail, hostCloseRef.current);
      return;
    }
    const timer = setTimeout(
      () => setState((prev) => (prev.phase === 'counting' ? { phase: 'counting', remaining: prev.remaining - 1 } : prev)),
      1000,
    );
    return () => clearTimeout(timer);
  }, [state, fail]);

  const enableAndStart = useCallback(() => {
    setAutoCloseDelay('3');
    setState({ phase: 'counting', remaining: 3 });
  }, []);

  return { state, enableAndStart };
}
