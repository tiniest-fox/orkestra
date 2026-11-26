# Tools

**Path:** `.orkestra/tools/<name>.sh`, and `.orkestra/.local/tools/<name>.sh` for one
person's copy, which replaces the team's script of the same name.

A tool file declares a command a sandbox installs on its first call rather than one its
image already carries. The script does the download itself: the engine reads only the
header, and hands the script the directory to install into.

**In this build the engine reads and validates each tool file at load, and nothing yet
installs one.** A broken header still stops the engine from starting.

## A minimal example

```sh
#!/bin/sh
# ---
# description: The rclone command-line client.
# version: "1.70"
# ---
set -eu
curl -fsSL "https://downloads.rclone.org/v1.70.0/rclone-v1.70.0-linux-amd64.zip" -o /tmp/rclone.zip
unzip -j /tmp/rclone.zip '*/rclone' -d "$1"
chmod 755 "$1/rclone"
```

## The header

The same comment block a check uses: a `# ---` line after the shebang, each field behind
`# `, and a closing `# ---`. The script follows it and must not be empty.

| Key | Type | Default | What it does |
|---|---|---|---|
| `description:` | string | **required** | What the tool is |
| `version:` | string | **required** | Names the directory the install lands in, so changing it installs again. Letters, digits, `.`, `_`, `+` and `-`. Quote a version YAML would read as a number: `"1.70"`, not `1.70` |

**An unknown key fails the load.** These fail with a message saying why:

| Key | Why |
|---|---|
| `url:` | the script downloads the tool, so the address belongs in its body |
| `checksum:` | the script checks what it fetched |
| `arch:` | the script picks the build for the machine it runs on |

## Names

The filename, without `.sh`, is the command a call names: `rclone.sh` declares `rclone`.
It may use letters, digits, `.`, `_` and `-`.

## The script

The script installs the tool into the directory it is handed as `$1`.
