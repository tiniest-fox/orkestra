#!/bin/bash
# ---
# description: Runs each trak's worktree in a local Docker container, at the engine host's own paths. For tests only.
# detached: true
# settings:
#   image: busybox:1.37
# ---
#
# A `user:` setting runs every `exec` as that user rather than root, the way boat's sandbox
# does: `create` makes each root as root and gives only the root itself, and the user's
# home, to the user, so a directory between `/` and a root stays root's.
#
# Every verb of the runner interface (`src/vcs/ports/runners.ts`), against a
# container standing in for a sandbox on another machine. Nothing is bind-mounted, so a
# path the host has is in the container only once something puts it there — which is
# what makes it a second machine to test against rather than the same disk twice.
#
# The container is found by two labels, the project and the trak, and this script keeps
# no state of its own. A third records the seed version `create` was handed, which
# `status` prints after the state, and both print the container's id on an `id` line. Inside it, each exec records its process group's leader under
# /tmp/orkestra-exec/<exec-id>, which is how `kill` finds it: killing the local
# `docker exec` leaves the remote command running.

set -uo pipefail

verb=${1:?usage: runner.sh <verb> [trak] ...}
# `list` is the one verb about the project rather than one trak, so it names none.
trak=${2:-}
case "$verb" in list) ;; *) : "${trak:?usage: runner.sh $verb <trak> ...}" ;; esac
project=${ORKESTRA_RUNNER_PROJECT:?ORKESTRA_RUNNER_PROJECT is not set}
image=${ORKESTRA_RUNNER_IMAGE:?ORKESTRA_RUNNER_IMAGE is not set}
self=$0
as_user=()
if [ -n "${ORKESTRA_RUNNER_USER:-}" ]; then as_user=(-u "$ORKESTRA_RUNNER_USER"); fi

container() {
	docker ps -aq \
		--filter "label=orkestra.runner.project=$project" \
		--filter "label=orkestra.runner.trak=$trak" | head -n 1
}

state() {
	local c
	c=$(container)
	if [ -z "$c" ]; then
		echo absent
	else
		docker inspect -f '{{if .State.Running}}running{{else}}stopped{{end}}' "$c"
	fi
}

# The provider's own id for the sandbox, which `create` and `status` print — the container's
# short id. Nothing under `ORKESTRA_RUNNER_NO_ID`, a runner that reports none.
print_id() {
	if [ -z "${ORKESTRA_RUNNER_NO_ID:-}" ]; then printf 'id %s\n' "${1:0:12}"; fi
}

# The answer that is not an exit code, when the engine asked for one.
result() {
	if [ -n "${ORKESTRA_RUNNER_RESULT:-}" ]; then printf '%s\n' "$1" >"$ORKESTRA_RUNNER_RESULT"; fi
}

# A container that is not running, or not there, has nothing to signal. A detached exec
# is its directory: its command's group, its stdin's holder, and the directory removed.
signal_exec() {
	local c
	c=$(container)
	[ -n "$c" ] && [ "$(state)" = running ] || return 0
	docker exec "$c" sh -c 'f=/tmp/orkestra-exec/$1
		if [ -d "$f.d" ]; then
			[ -f "$f.d/pid" ] && kill -TERM "-$(cat "$f.d/pid")" 2>/dev/null
			[ -f "$f.d/holder" ] && kill "$(cat "$f.d/holder")" 2>/dev/null
			rm -rf "$f.d"
		fi
		[ -f "$f" ] || exit 0; kill -TERM "-$(cat "$f")" 2>/dev/null; rm -f "$f"' sh "$1" >/dev/null 2>&1 || true
}

