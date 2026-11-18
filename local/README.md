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
  `bun run typecheck` and the patches' four suites in upstream's test sandbox (`--full`: every unit
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
  release tag and embedded only when it equals the official binary's; otherwise upstream's fallback
  pin (an older published viewer) is.

## A pull request from a patch

```sh
git fetch upstream
git switch -c fix/<name> upstream/main
git cherry-pick <the patch's commit on mine>
bun run test:sandbox <its suites> && bun run typecheck
git push -u origin fix/<name>   # then open the PR against backnotprop/plannotator
```
