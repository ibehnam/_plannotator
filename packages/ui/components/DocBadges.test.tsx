import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { resetStorageBackend, setStorageBackend } from '../utils/storage';
import { DocBadges, type DocBadgesProps } from './DocBadges';

const hasDom = typeof document !== 'undefined';

const originalFetch = globalThis.fetch;
let host: HTMLElement | null = null;
let root: Root | null = null;

function exactText(text: string): HTMLElement {
  const match = Array.from(host?.querySelectorAll<HTMLElement>('span') ?? [])
    .find((element) => element.textContent === text);
  if (!match) throw new Error(`Expected to find text: ${text}`);
  return match;
}

function openInButton(): HTMLButtonElement {
  const button = host?.querySelector<HTMLButtonElement>('button[aria-label="Open in Finder"]');
  if (!button) throw new Error('Expected the Finder open-in button to render');
  return button;
}

function appearsBefore(first: Node, second: Node): boolean {
  return (first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

async function renderBadges(props: Partial<DocBadgesProps>): Promise<void> {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);

  await act(async () => {
    root!.render(<DocBadges layout="column" {...props} />);
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('DocBadges open-in placement', () => {
  beforeEach(() => {
    setStorageBackend({
      getItem: () => 'reveal',
      setItem: () => {},
      removeItem: () => {},
    });
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      writable: true,
      value: async () => Response.json({
        available: true,
        apps: [{ id: 'reveal', label: 'Finder', kind: 'file-manager', icon: 'finder' }],
      }),
    });
  });

  afterEach(async () => {
    if (root) await act(async () => root!.unmount());
    root = null;
    host?.remove();
    host = null;
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      writable: true,
      value: originalFetch,
    });
    resetStorageBackend();
  });

  test.skipIf(!hasDom)('places the selector after the repository and branch for a local annotate file', async () => {
    await renderBadges({
      repoInfo: { display: 'plannotator/workspaces', branch: 'rooms/resurrect' },
      openInAppPath: '/tmp/runbook.md',
    });

    const repository = exactText('plannotator/workspaces');
    const branch = exactText('rooms/resurrect');
    const button = openInButton();
    // The repository and branch share a box of their own, so the branch can give way first.
    const repositoryRow = repository.parentElement?.parentElement;

    expect(repositoryRow).not.toBeNull();
    expect(repositoryRow?.contains(branch)).toBe(true);
    expect(repositoryRow?.contains(button)).toBe(true);
    expect(appearsBefore(repository, branch)).toBe(true);
    expect(appearsBefore(branch, button)).toBe(true);
  });

  test.skipIf(!hasDom)('does not add a selector in plan mode', async () => {
    await renderBadges({
      repoInfo: { display: 'plannotator/workspaces', branch: 'rooms/resurrect' },
      openInAppPath: null,
    });

    expect(exactText('plannotator/workspaces')).toBeInstanceOf(HTMLElement);
    expect(host?.querySelector('button[aria-label="Open in Finder"]')).toBeNull();
  });

  test.skipIf(!hasDom)('keeps the selector after an explicit source filename', async () => {
    await renderBadges({
      repoInfo: { display: 'plannotator/workspaces', branch: 'rooms/resurrect' },
      sourceInfo: 'runbook.html',
      openInAppPath: '/tmp/runbook.html',
    });

    const source = exactText('runbook.html');
    const button = openInButton();

    expect(source.parentElement?.contains(button)).toBe(true);
    expect(appearsBefore(source, button)).toBe(true);
    expect(host?.querySelectorAll('button[aria-label="Open in Finder"]')).toHaveLength(1);
  });

  test.skipIf(!hasDom)('keeps a standalone selector when no repository or file row exists', async () => {
    await renderBadges({ openInAppPath: '/tmp/runbook.md' });

    expect(openInButton()).toBeInstanceOf(HTMLButtonElement);
  });

  test.skipIf(!hasDom)('does not add a selector for a URL annotation', async () => {
    await renderBadges({
      sourceInfo: 'https://example.com/runbook',
      openInAppPath: 'https://example.com/runbook',
    });

    expect(exactText('example.com')).toBeInstanceOf(HTMLElement);
    expect(host?.querySelector('button[aria-label="Open in Finder"]')).toBeNull();
  });

  test.skipIf(!hasDom)('labels the diff badge with its baseline in annotate/folder sessions', async () => {
    await renderBadges({
      planDiffStats: { additions: 3, deletions: 1, modifications: 0 },
      hasPreviousVersion: true,
      onPlanDiffToggle: () => {},
      planDiffBaselineLabel: 'since last review',
      planDiffBaselineTooltip: 'Changes since you last reviewed this file',
    });

    const badge = Array.from(host?.querySelectorAll<HTMLButtonElement>('button') ?? [])
      .find((button) => button.textContent?.includes('+3'));
    if (!badge) throw new Error('Expected the diff badge to render');
    expect(badge.textContent).toContain('since last review');
    expect(badge.title).toBe('Changes since you last reviewed this file');
  });

  test.skipIf(!hasDom)('plan review diff badge renders exactly as before when no baseline label is passed', async () => {
    await renderBadges({
      planDiffStats: { additions: 3, deletions: 1, modifications: 0 },
      hasPreviousVersion: true,
      onPlanDiffToggle: () => {},
    });

    const badge = Array.from(host?.querySelectorAll<HTMLButtonElement>('button') ?? [])
      .find((button) => button.textContent?.includes('+3'));
    if (!badge) throw new Error('Expected the diff badge to render');
    expect(badge.textContent).toBe('+3/-1');
    expect(badge.title).toBe('Show what changed from previous version');
  });

  test.skipIf(!hasDom)('keeps folder-file selectors after the active filename', async () => {
    await renderBadges({
      linkedDocInfo: {
        filepath: '/tmp/docs/runbook.md',
        onBack: () => {},
        variant: 'folder-file',
      },
      openInAppPath: '/tmp/docs/runbook.md',
    });

    const filename = exactText('runbook.md');
    const button = openInButton();

    expect(filename.parentElement?.contains(button)).toBe(true);
    expect(appearsBefore(filename, button)).toBe(true);
  });

  test.skipIf(!hasDom)('names a folder file by its file name when the path is a Windows path', async () => {
    const filepath = 'L:\\repos.ws\\workflows.ws\\openspec\\changes\\v3-initiative\\proposal.md';
    await renderBadges({
      linkedDocInfo: { filepath, onBack: () => {}, variant: 'folder-file' },
    });

    expect(exactText('proposal.md').title).toBe(filepath);
  });

  test.skipIf(!hasDom)('names a linked document by its file name when the path is a Windows path', async () => {
    const filepath = 'C:\\Users\\dev\\payments\\docs\\refunds.md';
    await renderBadges({
      linkedDocInfo: { filepath, onBack: () => {}, variant: 'breadcrumb' },
    });

    expect(exactText('refunds.md').title).toBe(filepath);
  });

  // Back and Forward through the review's history beside the root jump: "Back to file" alone sent the reader to the
  // root from any depth, and named the root "file".
  test.skipIf(!hasDom)('Back and Forward are named after their pages, each only when it leads somewhere', async () => {
    const steps: string[] = [];
    await renderBadges({
      linkedDocInfo: {
        filepath: '/site/third.md',
        onBack: () => steps.push('root'),
        backLabel: 'index.md',
        variant: 'breadcrumb',
        steps: { back: { name: 'second.md', go: () => steps.push('back') }, forward: { name: 'fourth.md', go: () => steps.push('forward') } },
      },
    });
    const back = host!.querySelector<HTMLButtonElement>('[data-history-back]')!;
    const forward = host!.querySelector<HTMLButtonElement>('[data-history-forward]')!;
    const rootJump = host!.querySelector<HTMLButtonElement>('[data-root-jump]')!;
    expect(back.getAttribute('aria-label')).toBe('Back to second.md');
    expect(back.textContent).toBe('second.md');
    expect(forward.getAttribute('aria-label')).toBe('Forward to fourth.md');
    expect(rootJump.textContent).toBe('index.md');
    expect(appearsBefore(back, forward) && appearsBefore(forward, rootJump)).toBe(true);
    await act(async () => { back.click(); forward.click(); rootJump.click(); });
    expect(steps).toEqual(['back', 'forward', 'root']);
    await act(async () => root!.unmount());
    host?.remove();
    await renderBadges({
      linkedDocInfo: { filepath: '/site/second.md', onBack: () => {}, backLabel: 'index.md', variant: 'breadcrumb', steps: { back: null, forward: null } },
    });
    expect(host!.querySelector('[data-history-back]')).toBeNull();
    expect(host!.querySelector('[data-history-forward]')).toBeNull();
    expect(host!.querySelector('[data-root-jump]')!.textContent).toBe('index.md');
  });

  test.skipIf(!hasDom)('without steps (no history) the breadcrumb is as before: a Back arrow to the root', async () => {
    await renderBadges({
      linkedDocInfo: { filepath: '/site/second.md', onBack: () => {}, backLabel: 'index.md', variant: 'breadcrumb' },
    });
    expect(host!.querySelector('[data-history-back], [data-history-forward], [data-root-jump]')).toBeNull();
    const button = host!.querySelector<HTMLButtonElement>('button')!;
    expect(button.textContent).toBe('index.md');
    expect(button.querySelector('path')!.getAttribute('d')).toBe('M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18');
  });
});