# Streams /tmp/orkestra-exec/<exec-id>.d from its start while copying stdin into its FIFO
# — the end of both verbs that read a detached exec, `exec --detached` and `attach`. It
# exits with the command's code once `code` is written and everything before it is out,
# after the command's stderr. stdin is copied a line at a time: the line
# `orkestra-end-<exec-id>` closes the command's input, by ending the holder, and EOF
# without it is the engine gone, which stops this exec and leaves the command running.
# The copy is a background job, whose stdin is /dev/null before any redirection, so it
# reads a copy of stdin taken first.
FOLLOW='
end="orkestra-end-$(basename "$d" .d)"
conn=$$
exec 7<&0
(
	exec 8>"$d/in"
	while IFS= read -r line; do
		if [ "$line" = "$end" ]; then
			# Not before the command has opened `in`: a FIFO opened for reading waits for a
			# writer, and with the holder gone and this end closed there is none, so the
			# command would never start. `opened` is written once the open has returned, by
			# an exec whose directory holds `opens`; one an older script made writes neither,
			# and its command opened `in` long ago, so its end line is acted on at once.
			while [ -e "$d/opens" ] && [ ! -e "$d/opened" ] && [ ! -e "$d/code" ]; do sleep 0.05; done
			exec 8>&-
			[ -f "$d/holder" ] && kill "$(cat "$d/holder")" 2>/dev/null
			exit 0
		fi
		printf "%s\n" "$line" >&8
	done
	touch "$d/left.$conn"
) <&7 &
joined=$!
off=0
while :; do
	[ -d "$d" ] || exit 143
	if [ -f "$d/left.$conn" ]; then rm -f "$d/left.$conn"; exit 0; fi
	done=
	[ -f "$d/code" ] && done=1
	size=$(wc -c <"$d/out")
	if [ "$size" -gt "$off" ]; then
		tail -c "+$((off + 1))" "$d/out" | head -c "$((size - off))"
		off=$size
	fi
	if [ -n "$done" ]; then
		kill "$joined" 2>/dev/null
		cat "$d/err" >&2
		exit "$(cat "$d/code")"
	fi
	sleep 0.1
done
'

# The sandbox's half of `exec --detached`, ending in `FOLLOW`. `$1` is the exec id, `$2`
# the start marker, `$3` the working directory. A detached command runs in a session of its
# own — whose leader `kill` signals — under
# /tmp/orkestra-exec/<exec-id>.d: its stdin the FIFO `in`, which a holder keeps open so no
# writer leaving ends the command's input; its stdout to `out` and its stderr to `err`; and
# its exit code to `code` once it ends. The directory stays until `kill` removes it.
DETACHED='
d=/tmp/orkestra-exec/$1.d
printf "%s\n" "$2"
mkdir -p "$d" && mkfifo "$d/in" && : >"$d/out" && : >"$d/err" && : >"$d/opens" || exit 1
while IFS= read -r -d "" rec && [ -n "$rec" ]; do export "$rec"; done
cwd=$3
shift 3
setsid sleep 2147483647 <>"$d/in" >/dev/null 2>&1 &
echo $! >"$d/holder"
setsid sh -c '"'"'d=$1; cwd=$2; shift 2
	echo $$ >"$d/pid"
	(: >"$d/opened"; cd "$cwd" && exec "$@") <"$d/in" >"$d/out" 2>"$d/err"
	echo $? >"$d/code.tmp" && mv "$d/code.tmp" "$d/code"
	[ -f "$d/holder" ] && kill "$(cat "$d/holder")" 2>/dev/null'"'"' sh "$d" "$cwd" "$@" </dev/null >/dev/null 2>&1 &
'"$FOLLOW"

