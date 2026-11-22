/**
 * Select or Pinpoint: one remembered choice (DOM-gated).
 *
 * Every surface reads and writes the same preference, so a choice made on a
 * Markdown document holds on the next HTML page or live app, and back. A fresh
 * setup opens in Select. The retired HTML-only record is never read.
 */
import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { resetStorageBackend, setStorageBackend, type StorageBackend } from './storage';

const hasDom = typeof document !== 'undefined';
const inputMethodModule = hasDom ? await import('./inputMethod') : null;

// In-memory storage so tests don't depend on happy-dom cookie semantics
// (the codebase-standard pattern for persistence tests).
const memory = new Map<string, string>();
const memoryBackend: StorageBackend = {
  getItem: (key) => memory.get(key) ?? null,
  setItem: (key, value) => void memory.set(key, value),
  removeItem: (key) => void memory.delete(key),
};

beforeEach(() => {
  if (!hasDom) return;
  memory.clear();
  setStorageBackend(memoryBackend);
});

afterAll(() => {
  resetStorageBackend();
});

describe.if(hasDom)('resolveInputMethod (pure)', () => {
  test('a stored "word" (a method that became part of Select) reads as drag', () => {
    expect(inputMethodModule!.resolveInputMethod('word')).toBe('drag');
  });

  test('nothing saved opens in Select', () => {
    expect(inputMethodModule!.resolveInputMethod(null)).toBe('drag');
  });

  test('a saved choice wins, with no expiry', () => {
    expect(inputMethodModule!.resolveInputMethod('pinpoint')).toBe('pinpoint');
    expect(inputMethodModule!.resolveInputMethod('drag')).toBe('drag');
  });

  test('garbage saved values fall back to Select', () => {
    expect(inputMethodModule!.resolveInputMethod('bogus')).toBe('drag');
    expect(inputMethodModule!.resolveInputMethod('{"m":"pinpoint","savedAt":1}')).toBe('drag');
  });
});

describe.if(hasDom)('getInputMethod / saveInputMethod (cookie round trip)', () => {
  test('first run resolves Select', () => {
    expect(inputMethodModule!.getInputMethod()).toBe('drag');
  });

  test('a saved choice is read back, from one key', () => {
    inputMethodModule!.saveInputMethod('pinpoint');
    expect(memory.get('plannotator-input-method')).toBe('pinpoint');
    expect(inputMethodModule!.getInputMethod()).toBe('pinpoint');

    inputMethodModule!.saveInputMethod('drag');
    expect(inputMethodModule!.getInputMethod()).toBe('drag');
  });

  test('the retired HTML-only record is never read', () => {
    memory.set('plannotator-input-method-html', JSON.stringify({ m: 'pinpoint', savedAt: Date.now() }));
    expect(inputMethodModule!.getInputMethod()).toBe('drag');
  });
});
