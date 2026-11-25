#!/usr/bin/env bash
# plannotator-rebuild: Plannotator's release with this fork's patches replayed on it, built and
# tested on the build host, checked in a browser here, pushed, and installed over ~/.local/bin/plannotator.
#
#   plannotator-rebuild --check      the installed build, the release `mine` is on, the newest release
#   plannotator-rebuild [--to TAG]   --replay, --push and --install, in that order, in one run
#   plannotator-rebuild --replay [--to TAG] [--newer-than REV]
#                                    replay `mine` onto TAG (default: the newest release), build, test,
#                                    stage the binary and check it; push and install nothing.
#                                    --newer-than: stop unless a release is newer than REV's
#   plannotator-rebuild --push       tag `mine` mine-<release>.<n> (once a commit), push it and the tag
#   plannotator-rebuild --install    install the staged binary; the one it replaces is kept as
#                                    plannotator-previous
#   plannotator-rebuild --stage      build and test `mine` as it is and stage the binary; install nothing
#   plannotator-rebuild --rollback   put the official binary back
#   --full                           test with upstream's whole unit suite, not only the patches' suites
#
# --push and --install accept only a staged binary built from `mine` as it is.
# Exit status: 0 done; 1 failed; 2 a wrong argument; 3 the patches conflict with the release (mine is
# unchanged); 4 the browser check failed; 5 no release is newer than REV's; 75 a transient failure (no
# network, the build host does not answer, or the browser check could not run).
#
# local/build.env (git-ignored) sets BUILD_HOST (an ssh host with Bun in ~/.bun/bin) and CHECK (the
# browser check, run as `uv run --script "$CHECK" check --plannotator BIN`). See local/README.md.
set -euo pipefail

here=$(dirname "$(realpath "${BASH_SOURCE[0]}")")
repo=$(dirname "$here")
# shellcheck source=/dev/null
source "$here/build.env"
: "${BUILD_HOST:?set BUILD_HOST in local/build.env}" "${CHECK:?set CHECK in local/build.env}"

bin=$HOME/.local/bin/plannotator
official=$HOME/.local/bin/plannotator-official
previous=$HOME/.local/bin/plannotator-previous
staged=$HOME/.cache/plannotator-build/plannotator
# Release tags come from the `upstream` remote, or from this address where a clone has none.
upstream_url=https://github.com/backnotprop/plannotator.git
config=$HOME/.plannotator/config.json
root=.cache/plannotator-build   # on the build host, under its home
suites=(
  packages/ui/components/html-viewer/srcdoc.test.ts
  packages/ui/components/html-viewer/htmlPinpointProtocol.test.tsx
  packages/core/html-anchor.test.ts
  packages/ui/utils/parser.test.ts
  packages/ui/components/html-viewer/HtmlViewer.reopenComment.test.tsx
  packages/editor/hooks/useDocumentHistory.test.tsx
  packages/editor/frameStorage.test.ts
  packages/ui/components/html-viewer/sandboxShim.test.ts
  packages/ui/components/html-viewer/HtmlViewer.frameHost.test.tsx
  packages/ui/components/html-viewer/linkGuard.test.ts
  packages/server/reference-handlers.test.ts
  packages/ui/components/DocBadges.test.tsx
  packages/ui/components/TableOfContents.linkedDoc.test.tsx
  packages/ui/components/HtmlSurfaceControls.test.tsx
  packages/editor/App.bundleBackScroll.test.tsx
  packages/editor/App.annotateView.test.tsx
  packages/ui/hooks/useVimSelection.test.tsx
  packages/ui/components/Viewer.vimMode.integration.test.tsx
  packages/editor/App.htmlChrome.test.tsx
  packages/server/close-tab.test.ts
  packages/ui/hooks/useAutoClose.test.tsx
  packages/ui/hooks/useInputMethodSwitch.test.tsx
  packages/ui/utils/annotationModes.test.ts
  packages/editor/App.decisionControl.test.tsx
  packages/ui/utils/inputMethod.test.ts
  packages/ui/shortcuts.test.ts
  apps/hook/server/annotate-command.test.ts
  packages/ui/utils/themeContrast.test.ts
  packages/ui/components/html-viewer/bridgePagePlace.test.ts
  packages/ui/components/html-viewer/HtmlViewer.pagePlace.test.tsx
  packages/ui/components/html-viewer/HtmlViewer.frameScale.test.tsx
  apps/hook/server/plan-review-gate.test.ts
  apps/hook/hooks/mod/plan-review-gate.test.ts
  tests/windows-hide-guard.test.ts
  tests/parity/route-parity.test.ts
  tests/parity/vendor-parity.test.ts
  apps/pi-extension/server/close-tab-route.test.ts
)
# Files upstream's sandbox refuses to run (scripts/test-sandbox.ts REFUSED).
refused=(apps/pi-extension/inbox.test.ts tests/never-touch-the-real-inbox.test.ts)