# `expose` over `docker exec` and busybox `nc`, in node because bash cannot listen. It
# takes any number of connections at once.
TUNNEL='
const { spawn } = require("node:child_process")
const net = require("node:net")
const [c, port] = process.argv.slice(1)
const remoteKill = (id) => spawn("docker", ["exec", c, "sh", "-c", "kill \"$(cat /tmp/orkestra-exec/" + id + ")\" 2>/dev/null"], { stdio: "ignore" })
const recorded = (id, command) => ["exec", "-i", c, "sh", "-c", "mkdir -p /tmp/orkestra-exec; echo $$ > /tmp/orkestra-exec/" + id + "; exec " + command]
let open = []
const end = () => { for (const id of open) remoteKill(id); setTimeout(() => process.exit(0), 500) }
process.on("SIGTERM", end)
process.on("SIGINT", end)
let n = 0
net.createServer((sock) => {
  const id = "expose-" + port + "-" + String(++n)
  open.push(id)
  // `127.0.0.1`, or `::1` where nothing listens there: a server told `localhost` binds
  // either, and busybox `nc localhost` tries only the first address. Chosen before the
  // `exec`, so the recorded pid is still the `nc` that carries the connection.
  const to = "$(nc -z 127.0.0.1 " + port + " 2>/dev/null && echo 127.0.0.1 || echo ::1)"
  const p = spawn("docker", recorded(id, "nc " + to + " " + port))
  sock.pipe(p.stdin)
  p.stdout.pipe(sock)
  p.on("exit", () => { open = open.filter((o) => o !== id); sock.destroy() })
  sock.on("close", () => p.stdin.end())
  sock.on("error", () => p.kill())
}).listen(Number(port), "127.0.0.1")
'

# `reach`'s relay, run by `node` on this
# machine with the container, the engine's port, the file naming the inner port and the
# file it writes its pid to: the sandbox's end of each connection is a busybox `nc -l` in
# the container, carried over `docker exec`, and the inner port is the forward's on this
# machine. It is started in a session of its own, so it outlives the engine and every
# `reach`, and ends once the container is gone. A connection is seen once the sandbox's
# side sends a byte, so it carries a protocol where the client speaks first, such as HTTP,
# and no other; the next `nc -l` is started then, so connections may be open at once.
HOLD='
const { spawn } = require("node:child_process")
const { EventEmitter } = require("node:events")
const fs = require("node:fs")
const net = require("node:net")
const [c, port, innerFile, pidFile] = process.argv.slice(1)
const MARK = Buffer.from("orkestra-resent: 1\r\n")
const PAUSE = 500
const inner = () => {
  try {
    return Number(fs.readFileSync(innerFile, "utf8")) || 0
  } catch {
    return 0
  }
}
const healthy = (then) => {
  const p = inner()
  if (p === 0) return setTimeout(healthy, PAUSE, then)
  const s = net.connect(p, "127.0.0.1")
  let got = ""
  let done = false
  const settle = (ok) => {
    if (done) return
    done = true
    s.destroy()
    if (ok) then()
    else setTimeout(healthy, PAUSE, then)
  }
  s.on("connect", () => s.write("GET /api/health HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n"))
  s.on("data", (d) => {
    got += d
    if (got.includes("\r\n")) settle(/^HTTP\/1\.[01] 200 /.test(got))
  })
  s.on("error", () => settle(false))
  s.on("close", () => settle(false))
}
const marked = (head) => {
  const at = head.indexOf("\r\n")
  return at < 0 ? head : Buffer.concat([head.subarray(0, at + 2), MARK, head.subarray(at + 2)])
}
const carry = (client) => {
  const sent = []
  let up
  let ended = false
  let gone = false
  client.on("data", (d) => {
    sent.push(d)
    if (up !== undefined) up.write(d)
  })
  client.on("end", () => {
    ended = true
    if (up !== undefined) up.end()
  })
  client.on("close", () => {
    gone = true
    if (up !== undefined) up.destroy()
  })
  const attempt = (resend) => {
    if (!gone) healthy(() => dial(resend))
  }
  const dial = (resend) => {
    if (gone) return
    const p = inner()
    if (p === 0) return setTimeout(attempt, PAUSE, resend)
    const s = net.connect(p, "127.0.0.1")
    let answered = false
    s.on("connect", () => {
      if (gone) return s.destroy()
      up = s
      const head = Buffer.concat(sent)
      if (head.length > 0) s.write(resend ? marked(head) : head)
      if (ended) s.end()
    })
    s.on("data", (d) => {
      answered = true
      client.write(d)
    })
    s.on("error", () => {})
    s.on("close", (failed) => {
      if (up === s) up = undefined
      if (gone) return
      if (answered) return failed ? client.destroy() : client.end()
      setTimeout(attempt, PAUSE, resend || s.bytesWritten > 0)
    })
  }
  attempt(false)
}
// One `nc -l` in the container, as a socket: its stdout is what the sandbox sent, and it
// ends when the sandbox closes.
const clientOf = (p) => {
  const e = new EventEmitter()
  p.stdout.on("data", (d) => e.emit("data", d))
  p.on("exit", () => e.emit("close"))
  p.stdin.on("error", () => {})
  e.write = (d) => p.stdin.write(d)
  e.end = () => p.stdin.end()
  e.destroy = () => p.kill()
  return e
}
const listen = () => {
  const p = spawn("docker", ["exec", "-i", c, "nc", "-l", "-s", "127.0.0.1", "-p", port])
  let said = ""
  let client
  p.stderr.on("data", (d) => { said += d })
  p.stdout.once("data", (first) => {
    listen()
    client = clientOf(p)
    carry(client)
    client.emit("data", first)
  })
  p.on("exit", () => {
    if (client !== undefined) return
    if (/No such container|is not running/.test(said)) process.exit(0)
    setTimeout(listen, PAUSE)
  })
}
// Whatever holds the port in the sandbox first — a forward an engine left — is killed, so
// the sandbox reaches the relay rather than it.
spawn("docker", ["exec", c, "sh", "-c", "fuser -k " + port + "/tcp"], { stdio: "ignore" }).on("exit", () => {
  fs.writeFileSync(pidFile, String(process.pid))
  listen()
})
'

