/**
 * A review's documents as entries of the tab's own history.
 *
 * Opening a linked document swaps the app's state (useLinkedDoc); nothing
 * told the tab, so its address stayed `/`, Chrome's Back and Forward stepped
 * over the whole review, and a page's own `history.back()` had no entry to go
 * to. This hook gives every document the reviewer opens an entry of the
 * tab's history:
 *
 * - The address names the document: its path relative to the reviewed file's
 *   folder (`/docs/lessons.html`; the root is `/`), or `/?doc=<absolute path>`
 *   for a document outside that folder or whose first segment the server or a
 *   share link owns. Never a fragment (useSharing reads one as a share). The
 *   server answers every such path with the app, so a reload or a pasted
 *   address reopens the document.
 * - The entry's state is the only record (`plannotatorDoc`, its place among
 *   the review's entries `plannotatorIndex`, and the documents before and
 *   after it, `plannotatorPrev` / `plannotatorNext`), so Back and Forward, a
 *   page's own Back (forwarded by the viewer) and the browser's buttons all
 *   move one history.
 * - It observes the open document rather than wrapping each way of opening
 *   one: a link, a backlink, the file browser, the bundle switcher, a jump to
 *   a comment and WebMCP all become entries the same way.
 *
 * The open document is the host's; this hook only opens the one an entry
 * names, through the host's own router.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { normalizeBrowserPath } from '../sourceDocumentPaths';

/** An entry of the review's history: the document it shows (null: the root). */
export interface DocumentHistoryEntry {
  doc: string | null;
  /** Its place among the review's entries, 0 for the first. */
  index: number;
  /** The session that wrote it (the server's nonce), when it named one. */
  session?: string;
  /** The document of the entry before it, when known. */
  prev?: string | null;
  /** The document of the entry after it, while one is ahead. */
  next?: string | null;
}

const DOC = 'plannotatorDoc';
const INDEX = 'plannotatorIndex';
const PREV = 'plannotatorPrev';
const NEXT = 'plannotatorNext';
const SESSION = 'plannotatorSession';
const OURS = [DOC, INDEX, PREV, NEXT, SESSION];

/** First segments the server or a share link answers itself (`/api/…`, `/assets/…`, `/p/<id>`). */
const RESERVED_FIRST_SEGMENTS = new Set(['api', 'assets', 'p']);
/** Whole paths the server answers itself. */
const RESERVED_PATHS = new Set(['favicon.ico', 'favicon.png']);
/** How long a step this hook asked for may take to land before another is taken (one that lands nowhere never does). */
const STEP_WAIT_MS = 1000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isDocValue(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && value.length > 0);
}

/** Path equality across spellings (separators, doubled slashes); null is the root. */
export function sameDocument(a: string | null | undefined, b: string | null | undefined): boolean {
  if (a === undefined || b === undefined) return false;
  if (a === null || b === null) return a === b;
  return normalizeBrowserPath(a) === normalizeBrowserPath(b);
}

/** The entry a history state of ours holds, or null for any other state. */
export function readHistoryEntry(state: unknown): DocumentHistoryEntry | null {
  if (!isRecord(state)) return null;
  const doc = state[DOC];
  const index = state[INDEX];
  if (!isDocValue(doc) || typeof index !== 'number' || !Number.isInteger(index) || index < 0) return null;
  const entry: DocumentHistoryEntry = { doc, index };
  if (PREV in state && isDocValue(state[PREV])) entry.prev = state[PREV] as string | null;
  if (NEXT in state && isDocValue(state[NEXT])) entry.next = state[NEXT] as string | null;
  if (typeof state[SESSION] === 'string') entry.session = state[SESSION] as string;
  return entry;
}

/** STATE (whatever another owner keeps in it stays) holding ENTRY. */
export function historyStateWith(state: unknown, entry: DocumentHistoryEntry): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (isRecord(state)) {
    for (const [key, value] of Object.entries(state)) {
      if (!OURS.includes(key)) out[key] = value;
    }
  }
  out[DOC] = entry.doc;
  out[INDEX] = entry.index;
  if (entry.prev !== undefined) out[PREV] = entry.prev;
  if (entry.next !== undefined) out[NEXT] = entry.next;
  if (entry.session !== undefined) out[SESSION] = entry.session;
  return out;
}

