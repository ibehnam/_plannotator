/**
 * The review's store for its pages' storage (frameStorage.ts).
 *
 * Failures to catch:
 *  - A page's change missing from the next page's seed (md2web's theme lost
 *    on every link, the reason the store exists).
 *  - `clear` on one storage emptying the other, or removing a key the app or
 *    anyone else keeps in the same sessionStorage.
 *  - A page that stores megabytes filling the tab's sessionStorage (the app
 *    writes there too), or a refusal (the limit, the quota) thrown into the
 *    viewer's message handler.
 */
import { describe, expect, test } from 'bun:test';
import { createFrameStorage, FRAME_STORAGE_LIMIT, FRAME_STORAGE_PER_ITEM } from './frameStorage';

/** sessionStorage as a browser keeps it, with an optional quota in characters. */
class MemoryStorage implements Storage {
  private items = new Map<string, string>();
  constructor(private quota = Infinity) {}
  get length(): number { return this.items.size; }
  key(index: number): string | null { return [...this.items.keys()][index] ?? null; }
  getItem(key: string): string | null { return this.items.get(key) ?? null; }
  setItem(key: string, value: string): void {
    let used = key.length + value.length;
    for (const [k, v] of this.items) if (k !== key) used += k.length + v.length;
    if (used > this.quota) throw Object.assign(new Error('The quota has been exceeded.'), { name: 'QuotaExceededError' });
    this.items.set(key, value);
  }
  removeItem(key: string): void { this.items.delete(key); }
  clear(): void { this.items.clear(); }
  [name: string]: unknown;
}

describe('createFrameStorage', () => {
  test("a page's change is in the next page's seed, under its own storage", () => {
    const tab = new MemoryStorage();
    const store = createFrameStorage(tab)!;
    store.write({ area: 'local', op: 'set', key: 'md2web.theme.preference.v1', value: 'dark' });
    store.write({ area: 'session', op: 'set', key: 'tab', value: 'states' });
    expect(store.read()).toEqual({ local: [['md2web.theme.preference.v1', 'dark']], session: [['tab', 'states']] });
    store.write({ area: 'local', op: 'remove', key: 'md2web.theme.preference.v1' });
    expect(store.read()).toEqual({ local: [], session: [['tab', 'states']] });
    // A second store over the same tab (a reload of the review) reads the same items.
    expect(createFrameStorage(tab)!.read()).toEqual({ local: [], session: [['tab', 'states']] });
  });

  test("clear empties its own storage only, and never touches another owner's keys", () => {
    const tab = new MemoryStorage();
    tab.setItem('plannotator-own-key', 'kept');
    tab.setItem('theme', 'kept too');
    const store = createFrameStorage(tab)!;
    store.write({ area: 'local', op: 'set', key: 'a', value: '1' });
    store.write({ area: 'session', op: 'set', key: 'b', value: '2' });
    store.write({ area: 'local', op: 'clear' });
    expect(store.read()).toEqual({ local: [], session: [['b', '2']] });
    expect(tab.getItem('plannotator-own-key')).toBe('kept');
    expect(tab.getItem('theme')).toBe('kept too');
  });

  test('a change past the limit is not kept, and replacing a value counts the new one only', () => {
    const store = createFrameStorage(new MemoryStorage(), 20, 0)!;
    expect(store.limit).toBe(20);
    store.write({ area: 'local', op: 'set', key: 'k', value: '123456789' });
    store.write({ area: 'local', op: 'set', key: 'k', value: '1234567890123456789' });
    expect(store.read().local).toEqual([['k', '1234567890123456789']]);
    store.write({ area: 'session', op: 'set', key: 'more', value: 'x' });
    expect(store.read().session).toEqual([]);
    const plain = createFrameStorage(new MemoryStorage())!;
    expect([plain.limit, plain.perItem]).toEqual([FRAME_STORAGE_LIMIT, FRAME_STORAGE_PER_ITEM]);
  });

  // Each item's stored name carries a prefix of up to 26 characters: counted as key and value alone, items with
  // tiny keys and empty values held 13 times what the limit says, far past the tab's quota.
  test('each item costs its key, its value and its share besides, so many small items reach the limit too', () => {
    const tab = new MemoryStorage();
    const store = createFrameStorage(tab, 100, 30)!;
    for (const key of ['a', 'b', 'c', 'd']) store.write({ area: 'local', op: 'set', key, value: '1' });
    expect(store.read().local.map(([key]) => key)).toEqual(['a', 'b', 'c']);
  });

  test('the total follows every change: a remove and a clear give their room back, a replace only its difference', () => {
    const store = createFrameStorage(new MemoryStorage(), 100, 30)!;
    for (const key of ['a', 'b', 'c']) store.write({ area: 'local', op: 'set', key, value: '1' });
    store.write({ area: 'local', op: 'remove', key: 'a' });
    store.write({ area: 'session', op: 'set', key: 'd', value: '1' });
    store.write({ area: 'local', op: 'set', key: 'b', value: '1234' });
    expect(store.read()).toEqual({ local: [['b', '1234'], ['c', '1']], session: [['d', '1']] });
    store.write({ area: 'local', op: 'clear' });
    for (const key of ['e', 'f']) store.write({ area: 'local', op: 'set', key, value: '1' });
    expect(store.read()).toEqual({ local: [['e', '1'], ['f', '1']], session: [['d', '1']] });
  });

  test('a store over a tab that already holds page items (a reload of the review) counts them', () => {
    const tab = new MemoryStorage();
    tab.setItem('plannotator.frame.local:a', '1');
    tab.setItem('plannotator.frame.local:b', '1');
    const store = createFrameStorage(tab, 100, 30)!;
    for (const key of ['c', 'd']) store.write({ area: 'local', op: 'set', key, value: '1' });
    expect(store.read().local.map(([key]) => key)).toEqual(['a', 'b', 'c']);
  });

  test("a change the browser refuses (the quota) is swallowed, and what was kept stays", () => {
    const store = createFrameStorage(new MemoryStorage(30))!;
    store.write({ area: 'local', op: 'set', key: 'a', value: '1' });
    expect(() => store.write({ area: 'local', op: 'set', key: 'b', value: 'x'.repeat(100) })).not.toThrow();
    expect(store.read().local).toEqual([['a', '1']]);
  });

  test('no store when the tab has no storage to give', () => {
    const denied = { get length(): number { throw Object.assign(new Error('denied'), { name: 'SecurityError' }); } } as unknown as Storage;
    expect(createFrameStorage(denied)).toBeUndefined();
  });
});
