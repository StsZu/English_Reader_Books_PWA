#!/bin/zsh
# R031 (specs/015-reader-book-container, SC-06): builds the previous production version — `main` as released, the fixed
# commit OLD below, in a separate worktree that uses this checkout's node_modules (nothing is installed) — and this
# branch, both as production builds, then runs tests/rollback/r031.spec.ts for English and Polish in local WebKit.
# Fails when either language fails. Nothing is published; no request leaves the machine.
set -euo pipefail
OLD=1307f7654f55390d453021b4763e2756d71cedd3
root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root"
head="$(git rev-parse --short HEAD)"
out="build/r031-$head"
old="build/r031-old-wt"
if [[ -d "$old" ]]; then
  [[ "$(git -C "$old" rev-parse HEAD)" == "$OLD" ]] || { echo "$old is not at $OLD" >&2; exit 2; }
  [[ -z "$(git -C "$old" status --porcelain --untracked-files=no)" ]] || { echo "$old has changes" >&2; exit 2; }
else
  git worktree add --detach "$old" "$OLD"
fi
[[ -e "$old/node_modules" ]] || ln -s "$root/node_modules" "$old/node_modules"
mkdir -p "$out"
echo "old $OLD new $(git rev-parse HEAD) node $(node -v) start $(date '+%F %T')" > "$out/run.txt"
failed=0
for lang in en pl; do
  (cd "$old" && APP_LANG=$lang npx vite build --outDir "$root/$out/old-$lang" --emptyOutDir > "$root/$out/build-old-$lang.log" 2>&1)
  APP_LANG=$lang npx vite build --outDir "$out/new-$lang" --emptyOutDir > "$out/build-new-$lang.log" 2>&1
  set +e
  APP_LANG=$lang R031_DIR="$root/$out" R031_OUT="$root/$out/pw-$lang" npx playwright test -c tests/rollback/playwright.config.ts > "$out/$lang.log" 2>&1
  code=$?
  set -e
  echo "$lang exit=$code $(date '+%T')" >> "$out/run.txt"
  [[ $code -eq 0 ]] || failed=1
done
cat "$out/run.txt"
exit $failed
