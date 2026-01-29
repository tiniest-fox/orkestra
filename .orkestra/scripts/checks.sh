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

set -e

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

    if $VERBOSE; then
        echo ""
        echo -e "${BLUE}[INFO]${NC} Running: $name"
        echo "  Command: $cmd"
        echo ""
        if eval "$cmd"; then
            success "$name"
        else
            fail "$name"
            FAILED_CHECKS+=("$name")
        fi
    else
        # Quiet mode: capture output, only show on failure
        local output
        local exit_code
        output=$(eval "$cmd" 2>&1) && exit_code=0 || exit_code=$?

        if [ $exit_code -eq 0 ]; then
            success "$name"
        else
            fail "$name"
            FAILED_CHECKS+=("$name")
            # Store truncated output for summary (last 50 lines)
            FAILED_OUTPUTS+=("$(echo "$output" | tail -50)")
        fi
    fi
}

# =============================================================================
# Detect branches (use ORKESTRA_* env vars if available)
# =============================================================================

get_primary_branch() {
    # Use ORKESTRA env var if set (when running as script stage)
    if [ -n "$ORKESTRA_PRIMARY_BRANCH" ]; then
        echo "$ORKESTRA_PRIMARY_BRANCH"
        return
    fi

    # Try common primary branch names
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
    # Use ORKESTRA env var if set (when running as script stage)
    if [ -n "$ORKESTRA_BRANCH" ]; then
        echo "$ORKESTRA_BRANCH"
        return
    fi

    git branch --show-current
}

PRIMARY_BRANCH=$(get_primary_branch)
CURRENT_BRANCH=$(get_current_branch)

if $VERBOSE; then
    info "Primary branch: $PRIMARY_BRANCH"
    info "Current branch: $CURRENT_BRANCH"

    # Show Orkestra context if running as script stage
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
elif [ "$CURRENT_BRANCH" = "$PRIMARY_BRANCH" ]; then
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
    MERGE_BASE=$(git merge-base "$PRIMARY_BRANCH" HEAD)
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

# Initialize flags (may be overridden by --all or force flags)
HAS_FRONTEND=false
HAS_TAURI=false
HAS_CLI=false
HAS_CORE=false
HAS_RUST_CONFIG=false

# Handle force flags
if $FORCE_ALL; then
    HAS_FRONTEND=true
    HAS_TAURI=true
    HAS_CLI=true
    HAS_CORE=true
else
    if $FORCE_FRONTEND; then
        HAS_FRONTEND=true
    fi
    if $FORCE_RUST; then
        HAS_TAURI=true
        HAS_CLI=true
        HAS_CORE=true
    fi

    # Parse changed files (skip if CHANGED_FILES is "(all)")
    if [ "$CHANGED_FILES" != "(all)" ]; then
        while IFS= read -r file; do
            case "$file" in
                src/*|package.json|pnpm-lock.yaml|biome.json|tsconfig*.json|vite.config.ts|vitest.config.ts|tailwind.config.js|postcss.config.js|index.html)
                    HAS_FRONTEND=true
                    ;;
                src-tauri/*)
                    HAS_TAURI=true
                    ;;
                cli/*)
                    HAS_CLI=true
                    ;;
                crates/orkestra-core/*)
                    HAS_CORE=true
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
    HAS_CORE=true
fi

# Determine if any Rust changed
HAS_RUST=false
if $HAS_TAURI || $HAS_CLI || $HAS_CORE; then
    HAS_RUST=true
fi

if $VERBOSE; then
    echo "Change categories:"
    echo "  Frontend (src/):        $HAS_FRONTEND"
    echo "  Tauri (src-tauri/):     $HAS_TAURI"
    echo "  CLI (cli/):             $HAS_CLI"
    echo "  Core (crates/):         $HAS_CORE"
    echo "  Rust config:            $HAS_RUST_CONFIG"
    echo ""
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

    run_check "Frontend lint+format (biome)" "pnpm check:fix"
    run_check "Frontend type check" "pnpm exec tsc --noEmit"
    run_check "Frontend tests" "pnpm test:run"
fi

# Rust checks - run clippy and tests for affected crates
if $HAS_RUST; then
    $VERBOSE && info "=== Rust Checks ==="

    # Ensure frontend is built (Tauri requires dist/ to exist)
    if [ ! -d "dist" ]; then
        $VERBOSE && info "Building frontend (required for Tauri build)..."
        # Ensure dependencies are installed first
        if [ ! -d "node_modules" ]; then
            run_check "pnpm install" "pnpm install"
        fi
        run_check "Frontend build" "pnpm build"
    fi

    # Auto-format Rust code
    run_check "Cargo fmt" "cargo fmt --all"

    # Run clippy with auto-fix, then verify no remaining warnings
    # --fix applies automatic fixes, --allow-dirty/--allow-staged permit uncommitted changes
    run_check "Cargo clippy fix" "cargo clippy --fix --workspace --all-targets --allow-dirty --allow-staged"
    run_check "Cargo clippy verify" "cargo clippy --workspace --all-targets -- -D warnings"

    # Run tests for specific crates that changed
    if $HAS_CORE; then
        run_check "Core tests" "cargo test -p orkestra-core"
    fi

    if $HAS_CLI; then
        run_check "CLI tests" "cargo test -p orkestra-cli"
    fi

    if $HAS_TAURI; then
        run_check "Tauri tests" "cargo test -p orkestra"
    fi

    # Build check (ensures everything compiles)
    run_check "Cargo build (all)" "cargo build --workspace"
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