# `reach`'s forward, standing in for `boat forward --reverse`: a port on this machine's
# loopback, written to the inner-port file, carried to the engine's port. Like an `ssh -R`
# whose host end has nothing listening, it accepts and then closes while the engine is down.
FORWARD='
const fs = require("node:fs")
const net = require("node:net")
const [port, innerFile] = process.argv.slice(1)
const server = net.createServer((sock) => {
  const up = net.connect(Number(port), "127.0.0.1")
  sock.pipe(up).pipe(sock)
  up.on("error", () => sock.destroy())
  sock.on("error", () => up.destroy())
  up.on("close", () => sock.destroy())
  sock.on("close", () => up.destroy())
})
server.listen(0, "127.0.0.1", () => fs.writeFileSync(innerFile, String(server.address().port)))
process.on("SIGTERM", () => process.exit(0))
'

# A provider's limit, for the cases that need one: the verb `ORKESTRA_RUNNER_LIMIT` names —
# a `limit:` setting — is refused as a provider's rate limit refuses it, with `limited`
# and the sentence on the result file and the provider's own text on stderr.
if [ "${ORKESTRA_RUNNER_LIMIT:-}" = "$verb" ]; then
	result "limited the fixture allows no $verb now; try again in a minute"
	echo "fixture provider refused $verb (429): you used every $verb included in the last minute" >&2
	exit 1
fi
# A sandbox the provider still lists but cannot reach: the verb `ORKESTRA_RUNNER_LOSE` names —
# a `lose:` setting — answers `lost`, while `status` still says running.
if [ "${ORKESTRA_RUNNER_LOSE:-}" = "$verb" ]; then
	result "lost the fixture could not reach the sandbox"
	exit 1
fi

