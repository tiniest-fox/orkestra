#!/bin/bash
#
# Lightweight checks script for subtasks
#
# Similar to checks.sh but scoped to only directly-changed crates:
# - No reverse dependency expansion
# - No workspace-wide build
# - No e2e tests (orkestra-core only added if directly changed)
# - Per-crate clippy instead of --workspace
#
# The parent task's full check stage handles integration verification
# after all subtasks merge.
#
# Usage: .orkestra/scripts/checks-lite.sh [OPTIONS]
#
# Options:
#   --verbose      Show full output (default is minimal pass/fail only)
#
# Exit codes:
#   0 - All checks passed (or nothing to check)
#   1 - One or more checks failed

set -e

# This project uses mise for tool management. Activate it so cargo, node, pnpm
# etc. are available when running from the .app bundle or agent worktrees.
eval "$(mise activate bash --shims)" 2>/dev/null || true

# Parse arguments
VERBOSE=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --verbose|-v)
            VERBOSE=true
            shift
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

# Suppress cargo progress bars in quiet mode (they bypass shell redirection)
if ! $VERBOSE; then
    export CARGO_TERM_PROGRESS_WHEN=never
fi

# =============================================================================
# Lock management for shared target directory
# =============================================================================
# See checks.sh for detailed explanation. Same locking mechanism.

LOCK_DIR="${ORKESTRA_PROJECT_ROOT:-.}/.orkestra/target.lock.d"
LOCK_PID_FILE="$LOCK_DIR/pid"
LOCK_HELD=false

acquire_lock() {
    if $LOCK_HELD; then
        return
    fi

    local max_wait=300  # 5 minutes max wait
    local waited=0

    while ! mkdir "$LOCK_DIR" 2>/dev/null; do
        if [ -f "$LOCK_PID_FILE" ]; then
            local lock_pid=$(cat "$LOCK_PID_FILE" 2>/dev/null)
            if [ -n "$lock_pid" ] && ! kill -0 "$lock_pid" 2>/dev/null; then
                $VERBOSE && echo -e "${YELLOW:-}[WARN]${NC:-} Removing stale lock (PID $lock_pid is dead)"
                rm -rf "$LOCK_DIR"
                continue
            fi
        fi

        if [ $waited -ge $max_wait ]; then
            echo "ERROR: Timed out waiting for target lock after ${max_wait}s"
            exit 1
        fi

        $VERBOSE && echo -e "${BLUE:-}[INFO]${NC:-} Waiting for target lock (held by PID $(cat "$LOCK_PID_FILE" 2>/dev/null || echo "unknown"))..."
        sleep 2
        waited=$((waited + 2))
    done

    echo $$ > "$LOCK_PID_FILE"
    LOCK_HELD=true

    trap 'if $LOCK_HELD; then rm -rf "$LOCK_DIR"; fi' EXIT

    $VERBOSE && echo -e "${BLUE:-}[INFO]${NC:-} Lock acquired, running cargo checks..." || true
}

release_lock() {
    if $LOCK_HELD; then
        rm -rf "$LOCK_DIR"
        LOCK_HELD=false
        $VERBOSE && echo -e "${BLUE:-}[INFO]${NC:-} Lock released" || true
    fi
}

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Track failures
FAILED_CHECKS=()
FAILED_OUTPUTS=()

