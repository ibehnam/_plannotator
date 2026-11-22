import { storage } from './storage';
import type { InputMethod } from '../types';

const STORAGE_KEY = 'plannotator-input-method';
const DEFAULT_METHOD: InputMethod = 'drag';

function parseInputMethod(value: unknown): InputMethod | null {
  // `word` was a third method for a short while; its click is part of Select now.
  if (value === 'word') return 'drag';
  return value === 'drag' || value === 'pinpoint' ? value : null;
}

/**
 * Pure resolution logic (exported for tests).
 *
 * Select ('drag') or Pinpoint is one remembered choice for every surface:
 * Markdown documents, HTML pages and live apps read and write the same key,
 * with no expiry. A fresh setup opens in Select.
 */
export function resolveInputMethod(saved: string | null): InputMethod {
  return parseInputMethod(saved) ?? DEFAULT_METHOD;
}

export function getInputMethod(): InputMethod {
  return resolveInputMethod(storage.getItem(STORAGE_KEY));
}

export function saveInputMethod(method: InputMethod): void {
  storage.setItem(STORAGE_KEY, method);
}