# The provider's API down, for the cases that need an outage: while the file an `outage:`
# setting names exists, every verb answers `unreachable`, and a connection already open
# drops — see `watch_outage`. The test makes and removes the file, so the outage's state
# is outside this script.
outage_reason="the fixture provider's API did not answer"
if [ -n "${ORKESTRA_RUNNER_OUTAGE:-}" ] && [ -e "$ORKESTRA_RUNNER_OUTAGE" ]; then
	result "unreachable $outage_reason"
	echo "fixture provider: could not reach the API" >&2
	exit 1
fi

# The provider's transport failing before the command starts, as `boat ssh` does: an `exec`
# with an `unreachable: exec` setting prints the provider's JSON error on stdout and exits
# 1, in place of `docker exec`. The local `docker exec`'s pid goes on the file `$dxfile`
# where one is named, for `watch_outage` to drop.
dxfile=
transport() {
	if [ "${ORKESTRA_RUNNER_UNREACHABLE:-}" = exec ]; then
		printf '%s\n' '{"error":{"code":"sandbox_error","message":"the fixture sandbox is in the error state"}}'
		return 1
	fi
	docker exec "$@" <&0 &
	local dx=$!
	if [ -n "$dxfile" ]; then echo "$dx" >"$dxfile"; fi
	wait "$dx"
}

# Under an `outage:` setting, drops the connection the job `$1` holds once the outage file
# appears: the local `docker exec` is killed, and a command in the container goes on, as it
# does when a provider's API goes away under a connection to it.
watch_outage() {
	[ -n "${ORKESTRA_RUNNER_OUTAGE:-}" ] || return 0
	(
		while kill -0 "$1" 2>/dev/null; do
			if [ -e "$ORKESTRA_RUNNER_OUTAGE" ]; then
				[ -s "$dxfile" ] && kill -KILL "$(cat "$dxfile")" 2>/dev/null
				exit 0
			fi
			sleep 0.2
		done
	) </dev/null >/dev/null 2>&1 &
}

# Whether the outage began while this verb ran, which is then its answer.
in_outage() {
	[ -n "${ORKESTRA_RUNNER_OUTAGE:-}" ] && [ -e "$ORKESTRA_RUNNER_OUTAGE" ]
}

# Copies stdout through from the line after the start marker `$1`, marking the start on
# the file `$2`. Every line before it is the provider's own, and goes to stderr and to the
# file `$3` instead — so a provider's error never reaches a command's stdout, where git
# would read it as protocol.
pass_started() {
	local line
	while IFS= read -r line || [ -n "$line" ]; do
		if [ "$line" = "$1" ]; then
			printf 1 >"$2"
			exec cat
		fi
		printf '%s\n' "$line" >>"$3"
		printf '%s\n' "$line" >&2
	done
}

# The message in what the provider printed on the file `$1` — its first line, out of the
# JSON where it is that, and as written where it is not.
provider_message() {
	local first message
	first=$(grep -m 1 . "$1")
	message=$(sed -n 's/.*"message":"\([^"]*\)".*/\1/p' <<<"$first")
	printf '%s' "${message:-$first}"
}

