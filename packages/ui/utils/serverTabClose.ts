import type { HostCloseResult } from '../hooks/useAutoClose';

/** The done screen's line for each reason the server gave for closing no tab (packages/server/close-tab.ts). */
export const REFUSAL_HINTS: Record<string, string> = {
  'not-authorized':
    'macOS did not let Plannotator control your browser: allow it under System Settings › Privacy & Security › Automation, and the next tab closes itself.',
  'no-browser': 'Plannotator closes its tab from outside the page in Brave, Chrome, Edge, Arc, Vivaldi or Safari.',
  remote: 'This session runs on another machine than your browser, so only the browser can close its tab.',
  platform: 'Plannotator closes its tab from outside the page on macOS only.',
  failed: "Your browser did not carry out Plannotator's request to close the tab.",
  timeout:
    'macOS is asking whether Plannotator may control your browser: allow it under System Settings › Privacy & Security › Automation, and the next tab closes itself.',
};

/**
 * The done screen's line when the tab stayed open and nobody said why: the
 * browser's own rule. It names no agent: Plannotator is not one agent's tool,
 * nor only agents'.
 */
export const BROWSER_KEPT_TAB_HINT =
  'Your browser lets a page close only a tab that a script opened, or one still on its first page.';

/** The done screen's line when the request found no session: auto-close was turned on after the session ended. */
export const ENDED_HINT =
  'This session had already ended, so Plannotator could not close its tab. With auto-close on before you finish, the tab closes itself.';

/**
 * Ask the local server to close this session's tab (POST /api/close-tab) once
 * AFTER_MS have passed: the done screen's host close for every app the server
 * serves, for a tab that cannot close itself. The server holds the request for
 * that long, closes the tab and answers; a request that finds no server (the
 * session had ended) says so.
 */
export async function requestServerTabClose(afterMs = 0): Promise<HostCloseResult> {
  let response: Response;
  try {
    response = await fetch('/api/close-tab', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ afterMs }),
    });
  } catch {
    return { closed: false, hint: ENDED_HINT };
  }
  try {
    if (!response.ok) return { closed: false };
    const body = (await response.json()) as { closed?: unknown; reason?: unknown };
    if (typeof body.closed === 'number' && body.closed > 0) return { closed: true };
    return { closed: false, hint: typeof body.reason === 'string' ? REFUSAL_HINTS[body.reason] : undefined };
  } catch {
    return { closed: false };
  }
}