# The build host's half, uploaded on every run: `host.sh STEP ARGS`, with its own time limit there.
host_script=$(cat <<'HOST'
set -euo pipefail
export PATH="$HOME/.bun/bin:/opt/homebrew/bin:$PATH"
ulimit -n 10240
root=$HOME/.cache/plannotator-build
step=$1
shift
case $step in
  bun) bun --version ;;
  pin) # stdin: a tar of release $1's tree. Keeps the viewer pin built from it as $root/pin-$1.ts.
    rm -rf "$root/pin-src" && mkdir -p "$root/pin-src"
    tar -x -C "$root/pin-src"
    exec </dev/null
    cd "$root/pin-src"
    bun install --frozen-lockfile
    bun run build:viewer-pin
    mv packages/core/guide-viewer-manifest.ts "$root/pin-$1.ts"
    cd "$root" && rm -rf pin-src ;;
  build) # $1: the version, $2: the viewer pin to embed (a file in $root, or "fallback")
    exec </dev/null
    cd "$root/src"
    bun install --frozen-lockfile
    bun scripts/require-bun.ts
    rm -f packages/core/guide-viewer-manifest.ts
    if [[ $2 == fallback ]]; then
      bun apps/guides-show/build/sync-manifest.ts --if-missing
    else
      cp "$root/$2" packages/core/guide-viewer-manifest.ts
    fi
    bun run build:review
    bun run build:hook
    mkdir -p "$root/out"
    bun build apps/hook/server/index.ts --compile --no-compile-autoload-bunfig --target=bun-darwin-arm64 \
      --define "__CLI_VERSION__=\"$1\"" --outfile "$root/out/plannotator" ;;
  test) # stdin: test files, one a line. Typecheck, then those files in upstream's sandbox, after the
    # Pi extension's generated copies, as upstream's CI makes them. This host scans each new executable
    # at its first exec, so a test's default 5 s is raised to 30 s (the slowest that passed took 12 s).
    mapfile -t files
    exec </dev/null
    cd "$root/src"
    bun run typecheck
    bash apps/pi-extension/vendor.sh
    bun run test:sandbox "${files[@]}" -- --timeout=30000 ;;
  *) echo "host.sh: unknown step $step" >&2; exit 2 ;;
esac
HOST
)

