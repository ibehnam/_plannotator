/**
 * HtmlViewer's `frameStorage` and `onPageHistory` (DOM-gated).
 *
 * Failures to catch:
 *  - A page's storage change lost on its way to the host's store, so the
 *    next page starts without it; or one taken from another window, with the
 *    wrong shape, or on the bridgeScriptUrl path (no store offered there),
 *    written into the store.
 *  - The next document built without what the store holds; a store that
 *    cannot be read breaking the document; a change rebuilding the page.
 *  - A page's own Back reaching the host as a window message (any page script
 *    can post one, with no person's press), or with a delta that is not a
 *    step (0, a fraction, past 100).
 *  - A host that passes neither prop getting anything but today's document.
 */
import { afterEach, describe, expect, mock, test } from 'bun:test';
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { HtmlFrameStorage, HtmlFrameStorageWrite } from './HtmlViewer';
import { bridgeLinkPort } from '../../test-setup/bridgeLinkPort';

const hasDom = typeof document !== 'undefined';
const htmlViewerModule = hasDom ? await import('./HtmlViewer') : null;

const mountedRoots: Array<{ unmount: () => void }> = [];

afterEach(async () => {
  if (!hasDom) return;
  await act(async () => {
    for (const root of mountedRoots.splice(0)) root.unmount();
  });
  document.body.replaceChildren();
});

const PAGE = (title: string) => `<html><head><title>${title}</title><script>var headScript = 1;</script></head><body><p>${title}</p></body></html>`;

/** A store that records what it is handed, seeded with ITEMS. */
function recordingStore(items: Array<[string, string]> = []) {
  const writes: HtmlFrameStorageWrite[] = [];
  const local = new Map(items);
  const store: HtmlFrameStorage = {
    limit: 1000,
    perItem: 32,
    read: () => ({ local: [...local], session: [] }),
    write: (change) => {
      writes.push(change);
      if (change.op === 'set' && change.area === 'local') local.set(change.key, change.value);
    },
  };
  return { store, writes };
}