case "$verb" in
create)
	seed=${3:-}
	c=$(container)
	if [ -z "$c" ]; then
		# A tmpfs over each `VOLUME` the image declares, so `docker run` makes no anonymous
		# volume. One on disk is what lets a CI runner's snapshot `docker pause` every
		# container mid-test.
		volumes() { docker image inspect -f '{{range $p, $_ := .Config.Volumes}}{{$p}}{{"\n"}}{{end}}' "$image" 2>/dev/null; }
		declared=$(volumes || { docker pull -q "$image" >/dev/null && volumes; }) || exit 1
		tmpfs=()
		while IFS= read -r p; do [ -n "$p" ] && tmpfs+=(--mount "type=tmpfs,destination=$p"); done <<<"$declared"
		c=$(docker run -d ${tmpfs[@]+"${tmpfs[@]}"} \
			--label "orkestra.runner.project=$project" \
			--label "orkestra.runner.trak=$trak" \
			--label "orkestra.runner.seed=$seed" \
			--entrypoint tail "$image" -f /dev/null) || exit 1
	elif [ "$(state)" = stopped ]; then
		docker start "$c" >/dev/null || exit 1
	fi
	# The mirror's roots: the project's own path, so every path under it can follow, and
	# the directories the engine copies its own files into.
	read -r -a roots <<<"${ORKESTRA_RUNNER_ROOTS:-}"
	docker exec "$c" mkdir -p "$project" ${roots[@]+"${roots[@]}"} || exit 1
	if [ -n "${ORKESTRA_RUNNER_USER:-}" ]; then
		h=$(docker exec -u "$ORKESTRA_RUNNER_USER" "$c" sh -c 'printf %s "$HOME"') || exit 1
		docker exec "$c" sh -c 'u=$1; shift; for r; do mkdir -p "$r" && chown "$u" "$r" || exit 1; done' \
			sh "$ORKESTRA_RUNNER_USER" "$project" "$h" ${roots[@]+"${roots[@]}"} || exit 1
	fi
	print_id "$c"
	;;

exec)
	id=${3:?exec needs an exec id}
	shift 3
	if_running= detached=
	while :; do
		case "${1:-}" in
		--if-running) if_running=1 ;;
		--detached) detached=1 ;;
		*) break ;;
		esac
		shift
	done
	cwd=${1:?exec needs a working directory}
	shift
	if [ "${1:-}" != -- ]; then
		echo "exec: expected -- before the command" >&2
		exit 2
	fi
	shift
	c=$(container)
	if [ -z "$c" ]; then
		result "lost there is no sandbox for $trak"
		exit 1
	fi
	if [ "$(state)" = stopped ]; then
		if [ -n "$if_running" ]; then
			result stopped
			exit 0
		fi
		docker start "$c" >/dev/null || {
			result "lost the sandbox would not start"
			exit 1
		}
	fi
	# stdin opens with the engine's environment block — `NAME=value` records, each ended
	# by a NUL, then an empty one — and the wrapper reads it into its own environment
	# before the command takes the rest. `read` takes a pipe a byte at a time, so it
	# stops exactly at the block's end. A background job's stdin is /dev/null unless it
	# is redirected explicitly. The wrapper's first stdout line is a start marker, and
	# what comes before it is the provider's own — see `pass_started`.
	#
	# `--detached` runs the command so it outlives this exec — see `DETACHED` — and its
	# SIGTERM handler then leaves the command running: only `kill` stops it.
	started="orkestra-start-$id-$RANDOM$RANDOM"
	startfile=$(mktemp) && said=$(mktemp) && dxfile=$(mktemp) || exit 1
	exec 3<&0
	{
		if [ -n "$detached" ]; then
			transport -i ${as_user[@]+"${as_user[@]}"} "$c" sh -c "$DETACHED" sh "$id" "$started" "$cwd" "$@" <&3 |
				pass_started "$started" "$startfile" "$said"
		else
			transport -i ${as_user[@]+"${as_user[@]}"} "$c" sh -c \
				'printf "%s\n" "$3"
				mkdir -p /tmp/orkestra-exec && echo $$ >"/tmp/orkestra-exec/$1" || exit 1
				while IFS= read -r -d "" rec && [ -n "$rec" ]; do export "$rec"; done
				cd "$2" && shift 3 && exec "$@"' \
				sh "$id" "$cwd" "$started" "$@" <&3 | pass_started "$started" "$startfile" "$said"
		fi
		exit "${PIPESTATUS[0]}"
	} &
	pid=$!
	watch_outage "$pid"
	if [ -n "$detached" ]; then
		trap 'kill "$pid" 2>/dev/null; rm -f "$startfile" "$said"; exit 143' TERM INT
	else
		trap 'signal_exec "$id"; wait "$pid"; rm -f "$startfile" "$said"; exit 143' TERM INT
	fi
	code=0
	wait "$pid" || code=$?
	message=
	if [ ! -s "$startfile" ]; then message=$(provider_message "$said"); fi
	rm -f "$startfile" "$said" "$dxfile"
	if in_outage; then
		result "unreachable $outage_reason"
		exit 1
	fi
	if [ "$code" -ne 0 ] && [ -n "$message" ]; then
		result "lost $message"
		exit 1
	fi
	if [ "$code" -ne 0 ] && [ "$(state)" != running ]; then
		result "lost the sandbox stopped during the command"
		exit 1
	fi
	if [ -z "$detached" ]; then docker exec "$c" rm -f "/tmp/orkestra-exec/$id" >/dev/null 2>&1; fi
	exit "$code"
	;;

