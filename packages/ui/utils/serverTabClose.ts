import type { HostCloseResult } from '../hooks/useAutoClose';

/** The done screen's line for each reason the server gave for closing no tab (packages/server/close-tab.ts). */
const REFUSAL_HINTS: Record<string, string> = {
  'not-authorized':
    'macOS did not let Plannotator control your browser: allow it under System Settings › Privacy & Security › Automation, and the next tab closes itself.',
  'no-browser': 'Plannotator closes its tab from outside the page in Brave, Chrome, Edge, Arc, Vivaldi or Safari.',
  remote: 'This session runs on another machine than your browser, so only the browser can close its tab.',
  platform: 'Plannotator closes its tab from outside the page on macOS only.',
  failed: "Your browser did not carry out Plannotator's request to close the tab.",
};

/**
 * Ask the local server to close this session's tab (POST /api/close-tab), after
 * the page's own `window.close()` was refused: the done screen's host close for
 * every app the server serves.
 */
export async function requestServerTabClose(): Promise<HostCloseResult> {
  try {
    const response = await fetch('/api/close-tab', { method: 'POST' });
    if (!response.ok) return { closed: false };
    const body = (await response.json()) as { closed?: unknown; reason?: unknown };
    if (typeof body.closed === 'number' && body.closed > 0) return { closed: true };
    return { closed: false, hint: typeof body.reason === 'string' ? REFUSAL_HINTS[body.reason] : undefined };
  } catch {
    return { closed: false };
  }
}
