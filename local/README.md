# local/: this fork's own build

`mine` is Plannotator's newest release with these commits on it, in order:

1. This directory: the build tooling, never offered upstream.
2. **A highlight covers its whole selection** (`bridge-script.ts`). The bridge painted only the first
   48 client rects of a selection, so a selection over many text runs (a PDF paragraph whose
   citations split its lines) stopped short of its end. The screen now bounds the work, never the
   selection.
3. **A text selection keeps its position** (`html-anchor.ts`, the bridge, `useHtmlAnnotation.ts`):
   the element a selection starts in and its character offsets are saved with the annotation, so a
   quote that occurs more than once is restored on its own occurrence, not the first.
4. **The position is exported** (`parser.ts`): one line after the comment,
   ``- **selection** `#p8-37` chars 12-16``. An annotation without a position exports as before.
5. That line, described in `docs/agent-guides/guides-and-shared-ui.md` (its own commit, so a
   conflict there can be skipped).
6. **Linked documents are history entries** (`packages/editor/hooks/useDocumentHistory.ts`, App):
   each document the reviewer opens is an entry of the tab's history, addressed by its path below
   the reviewed file's folder (else `/?doc=`), so the browser's Back and Forward, a reload and a
   pasted address reach the review's pages.
7. **A page's storage lasts the review** (`frameStorage.ts`, HtmlViewer's `frameStorage`, the
   sandbox shim): a page's localStorage and sessionStorage are kept in the review tab's own
   sessionStorage and seed every later page (md2web's theme).
8. **A page's own history calls move the review's history** (HtmlViewer's `onPageHistory`, the
   shim, the link guard): a page's own Back works for a person's click in it, one step at a time,
   never out of the review.
9. **A linked HTML page has no size cap** (`reference-handlers.ts`), as the reviewed one has none.
10. **Back and Forward, named** (`HistorySteps.tsx`, DocBadges, TableOfContents,
    HtmlSurfaceControls, the compact menu), beside the jump to the root, which names the root.
11. **A page open leaves the sidebar alone**, so Wide and Focus survive moving between pages.
12. **Wide and Focus are remembered** for the next review (`annotateViewChoice`, a cookie).
13. **No block outline on a page open**: Vim's BLOCK starts on the first key (`useVimSelection`,
    the bridge's `focus-vim`).
14. Those, described in the agent guides (its own commit, as 5).
15. **An HTML page opens in Interact** (App's `htmlAnnotateArmed`): its own controls answer the
    first click, and `Mod+Shift+A` arms Annotate. *Superseded by 23.*
16. That, described in the agent guides (its own commit, as 5).
17. **Escape closes a composer opened over an HTML page, wherever focus is** (the bridge's
    `set-host-overlay` and `overlay-escape`; `release-focus` as the composer opens). *Its key path is
    superseded by 25 and 26; `release-focus` stays.*
18. **The done screen's tab closes after a review that followed links** (`packages/server/close-tab.ts`:
    the server closes it through the browser's AppleScript on macOS).
19. **An HTML page takes Markdown's annotation modes** (`utils/annotationModes`): the toolstrip above
    the page, Markup, Comment, Redline and Label with Shift+1 to 4, Delete and the label picker; a
    pinned element opens the composer in Markup. *Its `mode-key` path is superseded by 25 and 26.*
20. Those, described in the agent guides (its own commit, as 5).
21. **Escape closes a visible composer with focus on the app's body** (HtmlViewer's composer rung),
    as after a click back into an HTML page; described with 17 in the agent guides.
22. **Mod+Enter is the header's primary** (App's `primaryAvailable`, read by the header, the compact
    rows and the key): with a linked page open, annotate's Done sends, as the header shows it.
23. **Select and Pinpoint are one remembered choice on every surface** (`utils/inputMethod`, one
    cookie): an HTML or live-app page is armed in Pinpoint; the toolstrip, the compact control, the
    Alt keys and `Mod+Shift+A` (Markdown too) set it, and Escape never does; no header pen, no
    "Annotate page".
24. **The Escape that closes a draft over an HTML page is used** (the bridge): one Escape, one rung.
25. **A key pressed in an HTML page is the review's too** (the link guard's keys, HtmlViewer's
    `forwardPageKeys`, `bindingDescriptor`, `pageKeyClaims`): the surface's Cmd chords, and Escape
    while an overlay is open, are taken before the page; every other key the page did not use
    follows; each runs the app's own handler, as on Markdown. The Inbox and live apps keep upstream's.
26. **Patch 17's and 19's key messages retired**: the page's Escape and Shift+1 to 4 come through
    the link guard.
