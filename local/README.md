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
    browsers are checked at once, and a timeout or an ended session says so. The Pi extension's
    servers route `/api/close-tab` to the same handler (vendored), as upstream's route parity asks.
28. Those, described in the agent guides (its own commit, as 5).
29. **Only a lone Alt switches Select and Pinpoint** (`hooks/useInputMethodSwitch`): Alt with Cmd, Ctrl
    or Shift held, or with another key while it is down, is a chord (a Hyper key's Escape, Alt+1); a
    tap's revert outlives renders, so taps never leave Pinpoint stuck.
30. **The done screen names no agent** (`CompletionOverlay`, both apps' subtitles): what was sent back,
    or that nothing was, and that the tab can close.
31. Those, described in the agent guides (its own commit, as 5).
32. **A Place of Mind, a theme** (`themes/a-place-of-mind.css`, the registry, `syntaxTheme`): aplaceofmind.com's
    Blueberry Mango (dark) and its warm light scheme, JuliaMono for code, One Dark Pro and One Light for its code
    colours. Its secondary is a second accent, the site's keyword orchid, as in Plannotator's own theme: the toolstrip
    draws Markup's hover in it, which a surface secondary made near-invisible (`themeContrast.test.ts` guards it).
33. **Back and Forward give each page its place** (`useDocumentHistory`'s `plannotatorPlace`, the bridge's
    `page-place` and `restore-place`, HtmlViewer's `onPagePlace` and `initialPlace`, `useLinkedDoc.restoreScrollAnchor`):
    each history entry keeps where the reader was on its page (an HTML page's own scroll in its frame, a drawn page's
    first block in view), written as the reader moves and before another page opens, and given back on Back, Forward
    and a reload; two entries of one page keep a place each.
34. That, described in the agent guides (its own commit, as 5).
35. **With plan review off, a review gate may ask for one plan's review** (`apps/hook/server/plan-review-gate.ts`,
    the plan hook in `index.ts`): where the person's own `PLANNOTATOR_PLAN_REVIEW` (or `planReview`) turns plan
    review off, the `ExitPlanMode` permission request runs `PLANNOTATOR_PLAN_REVIEW_GATE` with `/bin/sh -c`, the
    hook event on its stdin. Exit 0 within 5 s opens the classic review; anything else gives no decision, as
    upstream does, and with no gate nothing runs. A host's own plan card never asks it. Its suites also keep the one
    upstream behaviour it needs: with plan review off, the mod passes `ExitPlanMode` on.
36. That, described in the agent guides (`environment.md`, its own commit, as 5).

`main` mirrors `upstream/main` and is never committed to.

## The patch guard

Each code patch has a suite that fails without it (audit of 2026-11-24, `mine` at `b0457d956`, on the
build host, no binary build; `mine` itself: 398 and 493 pass, 0 fail). "Without": the patch's non-test
changes reverse-applied on `mine`, the test files and `tests/dom-test-list.txt` kept, every listed suite
run. "Before": where a later patch changed the same lines, `mine` at the patch's parent with the test
files and the DOM list as the patch left them, its own suites run. Every suite below is in `suites`.

| Patch | Commit | Check | Suites that fail |
|---|---|---|---|
| 2 | `32acfe96b` | without | `srcdoc` |
| 3 | `ebdf797d6` | before | `html-anchor`, `HtmlViewer.reopenComment`, `htmlPinpointProtocol`, `srcdoc` |
| 4 | `4fed86158` | without | `parser` |
| 6 | `0a6fdc22d` | before | `useDocumentHistory` |
| 7 | `cf3dea5d2` | before | `frameStorage`, `HtmlViewer.frameHost`, `sandboxShim` |
| 8 | `ab17966f8` | before | `HtmlViewer.frameHost`, `linkGuard`, `sandboxShim` |
| 9 | `88880f01a` | without | `reference-handlers` |
| 10 | `9c676fb00` | before | `App.bundleBackScroll`, `DocBadges` (then the run hung, 900 s) |
| 11 | `e06db1b92` | without | `App.annotateView` |
| 12 | `45d064aad` | without | `App.annotateView` |
| 13 | `cbf9b3942` | without | `Viewer.vimMode.integration`, `srcdoc`, `useVimSelection` |
| 15 | `a79f4c898` | before | `App.htmlChrome` (superseded by 23, whose suites guard it now) |
| 17 | `248f56145` | before | `htmlPinpointProtocol`, `srcdoc` |
| 18 | `0b2fe5abb` | before | `close-tab`, `useAutoClose` |
| 19 | `077d2f42e` | before | `App.htmlChrome`, `htmlPinpointProtocol`, `srcdoc`, `annotationModes` |
| 21 | `91a8bfda9` | before | `htmlPinpointProtocol` |
| 22 | `d7eed5144` | without | `App.decisionControl` |
| 23 | `6f65860b9` | before | `App.htmlChrome`, `inputMethod` |
| 24 | `03559c468` | without | `srcdoc` |
| 25 | `c141183c5` | before | `App.htmlChrome`, `htmlPinpointProtocol`, `linkGuard`, `shortcuts` |
| 26 | `29038a7ed` | without | `srcdoc` |
| 27 | `5446db3ee` | before | `annotate-command`, `close-tab`, `useAutoClose` |
| 29 | `192045c2b` | without | `App.htmlChrome`, `useInputMethodSwitch` |
| 30 | `2fc423eaa` | without | `App.decisionControl`, `useAutoClose` |
| 32 | `0866429ab` with `2ba5b4036` | without | `themeContrast` |
| 32 (secondary) | `2ba5b4036` | without | `themeContrast` |
| 33 | `58015139f` | without | `useDocumentHistory`, `HtmlViewer.frameScale`, `HtmlViewer.pagePlace`, `bridgePagePlace` |
| 35 | `5d2c81a43` | without | `apps/hook/server/plan-review-gate` |

`apps/hook/hooks/mod/plan-review-gate` passes without 35 by design: it guards upstream's mod, not the patch.
A replay changes the commit names; check each new code patch the same way before it is listed.
On 2026-11-25 patches 27 and 35 gained `windowsHide: true` on their spawns (`close-tab.ts`,
`plan-review-gate.ts`), which upstream's `tests/windows-hide-guard.test.ts` asks of every spawn; that
suite is now in `suites` too, so each build runs it, and the commits from patch 27 on have new names.
Patch 27 also routes `/api/close-tab` on the Pi extension's three servers, through the same handler
(vendored, `handleCloseTabRoute`), which upstream's `tests/parity/route-parity.test.ts` asks of every
route; that suite, `tests/parity/vendor-parity.test.ts` and the route's own Pi suite are in `suites`.

## Setup, once per machine

- `local/build.env` (git-ignored): `BUILD_HOST=<ssh host>`, a Mac on Apple silicon with Homebrew's
  bash and coreutils and Bun at upstream's floor in `~/.bun/bin`; and `CHECK=<path>`, a browser check
  run as `uv run --script "$CHECK" check --plannotator BIN` that exits 0 only when the patches work.
- `ln -s "$PWD/local/rebuild.sh" ~/.local/bin/plannotator-rebuild`
- `git config rerere.enabled true`

## Use

- `plannotator-rebuild --check`: the installed build, the release `mine` is on, and how many
  releases came after it.
- `plannotator-rebuild --replay` (or `--to TAG`): replays `mine` onto the newest release, syncs the
  tree with its Git data to the build host's `~/.cache/plannotator-build/src`, builds it with
  upstream's CI recipe, runs `bun run typecheck`, the Pi extension's vendor step and thirty-seven
  suites in upstream's test sandbox, each test allowed 30 s, since the build host scans each new
  executable at its first exec. `--full` runs upstream's whole unit suite on `mine` and on the
  release's own checkout instead, and stops only on a test that fails on `mine` and passes on the
  release (some of upstream's own tests fail on the build host), and fails again when its file runs
  once more on `mine`; one that passes then is reported as intermittent. The release's result is
  kept per tag and build host, so an unchanged release runs only `mine`'s half. It stages the binary at
  `~/.cache/plannotator-build/plannotator`, and runs the browser check on it. It pushes nothing
  and installs nothing. With `--newer-than REV` and no `--to`, it stops first (exit 5) unless a
  release is newer than REV's.
- `plannotator-rebuild --newest`: fetches the release tags and prints the newest release.
- `plannotator-rebuild --push`: tags `mine` `mine-<release>.<n>` (a commit that has its tag keeps
  it) and pushes `mine` (`--force-with-lease`) and the tag.
- `plannotator-rebuild --install`: installs the staged binary over `~/.local/bin/plannotator` by a
  rename. The binary it replaces is kept as `~/.local/bin/plannotator-previous`.
- `--push` and `--install` accept only a staged binary built from `mine` as it is.
- `plannotator-rebuild` (or `--to TAG`): `--replay`, `--push` and `--install` in one run, in that
  order, each only when the one before it passed.
- The exit status names the outcome: 0 done, 1 failed, 2 a wrong argument, 3 a conflict, 4 a failed
  browser check, 5 no newer release, 75 a transient failure (no network, the build host does not
  answer, or the browser check could not run). The tmux annotate plugin's daily update runs these
  steps in a clone of its own, and reads them.
- A conflict aborts the replay, names the files, and leaves `mine` as it was. Replay by hand
  (`git rebase --onto <new> <old> mine`; rerere remembers each resolution), read
  `git range-diff <old>..<old mine> <new>..mine`, then run `plannotator-rebuild` again.
- `--stage`: build and test `mine` as it is; install nothing.
- `--rollback`: put back `~/.local/bin/plannotator-official`, the official binary kept at the first
  install (and again after `plannotator update`). To go back one build of this fork:
  `mv ~/.local/bin/plannotator-previous ~/.local/bin/plannotator`.

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