/** `.` and `..` segments resolved, as the server resolves a path it is given. */
function resolveDots(path: string): string {
  const drive = /^[A-Za-z]:\//.test(path) ? path.slice(0, 2) : '';
  const rest = drive ? path.slice(2) : path;
  const absolute = rest.startsWith('/');
  const parts: string[] = [];
  for (const part of rest.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (parts.length && parts[parts.length - 1] !== '..') parts.pop();
      else if (!absolute) parts.push(part);
      continue;
    }
    parts.push(part);
  }
  return `${drive}${absolute ? '/' : ''}${parts.join('/')}`;
}

/** DOC's path below BASE (no leading slash), or null when it is not below it. */
function relativeBelow(doc: string, base: string): string | null {
  const dir = normalizeBrowserPath(base);
  const prefix = dir.endsWith('/') ? dir : `${dir}/`;
  return doc.startsWith(prefix) && doc.length > prefix.length ? doc.slice(prefix.length) : null;
}

function isReserved(relative: string): boolean {
  return RESERVED_PATHS.has(relative) || RESERVED_FIRST_SEGMENTS.has(relative.split('/')[0]!);
}

/** A query value with its slashes and colons kept readable: both are allowed there. */
function queryValue(value: string): string {
  return encodeURIComponent(value).replace(/%2F/gi, '/').replace(/%3A/gi, ':');
}

/**
 * The address of DOC (null: the root) for a review whose documents are
 * addressed below BASE (null: none are), keeping the query SEARCH holds
 * except its `doc`. Null when the path cannot be written in an address at all
 * (a lone surrogate).
 */
export function addressFor(doc: string | null, base: string | null, search: string): string | null {
  try {
    const params = new URLSearchParams(search);
    params.delete('doc');
    const kept = params.toString();
    if (doc === null) return kept ? `/?${kept}` : '/';
    const path = resolveDots(normalizeBrowserPath(doc));
    const relative = base === null ? null : relativeBelow(path, base);
    if (relative !== null && !isReserved(relative)) {
      return `/${relative.split('/').map(encodeURIComponent).join('/')}${kept ? `?${kept}` : ''}`;
    }
    return `/?doc=${queryValue(path)}${kept ? `&${kept}` : ''}`;
  } catch {
    return null;
  }
}

/**
 * The document an address names (null: the root), read as {@link addressFor}
 * writes it; the root file's own path reads as the root. An address that is
 * not one (a malformed escape) reads as the root.
 */
export function docFromAddress(
  location: { pathname: string; search: string },
  base: string | null,
  rootFile: string | null,
): string | null {
  let doc: string | null = null;
  const named = new URLSearchParams(location.search).get('doc');
  if (named) {
    doc = named;
  } else if (base !== null) {
    let segments: string[];
    try {
      segments = location.pathname.split('/').filter(Boolean).map((segment) => decodeURIComponent(segment));
    } catch {
      return null;
    }
    if (segments.length) doc = `${normalizeBrowserPath(base)}/${segments.join('/')}`;
  }
  if (doc === null) return null;
  const path = resolveDots(normalizeBrowserPath(doc));
  if (!path || (rootFile !== null && sameDocument(path, rootFile))) return null;
  return path;
}

export interface UseDocumentHistoryOptions {
  /** Off: the hook neither reads nor writes the tab's history (a share link, a live app, an embedded app, a decided review). */
  enabled: boolean;
  /** The root document has loaded: the first entry can be tagged and the page it names opened. */
  ready: boolean;
  /** The document on screen: a linked document's path, or null for the root. */
  activeDoc: string | null;
  /** The folder the review's addresses are relative to; null addresses every document by `?doc=`. */
  base: string | null;
  /** The reviewed file's own path, which is the root wherever it is named. */
  rootFile: string | null;
  /**
   * This session's identity (the server's nonce), written into each entry: a
   * reload keeps it, and an entry another session wrote (a later session on
   * the same port, in the same tab) is no entry of this review's.
   */
  session: string | null;
  /** Opens DOC the way the host opens any document (resolves when the open has ended, opened or not). */
  open: (doc: string, options: { restoreScroll: boolean }) => Promise<void> | void;
  /** Shows the root again, at the reader's place in it. */
  showRoot: () => Promise<void> | void;
  /** Whether a document named only by a typed or pasted address may be opened (a kind Plannotator annotates). */
  opensFromAddress: (doc: string) => boolean;
  /** The tab's own by default; tests pass their own. */
  history?: History;
  location?: Location;
  /** Where popstate is listened to; the tab's window by default. */
  eventTarget?: Pick<Window, 'addEventListener' | 'removeEventListener'>;
}