27. **The done screen's tab closes whatever opened it** (`close-tab.ts`'s held request and
    `settleSession`, `useAutoClose`'s early ask): a tab that cannot close itself asks the server as
    the done screen appears, the server closes it when the countdown ends and stays up for it; the
    browsers are checked at once, and a timeout or an ended session says so.
28. Those, described in the agent guides (its own commit, as 5).
29. **Only a lone Alt switches Select and Pinpoint** (`hooks/useInputMethodSwitch`): Alt with Cmd, Ctrl
    or Shift held, or with another key while it is down, is a chord (a Hyper key's Escape, Alt+1); a
    tap's revert outlives renders, so taps never leave Pinpoint stuck.
30. **The done screen names no agent** (`CompletionOverlay`, both apps' subtitles): what was sent back,
    or that nothing was, and that the tab can close.
31. Those, described in the agent guides (its own commit, as 5).
32. **A Place of Mind, a theme** (`themes/a-place-of-mind.css`, the registry, `syntaxTheme`): aplaceofmind.com's
    Blueberry Mango (dark) and its warm light scheme, JuliaMono for code, One Dark Pro and One Light for its code
    colours.
33. **Back and Forward give each page its place** (`useDocumentHistory`'s `plannotatorPlace`, the bridge's
    `page-place` and `restore-place`, HtmlViewer's `onPagePlace` and `initialPlace`, `useLinkedDoc.restoreScrollAnchor`):
    each history entry keeps where the reader was on its page (an HTML page's own scroll in its frame, a drawn page's
    first block in view), written as the reader moves and before another page opens, and given back on Back, Forward
    and a reload; two entries of one page keep a place each.
34. That, described in the agent guides (its own commit, as 5).

`main` mirrors `upstream/main` and is never committed to.

## Setup, once per machine

- `local/build.env` (git-ignored): `BUILD_HOST=<ssh host>`, a Mac on Apple silicon with Homebrew's
  bash and coreutils and Bun at upstream's floor in `~/.bun/bin`; and `CHECK=<path>`, a browser check
  run as `uv run --script "$CHECK" check --plannotator BIN` that exits 0 only when the patches work.
- `ln -s "$PWD/local/rebuild.sh" ~/.local/bin/plannotator-rebuild`
- `git config rerere.enabled true`

## Use

- `plannotator-rebuild --check`: the installed build, the release `mine` is on, and how many
  releases came after it.
- `plannotator-rebuild` (or `--to TAG`): replays `mine` onto the newest release, syncs the tree to
  the build host's `~/.cache/plannotator-build/src`, builds it with upstream's CI recipe, runs
  `bun run typecheck` and the patches' thirty-one suites in upstream's test sandbox (`--full`: every unit
  suite), stages the binary at `~/.cache/plannotator-build/plannotator`, and runs the browser check
  on it. Only when all of that passes does it install the binary over `~/.local/bin/plannotator` by
  a rename, tag `mine-<release>.<n>`, and push `mine` (`--force-with-lease`) and the tag.
- A conflict aborts the replay, names the files, and leaves `mine` as it was. Replay by hand
  (`git rebase --onto <new> <old> mine`; rerere remembers each resolution), read
  `git range-diff <old>..<old mine> <new>..mine`, then run `plannotator-rebuild` again.
- `--stage`: build and test `mine` as it is; install nothing.
- `--rollback`: put back `~/.local/bin/plannotator-official`, the official binary kept at the first
  install (and again after `plannotator update`).

## What the build is

- `plannotator --version` prints `<release>+mine.<sha7>`. Update checks read that as a development
  build: no update notice, no auto-update, and no daily ping (`__PLANNOTATOR_RELEASE__` stays
  undefined). The install also sets `autoUpdate` and `updateCheck` to `false` in
  `~/.plannotator/config.json`, every other key kept.
- `plannotator update` and the official installer put the official build back. Run
  `plannotator-rebuild` again afterwards; it keeps that official binary as the new rollback copy.
- The Guided Review viewer: a release pins the viewer `guides.show` publishes for it, and a viewer
  built from these commits is published nowhere. So the pin is built from a clean tree of the
  release tag and embedded only when `guides.show` serves both of its files with the pinned integrity;
  otherwise upstream's fallback pin (an older published viewer) is.

## A pull request from a patch

```sh
git fetch upstream
git switch -c fix/<name> upstream/main
git cherry-pick <the patch's commit on mine>
bun run test:sandbox <its suites> && bun run typecheck
git push -u origin fix/<name>   # then open the PR against backnotprop/plannotator
```