attach)
	# Rejoins a detached exec: its output from the start, its stdin, and its exit code.
	# `gone` on the result file where the sandbox holds no such exec — not there, stopped,
	# or the exec already killed.
	id=${3:?attach needs an exec id}
	c=$(container)
	if [ -z "$c" ] || [ "$(state)" != running ]; then
		result gone
		exit 1
	fi
	started="orkestra-start-$id-$RANDOM$RANDOM"
	startfile=$(mktemp) && said=$(mktemp) && dxfile=$(mktemp) || exit 1
	exec 3<&0
	{
		transport -i "$c" sh -c 'd=/tmp/orkestra-exec/$1.d
			[ -d "$d" ] || exit 97
			printf "%s\n" "$2"'"$FOLLOW" sh "$id" "$started" <&3 |
			pass_started "$started" "$startfile" "$said"
		exit "${PIPESTATUS[0]}"
	} &
	pid=$!
	watch_outage "$pid"
	trap 'kill "$pid" 2>/dev/null; rm -f "$startfile" "$said"; exit 143' TERM INT
	code=0
	wait "$pid" || code=$?
	message=
	if [ ! -s "$startfile" ]; then message=$(provider_message "$said"); fi
	marked=$(cat "$startfile")
	rm -f "$startfile" "$said" "$dxfile"
	if in_outage; then
		result "unreachable $outage_reason"
		exit 1
	fi
	if [ -z "$marked" ] && [ "$code" -eq 97 ] && [ -z "$message" ]; then
		result gone
		exit 1
	fi
	if [ "$code" -ne 0 ] && [ -n "$message" ]; then
		result "lost $message"
		exit 1
	fi
	if [ "$code" -ne 0 ] && [ "$(state)" != running ]; then
		result "lost the sandbox stopped during the command"
		exit 1
	fi
	exit "$code"
	;;

kill)
	signal_exec "${3:?kill needs an exec id}"
	;;

expose | reach)
	port=${3:?$verb needs a port}
	c=$(container)
	if [ -z "$c" ] || [ "$(state)" != running ]; then
		echo "$verb: the sandbox for $trak is not running" >&2
		exit 1
	fi
	[ "$verb" = expose ] && exec node -e "$TUNNEL" "$c" "$port"
	# The relay's state is this machine's, under the container and the port: the inner
	# port, the relay's pid, and the pid of the forward the last `reach` made, which is
	# ended first — an engine killed outright leaves it running.
	at="${TMPDIR:-/tmp}/orkestra-fixture-reach/${c:0:12}-$port"
	mkdir -p "${at%/*}" || exit 1
	if [ -s "$at.forward" ]; then kill "$(cat "$at.forward")" 2>/dev/null; fi
	echo $$ >"$at.forward"
	pid=$(cat "$at.pid" 2>/dev/null)
	if [ -z "$pid" ] || ! kill -0 "$pid" 2>/dev/null; then
		rm -f "$at.pid"
		# From a subshell that exits at once, so the relay is no descendant of this `reach`:
		# the engine's kill walks those as well as the process group. In a session of its own,
		# out of that group — through `perl` where there is no `setsid`, as on macOS.
		if command -v setsid >/dev/null; then
			(setsid node -e "$HOLD" "$c" "$port" "$at.inner" "$at.pid" </dev/null >/dev/null 2>&1 &)
		else
			(perl -MPOSIX -e 'POSIX::setsid() or die "setsid: $!"; exec @ARGV or die "exec: $!"' \
				node -e "$HOLD" "$c" "$port" "$at.inner" "$at.pid" </dev/null >/dev/null 2>&1 &)
		fi
		for _ in $(seq 100); do [ -s "$at.pid" ] && break; sleep 0.1; done
		if [ ! -s "$at.pid" ]; then
			echo "reach: the relay on port $port did not start" >&2
			exit 1
		fi
	fi
	exec node -e "$FORWARD" "$port" "$at.inner"
	;;

