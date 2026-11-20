#!/bin/bash
# ---
# description: Copies each snapshot into a local directory. For tests only.
# secrets: [FIXTURE_BACKUP_KEY]
# every_minutes: 15
# settings:
#   store: /tmp/orkestra-fixture-backups
# ---
#
# Every verb of the backup interface (`src/library/types/backup.ts`), against a directory
# standing in for a bucket. A snapshot is `<store>/<id>/files/` holding each listed path
# under its absolute path, and `<store>/<id>/time`. The key is checked and never used: it
# is there to show the script was handed it.

set -euo pipefail

store=${ORKESTRA_BACKUP_STORE:?ORKESTRA_BACKUP_STORE is not set}
: "${FIXTURE_BACKUP_KEY:?the backup script was not handed FIXTURE_BACKUP_KEY}"
# An external store's variables are its process's alone, so no backup script is handed one.
if env | grep -q '^ORKESTRA_STORE'; then
	echo "the backup script was handed an ORKESTRA_STORE variable" >&2
	exit 1
fi

# The one-line answer, when the engine asked for one.
result() {
	if [ -n "${ORKESTRA_BACKUP_RESULT:-}" ]; then printf '%s\n' "$1" >"$ORKESTRA_BACKUP_RESULT"; fi
}

# Every path in list file $1 copied under $2 at its absolute path, modes kept. A path gone
# since the list was written is skipped: a trak archived mid-snapshot is not an error.
copy_list() {
	local path parent
	while IFS= read -r path || [ -n "$path" ]; do
		[ -n "$path" ] || continue
		[ -e "$path" ] || continue
		parent=$2$(dirname "$path")
		mkdir -p "$parent"
		cp -Rp "$path" "$parent/"
	done <"$1"
}

case ${1:?usage: backup.sh snapshot|list|restore ...} in
snapshot)
	state=${2:?usage: backup.sh snapshot <state-list> <git-list>}
	git=${3:?usage: backup.sh snapshot <state-list> <git-list>}
	mkdir -p "$store"
	id=$(printf 'snap-%04d' $(($(find "$store" -mindepth 1 -maxdepth 1 -type d | wc -l) + 1)))
	mkdir "$store/$id"
	# The state list first, then git: a commit a log names reached `.git` before the log did.
	copy_list "$state" "$store/$id/files"
	copy_list "$git" "$store/$id/files"
	date -u +%Y-%m-%dT%H:%M:%SZ >"$store/$id/time"
	result "$id"
	;;
list)
	[ -d "$store" ] || exit 0
	for dir in "$store"/snap-*; do
		[ -d "$dir" ] || continue
		printf '%s %s\n' "$(basename "$dir")" "$(cat "$dir/time")"
	done
	;;
restore)
	id=${2:?usage: backup.sh restore <id> <target>}
	target=${3:?usage: backup.sh restore <id> <target>}
	if [ ! -d "$store/$id" ]; then
		echo "no snapshot $id in $store" >&2
		exit 1
	fi
	mkdir -p "$target"
	if [ -d "$store/$id/files" ]; then cp -Rp "$store/$id/files/." "$target/"; fi
	result "$id"
	;;
*)
	echo "unknown verb: $1" >&2
	exit 2
	;;
esac
