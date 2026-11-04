#!/usr/bin/env bash
set -euo pipefail

# Run against a clean CI checkout or a disposable local copy: npm ci replaces node_modules.
workspace="${1:?Usage: ci-browser.sh WORKSPACE [Playwright options]}"
shift
workspace="$(cd -- "$workspace" && pwd)"
repo="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
image="$(cat "$repo/.github/ci-browser-image.txt")"
cache="${CI_BROWSER_NPM_CACHE:-${RUNNER_TEMP:-/tmp}/endeavor-ci-browser-npm}"
mkdir -p -- "$cache"
cache="$(cd -- "$cache" && pwd)"
container="endeavor-ci-browser-${BASHPID}-${RANDOM}"

cleanup() {
  docker rm --force "$container" >/dev/null 2>&1 || true
  if [[ -n "${docker_pid:-}" ]]; then wait "$docker_pid" 2>/dev/null || true; fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

docker pull "$image"
docker run --rm --init --ipc=host --pull=never --name "$container" \
  --mount "type=bind,source=$workspace,target=/work" \
  --mount "type=bind,source=$cache,target=/root/.npm" \
  --workdir /work \
  --env CI=true --env "CI_BROWSER_IMAGE=$image" \
  "$image" bash -euo pipefail -c '
    node <<"NODE"
const fs = require("node:fs");
const expectedNodeMajor = fs.readFileSync(".nvmrc", "utf8").trim().replace(/^v/, "").split(".")[0];
if (process.versions.node.split(".")[0] !== expectedNodeMajor) {
  throw new Error(`CI browser image must provide Node ${expectedNodeMajor}; found ${process.version}`);
}
const expectedPlaywright = JSON.parse(fs.readFileSync("apps/web/package.json", "utf8")).devDependencies["@playwright/test"];
if (!process.env.CI_BROWSER_IMAGE.startsWith(`mcr.microsoft.com/playwright:v${expectedPlaywright}-noble@sha256:`)) {
  throw new Error("Update .github/ci-browser-image.txt to match the pinned Playwright version");
}
console.log(`CI browser runtime: Node ${process.version}, Playwright ${expectedPlaywright}`);
NODE
    phase() {
      local name="$1" start=$SECONDS
      shift
      "$@"
      printf "CI phase %s: %ss\n" "$name" "$((SECONDS - start))"
    }
    phase dependencies npm ci --workspace=apps/web --include-workspace-root=false --no-audit --no-fund
    phase build npm run build --workspace=apps/web
    phase browser npm run test:e2e --workspace=apps/web -- "$@"
  ' ci-browser "$@" &
docker_pid=$!
# A signal interrupts wait immediately, so cancellation can remove the container promptly.
wait "$docker_pid"
