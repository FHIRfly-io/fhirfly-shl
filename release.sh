#!/usr/bin/env bash
set -euo pipefail

DEFAULT_BRANCH="${DEFAULT_BRANCH:-main}"
REMOTE="${REMOTE:-origin}"

die() { echo "Error: $*" >&2; exit 1; }

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Missing required command: $1"
}

is_clean_tree() {
  [[ -z "$(git status --porcelain)" ]]
}

prompt() {
  # prompt "Message" "default"
  local msg="$1"
  local def="${2:-}"
  local input=""
  if [[ -n "$def" ]]; then
    read -r -p "$msg [$def]: " input
    echo "${input:-$def}"
  else
    read -r -p "$msg: " input
    echo "$input"
  fi
}

valid_semver() {
  [[ "$1" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]
}

inc_patch() {
  local v="$1"
  IFS='.' read -r major minor patch <<<"$v"
  patch=$((patch + 1))
  echo "${major}.${minor}.${patch}"
}

# Highest vX.Y.Z tag (ignores pre-releases)
highest_semver_tag() {
  # list tags like v1.2.3, strip v, sort semver, return highest
  git tag -l 'v[0-9]*.[0-9]*.[0-9]*' \
    | sed 's/^v//' \
    | sort -V \
    | tail -n 1
}

pkg_version() {
  node -p "require('./package.json').version"
}

main() {
  require_cmd git
  require_cmd npm
  require_cmd node
  require_cmd sed
  require_cmd sort

  git rev-parse --is-inside-work-tree >/dev/null 2>&1 || die "Not inside a git repository."

  echo "==> Fetching latest from $REMOTE (including tags)..."
  git fetch "$REMOTE" --tags --prune --force

  # Safety: clean working tree
  if ! is_clean_tree; then
    echo "Working tree status:"
    git status --porcelain
    die "Working tree is not clean. Commit/stash your changes before releasing."
  fi

  # Safety: correct branch
  local current_branch
  current_branch="$(git rev-parse --abbrev-ref HEAD)"
  [[ "$current_branch" == "$DEFAULT_BRANCH" ]] || die "You are on '$current_branch' but expected '$DEFAULT_BRANCH'."

  # Safety: up-to-date with remote (no divergence)
  local local_sha remote_sha
  local_sha="$(git rev-parse HEAD)"
  remote_sha="$(git rev-parse "$REMOTE/$DEFAULT_BRANCH")"
  [[ "$local_sha" == "$remote_sha" ]] || die "Local '$DEFAULT_BRANCH' is not aligned with $REMOTE/$DEFAULT_BRANCH. Run: git pull --ff-only $REMOTE $DEFAULT_BRANCH"

  # Determine suggested next version
  local last_tag last_pkg suggested
  last_tag="$(highest_semver_tag || true)"
  last_pkg="$(pkg_version)"

  if [[ -n "$last_tag" ]]; then
    suggested="$(inc_patch "$last_tag")"
    echo "==> Highest semver tag found: v$last_tag"
  else
    # no tags yet: use package.json as base
    if ! valid_semver "$last_pkg"; then
      die "package.json version '$last_pkg' isn't plain semver (X.Y.Z)."
    fi
    suggested="$(inc_patch "$last_pkg")"
    echo "==> No semver tags found. Using package.json version as base: $last_pkg"
  fi

  echo "==> Suggested next version: $suggested (tag: v$suggested)"
  local version
  version="$(prompt "Press Enter to accept, or type a different version" "$suggested")"

  valid_semver "$version" || die "Version must look like X.Y.Z (e.g., 0.1.5). Got: '$version'"

  local tag="v$version"

  # Safety: tag must not already exist locally or remotely
  if git rev-parse "$tag" >/dev/null 2>&1; then
    die "Tag '$tag' already exists locally."
  fi
  if git ls-remote --tags "$REMOTE" | grep -q "refs/tags/$tag$"; then
    die "Tag '$tag' already exists on $REMOTE."
  fi

  echo
  echo "About to release:"
  echo "  Branch : $DEFAULT_BRANCH"
  echo "  Version: $version"
  echo "  Tag    : $tag"
  echo

  local ok
  ok="$(prompt "Type 'yes' to proceed" "no")"
  [[ "$ok" == "yes" ]] || die "Aborted."

  echo "==> Bumping version in package.json (no git tag)..."
  npm version "$version" --no-git-tag-version

  # Verify package.json updated
  local new_pkg
  new_pkg="$(pkg_version)"
  [[ "$new_pkg" == "$version" ]] || die "package.json version is '$new_pkg' after bump, expected '$version'."

  echo "==> Committing version bump..."
  git add package.json
  [[ -f package-lock.json ]] && git add package-lock.json
  [[ -f npm-shrinkwrap.json ]] && git add npm-shrinkwrap.json

  git diff --cached --quiet && die "No staged changes after bump; refusing to create empty commit."

  git commit -m "chore(release): $version"

  echo "==> Pushing '$DEFAULT_BRANCH' to $REMOTE..."
  git push "$REMOTE" "$DEFAULT_BRANCH"

  echo "==> Creating tag '$tag'..."
  git tag "$tag"

  echo "==> Pushing tag '$tag' to $REMOTE..."
  git push "$REMOTE" "$tag"

  echo
  echo "✅ Done: pushed version bump + tag $tag"
  echo
  echo "Next: Go to GitHub → Releases → Draft a new release"
  echo "  - Tag: $tag"
  echo "  - Target: $DEFAULT_BRANCH"
  echo "  - Publish the release (this should trigger npm publish via OIDC)"
  echo
  echo "Sanity check (tagged package.json):"
  echo "  git show $tag:package.json | head -n 20"
}

main "$@"