die() { echo "plannotator-rebuild: $*" >&2; exit 1; }
# Stops with exit status $1 (see the header).
stop() {
  local code=$1
  shift
  echo "plannotator-rebuild: $*" >&2
  exit "$code"
}
g() { git -C "$repo" "$@"; }
# A step on the build host, stopped there after $1 seconds, and here 30 seconds later.
on_host() {
  local seconds=$1
  shift
  gtimeout $((seconds + 30)) ssh "$BUILD_HOST" gtimeout "$seconds" bash "$root/host.sh" "$@"
}
releases() { g tag -l 'v*' --sort=v:refname | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$'; }
base_release() { g describe --tags --abbrev=0 --match 'v[0-9]*' --exclude '*-*' "${1:-mine}"; }
fetch_releases() {
  local from=upstream
  g remote get-url upstream >/dev/null 2>&1 || from=$upstream_url
  gtimeout 120 git -C "$repo" fetch --quiet --no-tags "$from" 'refs/tags/v*:refs/tags/v*'
}

show_status() {
  fetch_releases
  local base newest behind
  base=$(base_release)
  newest=$(releases | tail -n 1)
  behind=$(releases | awk -v b="$base" 'seen {n++} $0 == b {seen = 1} END {print n + 0}')
  echo "installed: $("$bin" --version 2>/dev/null || echo none)"
  echo "mine:      on $base"
  echo "upstream:  newest release $newest, $behind release(s) after $base"
}

preflight_tree() {
  [[ $(g branch --show-current) == mine ]] || die "check out mine first"
  [[ -z $(g status --porcelain) ]] || die "the working tree has changes: commit or stash them"
}

preflight_host() {
  gtimeout 30 ssh "$BUILD_HOST" "mkdir -p $root && cat > $root/host.sh" <<<"$host_script" ||
    stop 75 "the build host $BUILD_HOST does not answer"
  local have floor
  have=$(on_host 60 bun </dev/null) || die "no Bun in ~/.bun/bin on $BUILD_HOST"
  floor=$(sed -nE 's/^export const MIN_BUN_VERSION = "([0-9.]+)";$/\1/p' "$repo/scripts/check-bun-runtime-trust.ts")
  [[ -n $floor && $(printf '%s\n%s\n' "$floor" "$have" | sort -V | head -n 1) == "$floor" ]] ||
    die "Bun $have on $BUILD_HOST is below the floor ${floor:-?}"
}

# An official binary at $bin becomes the rollback copy (on the first install, and after `plannotator update`).
keep_official() {
  local v tmp
  v=$("$bin" --version 2>/dev/null) || return 0
  [[ $v == *+mine.* ]] && return 0
  [[ -x $official && $("$official" --version 2>/dev/null) == "$v" ]] && return 0
  tmp=$(mktemp "$official.XXXXXX")
  cp -p "$bin" "$tmp" && mv -f "$tmp" "$official"
  echo "kept the official $v as $official"
}

# Puts `mine` on release $1. A conflict leaves `mine` as it was.
replay() {
  local target=$1 base old files
  base=$(base_release)
  [[ $target == "$base" ]] && return 0
  g rev-parse -q --verify "refs/tags/$target^{commit}" >/dev/null || die "no release tag $target"
  old=$(g rev-parse mine)
  if ! g rebase --onto "$target" "$base" mine; then
    files=$(g diff --name-only --diff-filter=U | tr '\n' ' ')
    g rebase --abort
    stop 3 "the patches conflict with $target in: $files(mine is unchanged; replay by hand: git rebase --onto $target $base mine)"
  fi
  echo "mine replayed from $base onto $target; compare: git range-diff $base..$old $target..mine"
}

# The values of a GUIDE_VIEWER_MANIFEST literal on stdin, `key value` a line.
pin_values() {
  awk '/GUIDE_VIEWER_MANIFEST.* = [{]/ {n = 5}
       n-- > 0 && match($0, /(js|css|jsIntegrity|cssIntegrity): "[^"]+"/) {
         split(substr($0, RSTART, RLENGTH), kv, /: "/); sub(/"$/, "", kv[2]); print kv[1], kv[2] }'
}

# The viewer pin the build embeds: release $1's own, built from a clean tree of the tag, when
# guides.show serves both of its files with the pinned integrity (a viewer built from these commits
# is published nowhere); otherwise upstream's fallback pin.
viewer_pin() {
  local release=$1 file="pin-$1.ts" values kind name want got
  if ! gtimeout 30 ssh "$BUILD_HOST" test -f "$root/$file"; then
    g archive --format=tar "$release" | on_host 1500 pin "$release" >&2
  fi
  values=$(gtimeout 30 ssh "$BUILD_HOST" cat "$root/$file" | pin_values)
  for kind in js css; do
    name=$(awk -v k="$kind" '$1 == k {print $2}' <<<"$values")
    want=$(awk -v k="${kind}Integrity" '$1 == k {print $2}' <<<"$values")
    got=''
    if [[ $name =~ ^viewer\.[A-Za-z0-9_-]+\.(js|css)$ ]]; then
      got=$({ gtimeout 60 curl -fsS --max-time 30 -A "OpenAI File Downloader, XaiImageApiFetch/1.0" \
        "https://guides.show/v1/$name" || true; } | openssl dgst -sha384 -binary | base64)
    fi
    if [[ -z $got || $want != "sha384-$got" ]]; then
      echo "viewer pin: guides.show does not serve $release's ${name:-viewer} as pinned; embedding upstream's fallback pin" >&2
      echo fallback
      return 0
    fi
  done
  echo "$file"
}

