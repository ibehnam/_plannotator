#!/usr/bin/env bash
# plannotator-rebuild: Plannotator's release with this fork's patches replayed on it, built and
# tested on the build host, checked in a browser here, and installed over ~/.local/bin/plannotator.
#
#   plannotator-rebuild --check      the installed build, the release `mine` is on, the newest release
#   plannotator-rebuild [--to TAG]   replay `mine` onto TAG (default: the newest release), build,
#                                    test, check, then install, tag and push
#   plannotator-rebuild --stage      build and test `mine` as it is and stage the binary; install nothing
#   plannotator-rebuild --rollback   put the official binary back
#   --full                           test with upstream's whole unit suite, not only the patches' suites
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
staged=$HOME/.cache/plannotator-build/plannotator
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
  test) # stdin: test files, one a line. Typecheck, then those files in upstream's sandbox.
    mapfile -t files
    exec </dev/null
    cd "$root/src"
    bun run typecheck
    bun run test:sandbox "${files[@]}" ;;
  *) echo "host.sh: unknown step $step" >&2; exit 2 ;;
esac
HOST
)

die() { echo "plannotator-rebuild: $*" >&2; exit 1; }
g() { git -C "$repo" "$@"; }
# A step on the build host, stopped there after $1 seconds, and here 30 seconds later.
on_host() {
  local seconds=$1
  shift
  gtimeout $((seconds + 30)) ssh "$BUILD_HOST" gtimeout "$seconds" bash "$root/host.sh" "$@"
}
releases() { g tag -l 'v*' --sort=v:refname | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$'; }
base_release() { g describe --tags --abbrev=0 --match 'v[0-9]*' --exclude '*-*' mine; }
fetch_releases() { gtimeout 120 git -C "$repo" fetch --quiet --no-tags upstream 'refs/tags/v*:refs/tags/v*'; }

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

preflight() {
  [[ $(g branch --show-current) == mine ]] || die "check out mine first"
  [[ -z $(g status --porcelain) ]] || die "the working tree has changes: commit or stash them"
  gtimeout 30 ssh "$BUILD_HOST" "mkdir -p $root && cat > $root/host.sh" <<<"$host_script" ||
    die "the build host $BUILD_HOST does not answer"
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
    die "the patches conflict with $target in: $files(mine is unchanged; replay by hand: git rebase --onto $target $base mine)"
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
  local release=$1 version pin
  version="${release#v}+mine.$(g rev-parse --short=7 mine)"
  gtimeout 300 rsync -a --delete --exclude=.git/ --exclude=node_modules/ --exclude=dist/ \
    --exclude=/local/build.env "$repo/" "$BUILD_HOST:$root/src/"
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

# Puts binary $1 at $bin by a rename in its directory, so a running session keeps its own file. Its
# date is kept: the browser check records its verdict by the binary's date and size, which the
# annotate plugin's doctor compares with the installed one.
install_bin() {
  local tmp
  tmp=$(mktemp "$bin.XXXXXX")
  cp -p "$1" "$tmp" && chmod 755 "$tmp" && mv -f "$tmp" "$bin"
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

tag_and_push() {
  local version=${1#v} n
  n=$(($(g tag -l "mine-$version.*" | wc -l) + 1))
  g tag -a "mine-$version.$n" -m "$("$bin" --version), installed $(date -u +%Y-%m-%dT%H:%M:%SZ)" mine
  gtimeout 120 git -C "$repo" push --force-with-lease origin mine
  gtimeout 120 git -C "$repo" push origin "refs/tags/mine-$version.$n"
  echo "installed $("$bin" --version), tagged mine-$version.$n"
}

mode=install to='' full=0
while (($#)); do
  case $1 in
    --check) mode=check ;;
    --stage) mode=stage ;;
    --rollback) mode=rollback ;;
    --to) to=${2:?--to needs a release tag}; shift ;;
    --full) full=1 ;;
    -h | --help) sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "unknown argument: $1 (see --help)" ;;
  esac
  shift
done

case $mode in
  check) show_status ;;
  rollback)
    [[ -x $official ]] || die "no official copy at $official"
    install_bin "$official"
    echo "installed $("$bin" --version)" ;;
  stage | install)
    preflight
    fetch_releases
    keep_official
    [[ $mode == stage ]] || replay "${to:-$(releases | tail -n 1)}"
    release=$(base_release)
    build "$release"
    [[ $mode == stage ]] && exit 0
    gtimeout 900 uv run --script "$CHECK" check --plannotator "$staged" || die "the browser check did not pass; nothing installed"
    updates_off
    install_bin "$staged"
    tag_and_push "$release" ;;
esac
