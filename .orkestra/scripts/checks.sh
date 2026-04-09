#!/bin/bash
#
# Smart automated checks script
#
# Detects what changed on the current branch compared to main and runs
# only the relevant checks. This keeps CI fast while ensuring quality.
#
# Usage: .orkestra/scripts/checks.sh [OPTIONS]
#
# Options:
#   --all          Run all checks regardless of what changed
#   --last-commit  Check changes from last commit (useful for testing on main)
#   --frontend     Force run frontend checks
#   --rust         Force run all Rust checks
#   --verbose      Show full output (default is minimal pass/fail only)
#
# Exit codes:
#   0 - All checks passed (or nothing to check)
#   1 - One or more checks failed
#
# Locking:
#   Uses mkdir-based locking to serialize cargo commands across worktrees.
#   Multiple worktrees share the same target/ directory, and concurrent
#   cargo runs can cause spurious failures. The lock is acquired only for
#   cargo commands (clippy, test, build) — frontend checks and cargo fmt
#   run without it. The lock is released explicitly after the last cargo
#   command, with an EXIT trap as a safety net.

set -e

# This project uses mise for tool management. Activate it so cargo, node, pnpm
# etc. are available when running from the .app bundle or agent worktrees.
command -v mise &>/dev/null && eval "$(mise activate bash --shims)" || true

# Parse arguments
FORCE_ALL=false
CHECK_LAST_COMMIT=false
FORCE_FRONTEND=false
FORCE_RUST=false
VERBOSE=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --all)
            FORCE_ALL=true
            shift
            ;;
        --last-commit)
            CHECK_LAST_COMMIT=true
            shift
            ;;
        --frontend)
            FORCE_FRONTEND=true
            shift
            ;;
        --rust)
            FORCE_RUST=true
            shift
            ;;
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
# Multiple worktrees share the same target/ directory. Two problems arise:
# 1. Concurrent cargo runs can corrupt build artifacts (solved by the lock below).
# 2. Sequential runs can serve stale binaries from other worktrees because cargo's
#    mtime-based fingerprinting sees binaries compiled by worktree A as "Fresh" when
#    worktree B's source files are older (solved by touching crate roots before build).
# The lock is acquired only around cargo clippy/test/build commands —
# frontend checks and cargo fmt don't need it.
#
# Uses mkdir-based locking (atomic on POSIX) with PID tracking for stale lock detection.
# Works on both Linux and macOS without requiring flock.

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
        # Check if lock holder is still alive
        if [ -f "$LOCK_PID_FILE" ]; then
            local lock_pid=$(cat "$LOCK_PID_FILE" 2>/dev/null)
            if [ -n "$lock_pid" ] && ! kill -0 "$lock_pid" 2>/dev/null; then
                # Stale lock - holder is dead
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

    # Write our PID to the lock
    echo $$ > "$LOCK_PID_FILE"
    LOCK_HELD=true

    # Safety net: release lock on exit if we didn't release it explicitly
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
        # Quiet mode: capture output, only show on failure
        local output
        local exit_code
        output=$(eval "$cmd" 2>&1) && exit_code=0 || exit_code=$?
        local elapsed=$(( $(date +%s) - start_time ))

        if [ $exit_code -eq 0 ]; then
            success "$name (${elapsed}s)"
        else
            fail "$name (${elapsed}s)"
            FAILED_CHECKS+=("$name")
            # Store truncated output for summary (last 50 lines)
            FAILED_OUTPUTS+=("$(echo "$output" | tail -50)")
        fi
    fi
}

# =============================================================================
# Detect branches (use ORKESTRA_* env vars if available)
# =============================================================================

get_base_branch() {
    # When running under Orkestra, use the explicit base branch
    if [ -n "$ORKESTRA_BASE_BRANCH" ]; then
        echo "$ORKESTRA_BASE_BRANCH"
        return
    fi

    # Manual runs: try common primary branch names
    for branch in main master; do
        if git rev-parse --verify "$branch" &>/dev/null; then
            echo "$branch"
            return
        fi
    done
    # Fallback: use the default branch from remote
    git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@' || echo "main"
}