# Builds and tests `mine` (on release $1) on the build host, and stages the binary here.
build() {
  local release=$1 version pin try rc
  version="${release#v}+mine.$(g rev-parse --short=7 mine)"
  # With .git: the suites that read Git (`git ls-files`, the release tags) run in a checkout, as on CI.
  # A `git gc` that Git starts by itself after a command can repack while the copy runs; rsync then
  # says files vanished (24), and the copy is tried again once Git is done.
  for try in 1 2 3; do
    rc=0
    gtimeout 900 rsync -a --delete --exclude=node_modules/ --exclude=dist/ \
      --exclude=/local/build.env "$repo/" "$BUILD_HOST:$root/src/" || rc=$?
    [[ $rc == 24 && $try != 3 ]] || break
    sleep 10
  done
  ((rc == 0)) || die "the copy to $BUILD_HOST failed (rsync $rc)"
  pin=$(viewer_pin "$release")
  on_host 2400 build "$version" "$pin" </dev/null
  if ((full)); then
    g ls-files '*.test.ts' '*.test.tsx' | grep -vxF "${refused[@]/#/-e}" | on_host 7200 test
  else
    printf '%s\n' "${suites[@]}" | on_host 2400 test
  fi
  mkdir -p "$(dirname "$staged")"
  gtimeout 300 rsync -a "$BUILD_HOST:$root/out/plannotator" "$staged"
  [[ $("$staged" --version) == "plannotator $version" ]] || die "the staged binary does not report $version"
  echo "staged: $staged ($version)"
}

# Puts binary $1 at $2 (default $bin) by a rename in its directory, so a running session keeps its
# own file. Its date is kept: the browser check records its verdict by the binary's date and size,
# which the annotate plugin's doctor compares with the installed one.
install_bin() {
  local to=${2:-$bin} tmp
  tmp=$(mktemp "$to.XXXXXX")
  cp -p "$1" "$tmp" && chmod 755 "$tmp" && mv -f "$tmp" "$to"
}

# The version the staged binary prints when it was built from `mine` as it is now; else stops.
staged_version() {
  local want
  want="plannotator $(base_release | sed 's/^v//')+mine.$(g rev-parse --short=7 mine)"
  [[ -x $staged && $("$staged" --version 2>/dev/null) == "$want" ]] ||
    die "the staged binary is not the build of mine as it is ($want): run plannotator-rebuild --replay"
  echo "$want"
}

# The browser check on the staged binary: its exit 1 is a failed probe, its 2 a check that could not run.
check_staged() {
  local rc=0
  gtimeout 900 uv run --script "$CHECK" check --plannotator "$staged" || rc=$?
  case $rc in
    0) ;;
    1) stop 4 "the browser check failed on $staged; nothing pushed or installed" ;;
    2) stop 75 "the browser check could not run; nothing pushed or installed" ;;
    *) die "the browser check stopped (rc $rc); nothing pushed or installed" ;;
  esac
}

# autoUpdate and updateCheck off in Plannotator's config, every other key kept.
updates_off() {
  python3 - "$config" <<'PY'
import json, os, sys, tempfile
path = sys.argv[1]
try:
    with open(path) as f:
        config = json.load(f)
except FileNotFoundError:
    config = {}
if config.get("autoUpdate") is False and config.get("updateCheck") is False:
    sys.exit(0)
config.update(autoUpdate=False, updateCheck=False)
os.makedirs(os.path.dirname(path), exist_ok=True)
fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path), prefix=".config.json.")
with os.fdopen(fd, "w") as f:
    json.dump(config, f, indent=2)
    f.write("\n")