# Helper functions
info() { $VERBOSE && echo -e "${BLUE}[INFO]${NC} $1" || true; }
success() { echo -e "${GREEN}[PASS]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
fail() { echo -e "${RED}[FAIL]${NC} $1"; }

run_check() {
    local name="$1"
    shift
    local cmd="$@"
    local start_time=$(date +%s)

    if $VERBOSE; then
        echo ""
        echo -e "${BLUE}[INFO]${NC} Running: $name"
        echo "  Command: $cmd"
        echo ""
        if eval "$cmd"; then
            local elapsed=$(( $(date +%s) - start_time ))
            success "$name (${elapsed}s)"
        else
            local elapsed=$(( $(date +%s) - start_time ))
            fail "$name (${elapsed}s)"
            FAILED_CHECKS+=("$name")
        fi
    else
        local output
        local exit_code
        output=$(eval "$cmd" 2>&1) && exit_code=0 || exit_code=$?
        local elapsed=$(( $(date +%s) - start_time ))

        if [ $exit_code -eq 0 ]; then
            success "$name (${elapsed}s)"
        else
            fail "$name (${elapsed}s)"
            FAILED_CHECKS+=("$name")
            FAILED_OUTPUTS+=("$(echo "$output" | tail -50)")
        fi
    fi
}

# =============================================================================
# Detect branches (use ORKESTRA_* env vars if available)
# =============================================================================

get_base_branch() {
    if [ -n "$ORKESTRA_BASE_BRANCH" ]; then
        echo "$ORKESTRA_BASE_BRANCH"
        return
    fi

    for branch in main master; do
        if git rev-parse --verify "$branch" &>/dev/null; then
            echo "$branch"
            return
        fi
    done
    git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@' || echo "main"
}

get_current_branch() {
    if [ -n "$ORKESTRA_BRANCH" ]; then
        echo "$ORKESTRA_BRANCH"
        return
    fi
    git branch --show-current
}

BASE_BRANCH=$(get_base_branch)
CURRENT_BRANCH=$(get_current_branch)

if $VERBOSE; then
    info "Base branch: $BASE_BRANCH"
    info "Current branch: $CURRENT_BRANCH"
    info "Mode: checks-lite (subtask — no reverse deps, no workspace build)"
    if [ -n "$ORKESTRA_TASK_ID" ]; then
        info "Orkestra task: $ORKESTRA_TASK_ID"
        [ -n "$ORKESTRA_TASK_TITLE" ] && info "Task title: $ORKESTRA_TASK_TITLE"
    fi
fi

# =============================================================================
# Get changed files
# =============================================================================

if [ "$CURRENT_BRANCH" = "$BASE_BRANCH" ]; then
    if [ -n "$(git status --porcelain)" ]; then
        info "On primary branch with uncommitted changes - checking working tree"
        CHANGED_FILES=$(git diff --name-only HEAD)
    else
        info "On primary branch - checking last commit"
        CHANGED_FILES=$(git diff --name-only HEAD~1 HEAD 2>/dev/null || echo "")
    fi
else
    MERGE_BASE=$(git merge-base "$BASE_BRANCH" HEAD)
    COMMITTED_CHANGES=$(git diff --name-only "$MERGE_BASE" HEAD)
    UNCOMMITTED_CHANGES=$(git diff --name-only HEAD)
    CHANGED_FILES=$(echo -e "${COMMITTED_CHANGES}\n${UNCOMMITTED_CHANGES}" | sort -u | grep -v '^$' || true)
fi

if [ -z "$CHANGED_FILES" ]; then
    echo "No changes detected - nothing to check"
    exit 0
fi

if $VERBOSE; then
    echo ""
    info "Changed files:"
    echo "$CHANGED_FILES" | sed 's/^/  /'
    echo ""
fi

# =============================================================================
# Categorize changes (no reverse dep expansion)
# =============================================================================

# All workspace crates — used to invalidate mtime fingerprints for ALL crates
# (see touch section below for why all crates must be touched, not just changed ones)
ALL_CRATES=(
    orkestra-types orkestra-schema orkestra-debug orkestra-process
    orkestra-parser orkestra-store orkestra-git orkestra-prompt
    orkestra-utility orkestra-agent orkestra-core
)

# Helper: check if array contains a value
array_contains() {
    local needle="$1"; shift
    for item in "$@"; do [ "$item" = "$needle" ] && return 0; done
    return 1
}

HAS_FRONTEND=false
CHANGED_CRATES=()

while IFS= read -r file; do
    case "$file" in
        src/*|package.json|pnpm-lock.yaml|biome.json|tsconfig*.json|vite.config.ts|vitest.config.ts|tailwind.config.js|postcss.config.js|index.html)
            HAS_FRONTEND=true
            ;;
        crates/*/Cargo.toml|crates/*/build.rs|crates/*/*/*)
            # Compilation-relevant crate files only (excludes root-level docs)
            crate_name="${file#crates/}"
            crate_name="${crate_name%%/*}"
            if ! array_contains "$crate_name" "${CHANGED_CRATES[@]}"; then
                CHANGED_CRATES+=("$crate_name")
            fi
            ;;
    esac
done <<< "$CHANGED_FILES"

HAS_RUST=false
if [ ${#CHANGED_CRATES[@]} -gt 0 ]; then
    HAS_RUST=true
fi

if $VERBOSE; then
    echo "Change categories:"
    echo "  Frontend (src/):        $HAS_FRONTEND"
    echo "  Changed crates:         ${CHANGED_CRATES[*]:-none}"
    echo "  (No reverse dep expansion — parent check handles integration)"
    echo ""
fi

# =============================================================================
# Run checks
# =============================================================================

# Frontend checks
if $HAS_FRONTEND; then
    $VERBOSE && info "=== Frontend Checks ==="

    if [ ! -d "node_modules" ]; then
        run_check "pnpm install" "pnpm install"
    fi

    run_check "Frontend lint+format fix (biome)" "pnpm check:fix"
    run_check "Frontend lint+format verify (biome)" "pnpm check --error-on-warnings"
    run_check "Frontend type check" "pnpm exec tsc --noEmit"
    run_check "Frontend tests" "pnpm test:run"
fi

# Rust checks — only directly-changed crates, no workspace build
if $HAS_RUST; then
    $VERBOSE && info "=== Rust Checks (scoped) ==="

    # Ensure frontend is built (Tauri requires dist/ to exist for clippy)
    if [ ! -d "dist" ]; then
        $VERBOSE && info "Building frontend (required for Tauri build)..."
        if [ ! -d "node_modules" ]; then
            run_check "pnpm install" "pnpm install"
        fi
        run_check "Frontend build" "pnpm build"
    fi

    # Auto-format (no compilation, no lock needed)
    run_check "Cargo fmt fix" "cargo fmt --all"
    run_check "Cargo fmt verify" "cargo fmt --all --check"

    # Acquire lock for cargo commands that use the shared target/ directory
    acquire_lock

    # Invalidate mtime fingerprints for ALL workspace crates, not just changed ones.
    # Dependency crates (e.g. orkestra-types) may have stale binaries in the shared
    # target/ directory compiled by another worktree with different type definitions.
    # Touching only changed crates leaves those stale dependency binaries in place —
    # cargo sees them as "Fresh" and uses them, causing spurious compile errors.
    # sccache provides content-based hits so unchanged files compile instantly.
    if [ -L "target" ]; then
        for crate in "${ALL_CRATES[@]}"; do
            touch "crates/$crate/src/lib.rs"
        done
        touch cli/src/main.rs
        touch src-tauri/src/main.rs
    fi

    # Per-crate clippy (not --workspace)
    for crate in "${CHANGED_CRATES[@]}"; do
        run_check "$crate clippy fix" "cargo clippy --fix -p $crate --all-targets --allow-dirty --allow-staged"
        run_check "$crate clippy verify" "cargo clippy -p $crate --all-targets -- -D warnings"
    done

    # Per-crate tests (no reverse deps, no e2e)
    for crate in "${CHANGED_CRATES[@]}"; do
        run_check "$crate tests" "cargo test -p $crate"
    done

    # No cargo build --workspace — parent check handles that

    release_lock
fi

# =============================================================================
# Summary
# =============================================================================

echo ""
echo "=========================================="

if [ ${#FAILED_CHECKS[@]} -eq 0 ]; then
    success "All checks passed!"
    exit 0
else
    fail "Some checks failed:"
    for i in "${!FAILED_CHECKS[@]}"; do
        echo ""
        echo -e "${RED}--- ${FAILED_CHECKS[$i]} ---${NC}"
        if [ -n "${FAILED_OUTPUTS[$i]:-}" ]; then
            echo "${FAILED_OUTPUTS[$i]}"
        fi
    done
    exit 1
fi