get_current_branch() {
    # Use ORKESTRA env var if set (when running as gate script)
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

    # Show Orkestra context if running as gate script
    if [ -n "$ORKESTRA_TASK_ID" ]; then
        info "Orkestra task: $ORKESTRA_TASK_ID"
        [ -n "$ORKESTRA_TASK_TITLE" ] && info "Task title: $ORKESTRA_TASK_TITLE"
    fi
fi

# =============================================================================
# Get changed files
# =============================================================================

# Handle --all flag
if $FORCE_ALL; then
    info "Running all checks (--all flag)"
    CHANGED_FILES="(all)"
elif $CHECK_LAST_COMMIT; then
    info "Checking last commit (--last-commit flag)"
    CHANGED_FILES=$(git diff --name-only HEAD~1 HEAD 2>/dev/null || echo "")
elif [ "$CURRENT_BRANCH" = "$BASE_BRANCH" ]; then
    # On primary branch - check uncommitted changes or last commit
    if [ -n "$(git status --porcelain)" ]; then
        info "On primary branch with uncommitted changes - checking working tree"
        CHANGED_FILES=$(git diff --name-only HEAD)
    else
        info "On primary branch - checking last commit"
        CHANGED_FILES=$(git diff --name-only HEAD~1 HEAD 2>/dev/null || echo "")
    fi
else
    # On feature branch - compare to primary branch
    MERGE_BASE=$(git merge-base "$BASE_BRANCH" HEAD)
    # Include both committed changes (merge-base to HEAD) and uncommitted changes
    COMMITTED_CHANGES=$(git diff --name-only "$MERGE_BASE" HEAD)
    UNCOMMITTED_CHANGES=$(git diff --name-only HEAD)
    CHANGED_FILES=$(echo -e "${COMMITTED_CHANGES}\n${UNCOMMITTED_CHANGES}" | sort -u | grep -v '^$' || true)
fi

if [ -z "$CHANGED_FILES" ] && ! $FORCE_FRONTEND && ! $FORCE_RUST; then
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
# Categorize changes
# =============================================================================

# All workspace crates (update when adding new crates)
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

# Transitive reverse dependency map.
# Given a changed crate, returns all crates whose tests could be affected.
# Hardcoded for speed — update when inter-crate dependencies change.
#
# Dependency graph (leaf → root):
#   types, schema, debug, process, git  (leaves)
#   parser(types), store(types), prompt(schema,types), utility(process,types)
#   agent(debug, parser, process, types)
#   core(ALL above)
reverse_deps_of() {
    case "$1" in
        orkestra-types)   echo "orkestra-parser orkestra-store orkestra-prompt orkestra-utility orkestra-agent orkestra-core" ;;
        orkestra-schema)  echo "orkestra-prompt orkestra-core" ;;
        orkestra-debug)   echo "orkestra-agent orkestra-core" ;;
        orkestra-process) echo "orkestra-utility orkestra-agent orkestra-core" ;;
        orkestra-parser)  echo "orkestra-agent orkestra-core" ;;
        orkestra-store)   echo "orkestra-core" ;;
        orkestra-git)     echo "orkestra-core" ;;
        orkestra-prompt)  echo "orkestra-core" ;;
        orkestra-utility) echo "orkestra-core" ;;
        orkestra-agent)   echo "orkestra-core" ;;
    esac
}

# Initialize flags (may be overridden by --all or force flags)
HAS_FRONTEND=false
HAS_TAURI=false
HAS_CLI=false
HAS_ORK_SERVICE=false
HAS_RUST_CONFIG=false
CHANGED_CRATES=()

# Handle force flags
if $FORCE_ALL; then
    HAS_FRONTEND=true
    HAS_TAURI=true
    HAS_CLI=true
    HAS_ORK_SERVICE=true
    CHANGED_CRATES=("${ALL_CRATES[@]}")
