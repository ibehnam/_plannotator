/**
 * HtmlViewer `onPagePlace` and `initialPlace` (DOM-gated): a host's history
 * keeps where the reader was in an HTML page (the page scrolls inside its
 * frame, where the host cannot measure it) and gives it back on a step back
 * or forward to that page.
 *
 * Guards: a viewer with `onPagePlace` asks the bridge for its place once the
 * page is ready, and one without asks nothing; the bridge's report reaches
 * `onPagePlace`, and a forged, malformed or out-of-range one never does. An
 * `initialPlace` is given to the page once its bridge is ready, never before,
 * and wins over `initialFragment`; a new one is given to the page on screen;
 * with none, the fragment is replayed as before.
 */
import { afterEach, describe, expect, mock, test } from 'bun:test';
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { BRIDGE_PROTOCOL_VERSION } from './bridge-script';
import type { HtmlPagePlace } from './useHtmlAnnotation';

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

interface Props {
  onPagePlace?: (place: HtmlPagePlace) => void;
  initialPlace?: HtmlPagePlace;
  initialFragment?: string;
}

async function mount(props: Props = {}) {
  if (!htmlViewerModule) throw new Error('DOM test environment is not registered');
  const HtmlViewer = htmlViewerModule.HtmlViewer;
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  mountedRoots.push(root);
  const render = async (next: Props) => {
    await act(async () => {
      root.render(
        <HtmlViewer
          rawHtml="<html><body><p>A long page</p></body></html>"
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
  const sent: Record<string, unknown>[] = [];
  const win = iframe.contentWindow as Window;
  win.postMessage = ((msg: Record<string, unknown>) => {
    sent.push(msg);
  }) as typeof win.postMessage;
  const post = async (data: Record<string, unknown>, source: Window | null = iframe.contentWindow) => {
    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', { source, data }));
    });
  };
  return { post, sent, render };
}

const ready = { type: 'plannotator-bridge-ready', protocolVersion: BRIDGE_PROTOCOL_VERSION };
const ofType = (sent: Record<string, unknown>[], type: string) => sent.filter((m) => m.type === `plannotator-bridge-${type}`);

describe.if(hasDom)('the page reports where the reader is', () => {
  test("the bridge's report reaches onPagePlace; a forged, malformed or out-of-range one never does", async () => {
    const onPagePlace = mock((_place: HtmlPagePlace) => {});
    const { post, sent } = await mount({ onPagePlace });
    await post(ready);
    expect(ofType(sent, 'set-page-reports').at(-1)).toMatchObject({ place: true });

    await post({ type: 'plannotator-bridge-page-place', top: 4200, height: 31_000, width: 1000 });
    expect(onPagePlace.mock.calls).toEqual([[{ top: 4200, height: 31_000, width: 1000 }]]);

    for (const bad of [
      { top: -1, height: 31_000, width: 1000 },
      { top: '4200', height: 31_000, width: 1000 },
      { top: Number.POSITIVE_INFINITY, height: 31_000, width: 1000 },
      { top: 4200, height: 200_000_000, width: 1000 },
      { top: 4200, width: 1000 },
    ]) {
      await post({ type: 'plannotator-bridge-page-place', ...bad });
    }
    await post({ type: 'plannotator-bridge-page-place', top: 1, height: 2, width: 3 }, window);
    expect(onPagePlace).toHaveBeenCalledTimes(1);
  });

  test('a viewer without onPagePlace asks the bridge for no place', async () => {
    const { post, sent } = await mount();
    await post(ready);
    expect(ofType(sent, 'set-page-reports').filter((m) => m.place === true)).toEqual([]);
  });
});

describe.if(hasDom)('a place given back', () => {
  const place = { top: 5400, height: 31_000, width: 1000 };

  test('initialPlace reaches the page once its bridge is ready, and wins over initialFragment', async () => {
    const { post, sent } = await mount({ initialPlace: place, initialFragment: 'd-fig3' });
    expect(ofType(sent, 'restore-place')).toEqual([]);
    await post(ready);
    expect(ofType(sent, 'restore-place')).toEqual([{ type: 'plannotator-bridge-restore-place', ...place }]);
    expect(ofType(sent, 'scroll-to-fragment')).toEqual([]);
  });

  test('a new place is given to the page on screen; with none, the fragment is replayed as before', async () => {
    const { post, sent, render } = await mount({ initialFragment: 'd-fig3' });
    await post(ready);
    expect(ofType(sent, 'scroll-to-fragment')).toEqual([{ type: 'plannotator-bridge-scroll-to-fragment', fragment: 'd-fig3' }]);
    await render({ initialFragment: 'd-fig3', initialPlace: place });
    expect(ofType(sent, 'restore-place')).toEqual([{ type: 'plannotator-bridge-restore-place', ...place }]);
    // The place going away replays no fragment over where the reader is.
    await render({ initialFragment: 'd-fig3' });
    expect(ofType(sent, 'scroll-to-fragment')).toHaveLength(1);
  });
});
