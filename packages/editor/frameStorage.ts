/**
 * Where the review's pages keep their `localStorage` and `sessionStorage`
 * (HtmlViewer's `frameStorage`): the review tab's own sessionStorage.
 *
 * A page in the viewer's frame has no storage of its own (an opaque origin),
 * so each load of it started from nothing and a page that remembers a choice
 * (md2web's theme) forgot it on every link. The tab's sessionStorage lasts
 * exactly as long as the review should keep it: this tab, through its
 * reloads, gone with it; nothing reaches the disk.
 *
 * One key an item, `plannotator.frame.local:<key>` and
 * `plannotator.frame.session:<key>`, so there is no copy in memory to keep in
 * step. All page items together are held to {@link FRAME_STORAGE_LIMIT}
 * UTF-16 code units, each item counted as its key, its value and
 * {@link FRAME_STORAGE_PER_ITEM} (its stored name's prefix and the browser's
 * keeping of it), well under the tab's quota, so a page that stores megabytes,
 * or a great many small items, cannot starve the app's own writes there; a
 * change past it, or one the browser refuses, is not kept (the page keeps it
 * for its own load). The total is kept in memory, so a write costs the same
 * however many items there are. Keys of any other owner are never read or
 * removed.
 */

import type { HtmlFrameStorage, HtmlFrameStorageSeed, HtmlFrameStorageWrite } from '@plannotator/ui/components/html-viewer/HtmlViewer';

/** The most all page items may hold together, in UTF-16 code units. */
export const FRAME_STORAGE_LIMIT = 1_000_000;

/** What one item costs besides its key and value: its name's prefix (at most 26 units) and the rest. */
export const FRAME_STORAGE_PER_ITEM = 32;

const PREFIX = {
  local: 'plannotator.frame.local:',
  session: 'plannotator.frame.session:',
} as const;

type Area = keyof typeof PREFIX;

/** Every page item STORE holds: its area, its key and its stored name. */
function pageItems(store: Storage): Array<{ area: Area; key: string; name: string }> {
  const items: Array<{ area: Area; key: string; name: string }> = [];
  for (let i = 0; i < store.length; i += 1) {
    const name = store.key(i);
    if (name === null) continue;
    for (const area of ['local', 'session'] as const) {
      if (name.startsWith(PREFIX[area])) items.push({ area, key: name.slice(PREFIX[area].length), name });
    }
  }
  return items;
}

/**
 * The review's frame store over STORE (the tab's sessionStorage by default),
 * or undefined when the tab has none to give (storage turned off).
 */
export function createFrameStorage(
  store?: Storage,
  limit: number = FRAME_STORAGE_LIMIT,
  perItem: number = FRAME_STORAGE_PER_ITEM,
): HtmlFrameStorage | undefined {
  let tab: Storage;
  try {
    tab = store ?? window.sessionStorage;
    void tab.length;
  } catch {
    return undefined;
  }
  let warned = false;
  const notKept = (reason: string) => {
    if (warned) return;
    warned = true;
    console.warn(`Plannotator: a page's storage was not kept for the review (${reason}); the page keeps it until it is left.`);
  };
  const cost = (key: string, value: string) => key.length + value.length + perItem;
  // What each area holds, item by item, and what they hold together, as of the
  // last read and every change since: a write touches only its own keys.
  const kept: Record<Area, Map<string, number>> = { local: new Map(), session: new Map() };
  let held = 0;
  const read = (): HtmlFrameStorageSeed => {
    const seed: HtmlFrameStorageSeed = { local: [], session: [] };
    kept.local.clear();
    kept.session.clear();
    held = 0;
    for (const { area, key, name } of pageItems(tab)) {
      const value = tab.getItem(name);
      if (value === null) continue;
      seed[area].push([key, value]);
      kept[area].set(key, cost(key, value));
      held += cost(key, value);
    }
    return seed;
  };
  try {
    read();
  } catch {
    return undefined;
  }

  return {
    limit,
    perItem,
    read,
    write(change: HtmlFrameStorageWrite): void {
      const items = kept[change.area];
      try {
        if (change.op === 'clear') {
          for (const [key, size] of items) {
            tab.removeItem(PREFIX[change.area] + key);
            held -= size;
          }
          items.clear();
          return;
        }
        const name = PREFIX[change.area] + change.key;
        const was = items.get(change.key) ?? 0;
        if (change.op === 'remove') {
          tab.removeItem(name);
          items.delete(change.key);
          held -= was;
          return;
        }
        const size = cost(change.key, change.value);
        if (held - was + size > limit) {
          notKept(`over ${limit} characters`);
          return;
        }
        tab.setItem(name, change.value);
        items.set(change.key, size);
        held += size - was;
      } catch (error) {
        // QuotaExceededError, or storage gone since: the change stays with its load.
        notKept(error instanceof Error ? error.name : 'refused');
      }
    },
  };
}