list)
	# Every trak this project has a container for, by the trak label, running or not.
	#
	# `list_cut: <n>` stands in for a provider that lists `n` and has more it will not
	# hand over — boat.dev's pages, which the real script walks to their end. The rule both
	# scripts are held to is that such a listing is a failure and not a short answer:
	# nothing is printed and the verb exits non-zero, because the sweep reads a listing as
	# the whole set and would otherwise decide a live trak's sandbox is absent. **An entry
	# the script cannot turn into a trak id is the same fault**, so a container of this
	# project whose trak label is empty fails rather than being dropped.
	#
	# Each line is prefixed, because `$()` strips trailing newlines: a lone container with
	# an empty trak label would otherwise leave nothing to notice at all.
	raw=$(docker ps -a --filter "label=orkestra.runner.project=$project" \
		--format 'trak={{.Label "orkestra.runner.trak"}}') || exit 1
	ids= count=0
	while IFS= read -r line; do
		[ -n "$line" ] || continue
		t=${line#trak=}
		if [ -z "$t" ]; then
			echo "list: a container of this project has no trak in its label, so this project's sandboxes cannot all be listed" >&2
			exit 1
		fi
		ids="$ids$t
"
		count=$((count + 1))
	done <<<"$raw"
	cut=${ORKESTRA_RUNNER_LIST_CUT:-}
	if [ -n "$cut" ] && [ "$count" -gt "$cut" ]; then
		echo "list: the fixture listed $cut sandboxes and has more, with no cursor past them, so this project's sandboxes cannot all be listed" >&2
		exit 1
	fi
	printf '%s' "$ids"
	;;

status)
	s=$(state)
	if [ "$s" = absent ]; then
		echo absent
	else
		echo "$s $(docker inspect -f '{{index .Config.Labels "orkestra.runner.seed"}}' "$(container)")"
		print_id "$(container)"
	fi
	;;

stop)
	c=$(container)
	if [ -n "$c" ]; then docker stop -t 1 "$c" >/dev/null || exit 1; fi
	;;

release)
	c=$(container)
	if [ -n "$c" ]; then docker rm -f "$c" >/dev/null || exit 1; fi
	;;

shell)
	cwd=${3:?shell needs a working directory}
	c=$(container)
	if [ -z "$c" ]; then
		echo "shell: there is no sandbox for $trak" >&2
		exit 1
	fi
	[ "$(state)" = running ] || docker start "$c" >/dev/null || exit 1
	tty=()
	if [ -t 0 ]; then tty=(-t); fi
	# Each name `ORKESTRA_RUNNER_PASS` lists goes by name, and `docker` takes its value from
	# this script's environment, so no value is on a command line or in the container's disk.
	carried=()
	for name in ${ORKESTRA_RUNNER_PASS:-}; do carried+=(-e "$name"); done
	exec docker exec -i ${tty[@]+"${tty[@]}"} ${carried[@]+"${carried[@]}"} -w "$cwd" "$c" sh
	;;

*)
	echo "unknown verb: $verb" >&2
	exit 2
	;;
esac