else
    $FORCE_FRONTEND && HAS_FRONTEND=true
    if $FORCE_RUST; then
        HAS_TAURI=true
        HAS_CLI=true
        HAS_ORK_SERVICE=true
        CHANGED_CRATES=("${ALL_CRATES[@]}")
    fi

    # Parse changed files (skip if CHANGED_FILES is "(all)")
    if [ "$CHANGED_FILES" != "(all)" ]; then
        while IFS= read -r file; do
            case "$file" in
                src/*|package.json|pnpm-lock.yaml|biome.json|tsconfig*.json|vite.config.ts|vitest.config.ts|tailwind.config.js|postcss.config.js|index.html|knip.json)
                    HAS_FRONTEND=true
                    ;;
                .storybook/*)
                    HAS_FRONTEND=true
                    ;;
                src-tauri/*)
                    HAS_TAURI=true
                    ;;
                cli/*)
                    HAS_CLI=true
                    ;;
                service/*)
                    HAS_ORK_SERVICE=true
                    ;;
                crates/*/Cargo.toml|crates/*/build.rs|crates/*/*/*)
                    # Compilation-relevant crate files: manifests, build scripts,
                    # and anything in subdirectories (src/, tests/, embedded
                    # templates, migrations). Root-level documentation (README.md,
                    # CLAUDE.md, LICENSE) is excluded — those don't affect compilation.
                    crate_name="${file#crates/}"
                    crate_name="${crate_name%%/*}"
                    if ! array_contains "$crate_name" "${CHANGED_CRATES[@]}"; then
                        CHANGED_CRATES+=("$crate_name")
                    fi
                    ;;
                Cargo.toml|Cargo.lock|clippy.toml|rustfmt.toml|.cargo/*)
                    HAS_RUST_CONFIG=true
                    ;;
            esac
        done <<< "$CHANGED_FILES"
    fi
fi

# If Rust config changed, check all Rust code
if $HAS_RUST_CONFIG; then
    HAS_TAURI=true
    HAS_CLI=true
    HAS_ORK_SERVICE=true
    CHANGED_CRATES=("${ALL_CRATES[@]}")
fi

# Expand changed crates to include transitive reverse dependencies.
# If orkestra-types changed, we also need to test orkestra-parser, orkestra-store, etc.
AFFECTED_CRATES=()
for crate in "${CHANGED_CRATES[@]}"; do
    if ! array_contains "$crate" "${AFFECTED_CRATES[@]}"; then
        AFFECTED_CRATES+=("$crate")
    fi
    for dep in $(reverse_deps_of "$crate"); do
        if ! array_contains "$dep" "${AFFECTED_CRATES[@]}"; then
            AFFECTED_CRATES+=("$dep")
        fi
    done
done

# Determine if any Rust changed
HAS_RUST=false
if $HAS_TAURI || $HAS_CLI || [ ${#CHANGED_CRATES[@]} -gt 0 ]; then
    HAS_RUST=true
fi

# Always run core e2e tests when any Rust changes — they exercise
# the full system across crate boundaries
if $HAS_RUST && ! array_contains "orkestra-core" "${AFFECTED_CRATES[@]}"; then
    AFFECTED_CRATES+=("orkestra-core")
fi

if $VERBOSE; then
    echo "Change categories:"
    echo "  Frontend (src/):        $HAS_FRONTEND"
    echo "  Tauri (src-tauri/):     $HAS_TAURI"
    echo "  CLI (cli/):             $HAS_CLI"
    echo "  Changed crates:         ${CHANGED_CRATES[*]:-none}"
    echo "  Affected crates:        ${AFFECTED_CRATES[*]:-none}"
    echo "  Rust config:            $HAS_RUST_CONFIG"
    echo ""
fi

# =============================================================================
# Validate shared build symlinks
# =============================================================================

if [ -L "target" ]; then
    SYMLINK_TARGET=$(readlink "target")
    if [ ! -d "$SYMLINK_TARGET" ]; then
        warn "target/ symlink is dangling (points to $SYMLINK_TARGET which doesn't exist)"
        warn "First cargo build will create it — this is expected for fresh repos"
    fi
elif [ -d "target" ]; then
    warn "target/ is a real directory, not a symlink — builds will use local target"
fi

# =============================================================================
# Run checks based on what changed
# =============================================================================

# Frontend checks
if $HAS_FRONTEND; then
    $VERBOSE && info "=== Frontend Checks ==="

    # Ensure dependencies are installed
    if [ ! -d "node_modules" ]; then
        run_check "pnpm install" "pnpm install"
    fi

    run_check "Frontend lint+format fix (biome)" "pnpm check:fix"
    run_check "Frontend lint+format verify (biome)" "pnpm check --error-on-warnings"
    run_check "Frontend unused code fix (knip)" "pnpm knip --fix"
    run_check "Frontend unused code (knip)" "pnpm knip"
    run_check "Frontend type check" "pnpm exec tsc --noEmit"
    run_check "Frontend tests" "pnpm test:run"
    run_check "Storybook build" "pnpm build-storybook --quiet"
fi

# Rust checks - run clippy and tests for affected crates
if $HAS_RUST; then
    $VERBOSE && info "=== Rust Checks ==="

    # Ensure pnpm dependencies are installed (needed for pnpm build and any other pnpm commands)
    if [ ! -d "node_modules" ]; then
        run_check "pnpm install" "pnpm install"
    fi

    # Ensure frontend is built (Tauri requires dist/ to exist)
    if [ ! -d "dist" ]; then
        $VERBOSE && info "Building frontend (required for Tauri build)..."
        run_check "Frontend build" "pnpm build"
    fi

    # Auto-format Rust code (no compilation, no lock needed)
    run_check "Cargo fmt fix" "cargo fmt --all"
    run_check "Cargo fmt verify" "cargo fmt --all --check"

    # Acquire lock for cargo commands that use the shared target/ directory
    acquire_lock

    # Invalidate cargo's mtime-based fingerprints for ALL workspace crates.
    # All worktrees share one target/ directory. Cargo considers a crate "Fresh" when
    # every source file is older than the cached binary — but binaries in the shared
    # target may have been compiled by main (or another worktree) with different source.
    # We touch ALL crate roots, not just AFFECTED_CRATES, because crates this worktree
    # didn't touch may still have stale binaries from main that don't match this
    # worktree's type definitions. sccache provides content-based cache hits so
    # unchanged files compile instantly — the only real cost is linking (~5-10s total).
    #
    # IMPORTANT: This must happen INSIDE the lock. If touch runs before acquire_lock,
    # another worktree can compile between our touch and our cargo run, making its
    # binary newer than our touched source — cargo then sees "Fresh" and serves stale code.
    if [ -L "target" ]; then
        for crate in "${ALL_CRATES[@]}"; do
            touch "crates/$crate/src/lib.rs"
        done
        touch cli/src/main.rs
        touch src-tauri/src/main.rs
    fi

    # Run clippy: auto-fix what it can, then fail on any remaining warnings.
    # Single pass: --fix applies fixes, -- -D warnings errors on non-auto-fixable warnings.
    run_check "Cargo clippy" "cargo clippy --fix --allow-dirty --allow-staged --workspace --all-targets -- -D warnings"

    # Run tests for affected crates (changed crates + their reverse deps)
    for crate in "${AFFECTED_CRATES[@]}"; do
        run_check "$crate tests" "cargo test -p $crate"
    done

    if $HAS_CLI; then
        run_check "orkestra-cli tests" "cargo test -p orkestra-cli"
    fi

    if $HAS_TAURI; then
        run_check "orkestra (tauri) tests" "cargo test -p orkestra"
    fi

    # Build check (ensures everything compiles)
    run_check "Cargo build (all)" "cargo build --workspace"

    # Release lock — done with shared target/ directory
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