os.replace(tmp, path)
PY
}

# Replays `mine` onto release $1, then builds, tests, stages and checks it.
replay_and_stage() {
  local target=$1
  replay "$target"
  preflight_host
  build "$(base_release)"
  check_staged
}

# Tags the staged build's commit mine-<release>.<n>, once: a commit that has its tag keeps it. Then
# pushes `mine` (with a lease on the fetched origin/mine) and the tag.
push_mine() {
  local version tag n
  version=$(staged_version)
  version=${version#plannotator }
  version=${version%%+*}
  gtimeout 60 git -C "$repo" ls-remote --exit-code origin refs/heads/mine >/dev/null ||
    stop 75 "origin does not answer; nothing pushed"
  tag=$(g tag --points-at mine -l "mine-$version.*" --sort=v:refname | tail -n 1)
  if [[ -z $tag ]]; then
    n=$(g tag -l "mine-$version.*" | sed -n "s/^mine-$version\.\([0-9][0-9]*\)\$/\1/p" | sort -n | tail -n 1)
    tag="mine-$version.$((${n:-0} + 1))"
    g tag -a "$tag" -m "$("$staged" --version), pushed $(date -u +%Y-%m-%dT%H:%M:%SZ)" mine
  fi
  gtimeout 120 git -C "$repo" push --force-with-lease origin mine ||
    die "the push of mine failed: origin's mine moved since the fetch, or the network went"
  gtimeout 120 git -C "$repo" push origin "refs/tags/$tag" || die "the push of $tag failed"
  echo "pushed mine and $tag"
}

# Installs the staged build of `mine`. The binary it replaces is kept as plannotator-previous (an
# official one also as plannotator-official), unless it is that same build.
install_staged() {
  local version
  version=$(staged_version)
  keep_official
  if [[ -x $bin && $("$bin" --version 2>/dev/null) != "$version" ]]; then
    install_bin "$bin" "$previous"
    echo "kept $("$previous" --version 2>/dev/null) as $previous"
  fi
  updates_off
  install_bin "$staged"
  echo "installed $("$bin" --version)"
}

mode=all to='' newer_than='' full=0
while (($#)); do
  case $1 in
    --check) mode=check ;;
    --replay) mode=replay ;;
    --push) mode=push ;;
    --install) mode=install ;;
    --stage) mode=stage ;;
    --rollback) mode=rollback ;;
    --to) to=${2:?--to needs a release tag}; shift ;;
    --newer-than) newer_than=${2:?--newer-than needs a commit}; shift ;;
    --full) full=1 ;;
    -h | --help) awk 'NR > 1 && !/^#/ {exit} NR > 1 {sub(/^# ?/, ""); print}' "$0"; exit 0 ;;
    *) stop 2 "unknown argument: $1 (see --help)" ;;
  esac
  shift
done
[[ -z $newer_than || ($mode == replay && -z $to) ]] || stop 2 "--newer-than goes with --replay and no --to"

case $mode in
  check) show_status ;;
  rollback)
    [[ -x $official ]] || die "no official copy at $official"
    install_bin "$official"
    echo "installed $("$bin" --version)" ;;
  stage)
    preflight_tree
    preflight_host
    fetch_releases || stop 75 "the release tags cannot be fetched"
    build "$(base_release)" ;;
  push) preflight_tree; push_mine ;;
  install) preflight_tree; install_staged ;;
  replay | all)
    preflight_tree
    fetch_releases || stop 75 "the release tags cannot be fetched"
    target=${to:-$(releases | tail -n 1)}
    if [[ -n $newer_than ]]; then
      since=$(base_release "$newer_than") || die "no release tag below $newer_than"
      [[ $since != "$target" ]] || stop 5 "no release is newer than $target, the release of $newer_than"
    fi
    replay_and_stage "$target"
    [[ $mode == replay ]] && exit 0
    push_mine
    install_staged ;;
esac
