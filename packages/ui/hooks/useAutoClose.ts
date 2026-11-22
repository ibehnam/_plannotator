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

/**
 * Whether this tab may close itself: Chromium and WebKit let a script close a
 * tab a script opened, or one whose history holds a single entry. Plannotator
 * opens its tab with `open URL`, and each linked page a review follows adds an
 * entry, so after one followed link the tab cannot.
 */
function canCloseItself(): boolean {
  return window.history.length <= 1 || !!window.opener;
}

/** Whether the page lives in a native window that closes it (Glimpse), not a tab. */
function hasNativeClose(): boolean {
  return typeof (window as GlimpseWindow).glimpse?.close === 'function' || (!!window.parent && window.parent !== window);
}

type HostClose = (afterMs: number) => Promise<HostCloseResult>;

/** The host's answer: the tab closed (trusted for two seconds), or why not. */
function awaitHostClose(request: Promise<HostCloseResult>, onFail: (hint?: string) => void): void {
  request.then(
    (result) => {
      if (!result.closed) onFail(result.hint);
      else setTimeout(() => { if (!window.closed) onFail(); }, 2000);
    },
    () => onFail(),
  );
}

function tryClose(onFail: (hint?: string) => void, hostClose?: HostClose): void {
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
    awaitHostClose(hostClose(0), onFail);
  }, 300);
}

/**
 * Manages the auto-close countdown that runs after a submission overlay appears.
 *
 * @param active - pass `true` once the overlay should appear (i.e. form was submitted)
 */
export function useAutoClose(active: boolean, hostClose?: HostClose): UseAutoCloseReturn {
  const [state, setState] = useState<AutoClosePhase>({ phase: 'idle' });
  const hostCloseRef = useRef(hostClose);
  hostCloseRef.current = hostClose;
  const fail = useCallback((hint?: string) => setState({ phase: 'closeFailed', hint }), []);
  // Whether the host closes the tab at the countdown's end (asked as it began).
  const hostClosesRef = useRef(false);

  // A tab that cannot close itself is closed by the host when the countdown of
  // AFTER_MS ends, asked now, while the session is certainly up: a server ends
  // a moment after the decision, unless it holds a close. False when the tab
  // closes itself (or there is no host), as before.
  const askHost = useCallback((afterMs: number): boolean => {
    const host = hostCloseRef.current;
    if (!host || hasNativeClose() || canCloseItself()) return false;
    awaitHostClose(host(afterMs), fail);
    return true;
  }, [fail]);

  // On activation, read persisted delay and transition to the right phase.
  useEffect(() => {
    if (!active) return;

    const delay = getAutoCloseDelay();
    if (delay === '0') {
      if (!askHost(0)) tryClose(fail, hostCloseRef.current);
      setState({ phase: 'closed' });
    } else if (delay !== 'off') {
      hostClosesRef.current = askHost(Number(delay) * 1000);
      setState({ phase: 'counting', remaining: Number(delay) });
    } else {
      setState({ phase: 'prompt' });
    }
  }, [active, askHost, fail]);

  // Tick the countdown once per second.
  useEffect(() => {
    if (state.phase !== 'counting') return;
    if (state.remaining <= 0) {
      if (!hostClosesRef.current) tryClose(fail, hostCloseRef.current);
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
    hostClosesRef.current = askHost(3000);
    setState({ phase: 'counting', remaining: 3 });
  }, [askHost]);

  return { state, enableAndStart };
}