describe.if(hasDom)('HtmlViewer frame host', () => {
  async function mountViewer(props: Record<string, unknown>) {
    const HtmlViewer = htmlViewerModule!.HtmlViewer;
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    mountedRoots.push(root);
    const render = async (next: Record<string, unknown>) => {
      await act(async () => {
        root.render(
          <HtmlViewer
            rawHtml={PAGE('first')}
            annotations={[]}
            onAddAnnotation={() => {}}
            onSelectAnnotation={() => {}}
            selectedAnnotationId={null}
            mode="selection"
            inputMethod="pinpoint"
            {...next}
          />,
        );
      });
    };
    await render(props);
    const iframe = host.querySelector<HTMLIFrameElement>('iframe');
    if (!iframe?.contentWindow) throw new Error('HTML iframe missing');
    const fromFrame = async (data: Record<string, unknown>, source: unknown = iframe.contentWindow) => {
      await act(async () => {
        window.dispatchEvent(new MessageEvent('message', { source: source as Window, data }));
      });
    };
    return { iframe, fromFrame, render };
  }

  test("a change the frame posts reaches the store; another window's, or one of the wrong shape, does not", async () => {
    const { store, writes } = recordingStore();
    const { fromFrame } = await mountViewer({ frameStorage: store });
    await fromFrame({ type: 'plannotator-bridge-storage', area: 'local', op: 'set', key: 'theme', value: 'dark' });
    await fromFrame({ type: 'plannotator-bridge-storage', area: 'session', op: 'remove', key: 'step' });
    await fromFrame({ type: 'plannotator-bridge-storage', area: 'session', op: 'clear' });
    await fromFrame({ type: 'plannotator-bridge-storage', area: 'local', op: 'set', key: 'other', value: 'x' }, window);
    for (const bad of [
      { area: 'cookies', op: 'set', key: 'k', value: 'v' },
      { area: 'local', op: 'set', key: 'k', value: 7 },
      { area: 'local', op: 'set', key: 3, value: 'v' },
      { area: 'local', op: 'drop', key: 'k' },
      { area: 'local', op: 'remove' },
    ]) {
      await fromFrame({ type: 'plannotator-bridge-storage', ...bad });
    }
    expect(writes).toEqual([
      { area: 'local', op: 'set', key: 'theme', value: 'dark' },
      { area: 'session', op: 'remove', key: 'step' },
      { area: 'session', op: 'clear' },
    ]);
  });

  test("the next document starts from what the store holds, ahead of the page's own head script; a change rebuilds no page", async () => {
    const { store } = recordingStore([['md2web.theme', 'light']]);
    const { iframe, fromFrame, render } = await mountViewer({ frameStorage: store });
    const built = iframe.getAttribute('srcdoc');
    await fromFrame({ type: 'plannotator-bridge-storage', area: 'local', op: 'set', key: 'md2web.theme', value: 'dark' });
    expect(iframe.getAttribute('srcdoc')).toBe(built);
    await render({ frameStorage: store, rawHtml: PAGE('second') });
    const srcdoc = iframe.getAttribute('srcdoc')!;
    const offerAt = srcdoc.indexOf('window.__plannotatorFrameHost = ');
    expect(offerAt).toBeGreaterThan(-1);
    expect(srcdoc.slice(offerAt)).toContain('"local":[["md2web.theme","dark"]]');
    expect(srcdoc.slice(offerAt)).toContain('"limit":1000,"perItem":32');
    expect(offerAt).toBeLessThan(srcdoc.indexOf('var headScript'));
  });

  test('a store that cannot be read still gives the page its document, starting from nothing', async () => {
    const store: HtmlFrameStorage = {
      limit: 1000,
      perItem: 32,
      read: () => { throw new Error('storage gone'); },
      write: () => {},
    };
    const { iframe } = await mountViewer({ frameStorage: store });
    expect(iframe.getAttribute('srcdoc')).toContain('"storage":{"local":[],"session":[]');
  });

  test('on the bridgeScriptUrl path no store is offered, and the frame\'s storage messages are dropped', async () => {
    const { store, writes } = recordingStore([['theme', 'dark']]);
    const { iframe, fromFrame } = await mountViewer({ frameStorage: store, bridgeScriptUrl: '/bridge.js' });
    expect(iframe.getAttribute('srcdoc')).not.toContain('__plannotatorFrameHost =');
    await fromFrame({ type: 'plannotator-bridge-storage', area: 'local', op: 'set', key: 'theme', value: 'light' });
    expect(writes).toEqual([]);
  });

  // Any page script can post a window message, with no person's press: a page could step the review at its open,
  // or bounce between two of its entries for ever. A step arrives on the link guard's port, which carries one only
  // for a call made during a person's click in the page.
  test("a page's own history step reaches onPageHistory on the link guard's port only, and as a step only", async () => {
    const onPageHistory = mock((_delta: number) => {});
    const { iframe, fromFrame } = await mountViewer({ onPageHistory });
    expect(iframe.getAttribute('srcdoc')).toContain('window.__plannotatorFrameHost = {"history":true};');
    await fromFrame({ type: 'plannotator-bridge-page-history', delta: -1 });
    const port = await bridgeLinkPort(iframe);
    for (const delta of [-1, 1, -100, 100, 0, 0.5, -101, 101, '1', Number.NaN]) {
      await act(async () => {
        port.postMessage({ type: 'plannotator-bridge-page-history', delta });
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
    }
    expect(onPageHistory.mock.calls.map((c) => c[0])).toEqual([-1, 1, -100, 100]);
  });

  test('with neither prop the document is built as before, with no offer', async () => {
    const { iframe } = await mountViewer({});
    expect(iframe.getAttribute('srcdoc')).not.toContain('__plannotatorFrameHost =');
  });
});
