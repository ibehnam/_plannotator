// Registers happy-dom globals for tests that mount React components (CM6 editor).
// Opt-in via DOM_TESTS=1 so the default `bun test` run keeps its native globals —
// happy-dom's window/fetch globals break server-oriented tests (cookie-proxy, ipc-server).
import { afterEach } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

if (process.env.DOM_TESTS === '1' && typeof document === 'undefined') {
  GlobalRegistrator.register();
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  // One window serves every test of a file, as one tab would serve several
  // sessions: the history entry a test's app left (the annotate app keeps its
  // documents in the tab's history) must not be the next test's to reopen.
  afterEach(() => {
    window.history.replaceState(null, '');
  });
}