export interface DocumentHistory {
  /** The next document opened replaces the entry on screen instead of adding one (a bundle's first file at load). */
  replaceNext: () => void;
  /** Whether the entry or the address at load names a page this hook opens itself (read once ready). */
  restoresPage: () => boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  /** The document Back returns to (null: the root); meaningful while canGoBack. */
  backDoc: string | null;
  /** The document Forward goes to (null: the root); meaningful while canGoForward. */
  forwardDoc: string | null;
  back: () => void;
  forward: () => void;
  /** Moves DELTA entries, never before the review's first, one step at a time (a call while a step is landing is dropped). */
  go: (delta: number) => void;
}

interface PendingOpen {
  /** The document this hook asked for (null: the root). */
  doc: string | null;
  seq: number;
}

export function useDocumentHistory(options: UseDocumentHistoryOptions): DocumentHistory {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const { enabled, ready, base, rootFile } = options;
  // The reviewed file named as a linked document is the root: one entry, one address.
  const current = options.activeDoc !== null && rootFile !== null && sameDocument(options.activeDoc, rootFile)
    ? null
    : options.activeDoc;
  const currentRef = useRef(current);
  currentRef.current = current;

  const [entry, setEntry] = useState<DocumentHistoryEntry | null>(null);
  const entryRef = useRef<DocumentHistoryEntry | null>(null);
  const mountedRef = useRef(false);
  const restoresPageRef = useRef(false);
  const replaceNextRef = useRef(false);
  const pendingRef = useRef<PendingOpen | null>(null);
  const seqRef = useRef(0);
  const [settled, setSettled] = useState(0);
  const lastSeenRef = useRef<string | null>(current);
  // A step go() asked for, until its popstate (or STEP_WAIT_MS): a burst of
  // calls, each reading the same entry, would otherwise run past the first.
  const steppingRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stepLanded = useCallback(() => {
    if (steppingRef.current !== null) clearTimeout(steppingRef.current);
    steppingRef.current = null;
  }, []);
  useEffect(() => stepLanded, [stepLanded]);

  const historyOf = () => optionsRef.current.history ?? window.history;
  const locationOf = () => optionsRef.current.location ?? window.location;
  // An entry of this session's (one another session wrote is not this review's).
  const ownEntry = useCallback((state: unknown): DocumentHistoryEntry | null => {
    const entry = readHistoryEntry(state);
    return entry && entry.session === (optionsRef.current.session ?? undefined) ? entry : null;
  }, []);
  const sessionField = () => (optionsRef.current.session ? { session: optionsRef.current.session } : {});

  const remember = useCallback((next: DocumentHistoryEntry) => {
    entryRef.current = next;
    setEntry(next);
  }, []);

  /** ENTRY replaces the one on screen, at ADDRESS (the address on screen when undefined). */
  const replaceEntry = useCallback((next: DocumentHistoryEntry, address?: string | null) => {
    if (address === null) return;
    const h = optionsRef.current.history ?? window.history;
    try {
      if (address === undefined) h.replaceState(historyStateWith(h.state, next), '');
      else h.replaceState(historyStateWith(h.state, next), '', address);
    } catch {
      return;
    }
    remember(next);
  }, [remember]);

  // Asks the host for the page ENTRY names; the activation that follows is
  // that entry's, never a new one. Resolves `settled` when the open ends.
  const openEntry = useCallback((doc: string | null) => {
    const seq = ++seqRef.current;
    pendingRef.current = { doc, seq };
    const { open, showRoot } = optionsRef.current;
    const done = () => { if (seqRef.current === seq) setSettled(seq); };
    let opening: Promise<void> | void;
    try {
      opening = doc === null ? showRoot() : open(doc, { restoreScroll: true });
    } catch {
      opening = undefined;
    }
    void Promise.resolve(opening).catch(() => {}).then(done);
  }, []);

  useLayoutEffect(() => {
    if (!enabled || !ready) return;
    const h = historyOf();
    const loc = locationOf();
    if (!mountedRef.current) {
      mountedRef.current = true;
      lastSeenRef.current = currentRef.current;
      // A reload (or a restored tab) keeps this entry's state; a typed or
      // pasted address carries none, and opens only a kind of document
      // Plannotator annotates (`/api/doc` reads any other path as markdown).
      const tagged = ownEntry(h.state);
      if (tagged) {
        remember(tagged);
        if (!sameDocument(tagged.doc, currentRef.current)) {
          restoresPageRef.current = tagged.doc !== null;
          openEntry(tagged.doc);
        }
        return;
      }
      const named = docFromAddress(loc, base, rootFile);
      const opens = named !== null && optionsRef.current.opensFromAddress(named);
      const first: DocumentHistoryEntry = { doc: opens ? named : null, index: 0, ...sessionField() };
      replaceEntry(first, opens ? undefined : addressFor(null, base, loc.search));
      if (opens) {
        restoresPageRef.current = true;
        openEntry(named);
      }
      return;
    }

    const shown = currentRef.current;
    const activated = !sameDocument(shown, lastSeenRef.current);
    lastSeenRef.current = shown;
    const at = ownEntry(h.state) ?? entryRef.current;
    if (!at) return;

    const pending = pendingRef.current;
    if (pending) {
      if (activated) {
        pendingRef.current = null;
        // The page asked for, as the server spells it (or, for the root of a
        // review of several files, the file shown in its place).
        if (pending.doc === null || sameDocument(shown, pending.doc)) {
          if (!sameDocument(shown, at.doc)) replaceEntry({ ...at, doc: shown }, addressFor(shown, base, loc.search));
          return;
        }
        // Another document won the race (the reviewer's own): it is a new entry.
      } else if (settled === pending.seq) {
        // The open ended and nothing activated: it failed. The address goes
        // back to the page on screen.
        pendingRef.current = null;
        if (!sameDocument(shown, at.doc)) replaceEntry({ ...at, doc: shown }, addressFor(shown, base, loc.search));
        return;
      } else {
        return;
      }
    }

    if (sameDocument(shown, at.doc)) return;
    if (replaceNextRef.current) {
      replaceNextRef.current = false;
      replaceEntry({ ...at, doc: shown }, addressFor(shown, base, loc.search));
      return;
    }
    const address = addressFor(shown, base, loc.search);
    if (address === null) return;
    const next: DocumentHistoryEntry = { doc: shown, index: at.index + 1, prev: at.doc, ...sessionField() };
    try {
      // The entry left behind learns what lies ahead of it (Forward's name).
      h.replaceState(historyStateWith(h.state, { ...at, next: shown }), '');
      h.pushState(historyStateWith(null, next), '', address);
    } catch {
      return;
    }
    remember(next);
    // `current` is read through its ref; `settled` re-runs the check when an open this hook asked for ends.
  }, [enabled, ready, current, settled, base, rootFile, openEntry, ownEntry, remember, replaceEntry]);

  useLayoutEffect(() => {
    if (!enabled) return;
    const target = optionsRef.current.eventTarget ?? window;
    const onPopState = (event: PopStateEvent) => {
      stepLanded();
      if (!mountedRef.current) return;
      const popped = ownEntry(event.state);
      if (!popped) return;
      remember(popped);
      // The page on screen already, with nothing on its way: nothing to open.
      // An open still on its way is overtaken by opening this entry's page.
      if (sameDocument(popped.doc, currentRef.current) && !pendingRef.current) return;
      openEntry(popped.doc);
    };
    target.addEventListener('popstate', onPopState as EventListener);
    return () => target.removeEventListener('popstate', onPopState as EventListener);
  }, [enabled, openEntry, ownEntry, remember, stepLanded]);

  const go = useCallback((delta: number) => {
    if (!optionsRef.current.enabled || !Number.isInteger(delta) || delta === 0) return;
    if (steppingRef.current !== null) return;
    const at = entryRef.current;
    if (!at || at.index + delta < 0) return;
    steppingRef.current = setTimeout(stepLanded, STEP_WAIT_MS);
    historyOf().go(delta);
  }, [stepLanded]);
  const back = useCallback(() => go(-1), [go]);
  const forward = useCallback(() => {
    if (entryRef.current?.next === undefined) return;
    go(1);
  }, [go]);
  const replaceNext = useCallback(() => { replaceNextRef.current = true; }, []);
  const restoresPage = useCallback(() => restoresPageRef.current, []);

  const live = enabled && entry !== null;
  return {
    replaceNext,
    restoresPage,
    canGoBack: live && entry!.index > 0,
    canGoForward: live && entry!.next !== undefined,
    backDoc: live && entry!.prev !== undefined ? entry!.prev : null,
    forwardDoc: live && entry!.next !== undefined ? entry!.next : null,
    back,
    forward,
    go,
  };
}
