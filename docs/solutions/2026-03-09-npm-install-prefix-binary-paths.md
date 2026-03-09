---
title: npm install --prefix puts binaries in node_modules/.bin/, not bin/
date: 2026-03-09
tags: [npm, docker, toolbox]
category: bug-pattern
module: devcontainer
symptoms:
  - Symlinks to npm-installed CLI tools are dangling
  - Installed tool binaries not found at expected paths
  - npm global-style installs in isolated directories don't expose bin/ at the prefix root
---

# npm install --prefix Binary Path Gotcha

## Problem

`npm install --prefix <dir> <package>` does **not** place binaries at `<dir>/bin/`. It places them at `<dir>/node_modules/.bin/`. The `--prefix` flag sets the location for `node_modules/` and the package's files, but does not create a top-level `bin/` directory.

```dockerfile
# WRONG — creates dangling symlinks
RUN npm install --prefix /toolbox/claude-code @anthropic-ai/claude-code
RUN ln -s /toolbox/claude-code/bin/claude /usr/local/bin/claude
#                             ^^^  does not exist
```

The binary is actually at `/toolbox/claude-code/node_modules/.bin/claude`.

## Fix

Symlink from `node_modules/.bin/`:

```dockerfile
# CORRECT
RUN npm install --prefix /toolbox/claude-code @anthropic-ai/claude-code
RUN ln -s /toolbox/claude-code/node_modules/.bin/claude /usr/local/bin/claude
```

Same applies to `NODE_PATH` — point at `node_modules/`, not `lib/node_modules/`:

```sh
# WRONG
export NODE_PATH=/toolbox/claude-code/lib/node_modules

# CORRECT
export NODE_PATH=/toolbox/claude-code/node_modules
```

## Why This Happens

`npm install --prefix` is equivalent to running `npm install` inside `<dir>`. It creates `<dir>/node_modules/` and `<dir>/package.json`. The `.bin/` directory with binary symlinks is always inside `node_modules/`, regardless of prefix. There is no top-level `bin/` unless you use `npm install -g` into a prefix that acts as a global root (where npm places binaries in `<prefix>/bin/`).

**Use `npm install -g --prefix <dir>`** if you want `<dir>/bin/` — that's the global install mode. But in Dockerfiles, `--prefix` without `-g` is the common pattern for isolated installs and puts binaries in `node_modules/.bin/`.

## Where This Applies

- `Dockerfile.toolbox` — toolbox image for service-agnostic dev containers
- Any Dockerfile installing npm packages to isolated directories via `--prefix`
