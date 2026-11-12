#!/usr/bin/env bash
# Safe helpers for modifying COPIES of programs. Every write, build, and run is confined
# to the work root ($SBA_WORK_ROOT, default ./work); originals are only ever read.
#
# Usage: labtool.sh doctor
#        labtool.sh copy <original> <name>                 -> work/<name>/<file>
#        labtool.sh patch-string <file> <old> <new> [auto|utf16|ascii]
#        labtool.sh patch-bytes <file> <hex-offset> <new-hex> <expected-old-hex>
#        labtool.sh diff <file>                             (against its .orig backup)
#        labtool.sh build-cs <out.exe> [--winexe] <src.cs>... [-- <extra csc args>]
#        labtool.sh decompile-net <assembly> <outdir-name>  (ilspycmd -> compilable C# project in work/)
#        labtool.sh dotnet <args...>                        (SDK build/run; project must be under work/)
#        labtool.sh run <exe> [args...]                     (console; timeout, captured output)
#        labtool.sh wait-file <path> [seconds]              (poll for a side-effect marker)
#        labtool.sh launch <exe> [args...]                  (GUI; detached, returns at once)
set -u

# Work root is anchored to the workspace, NOT to the current directory, so cd-ing into a
# subfolder never changes it. Order: $SBA_WORK_ROOT, else the nearest ancestor holding
# AGENTS.md or an existing work/, else $PWD/work.
resolve_work_root() {
  if [[ -n "${SBA_WORK_ROOT:-}" ]]; then realpath -m -- "$SBA_WORK_ROOT"; return; fi
  local d; d="$(realpath -m -- "$PWD")"
  while [[ "$d" != / ]]; do
    [[ -e "$d/AGENTS.md" || -d "$d/work" ]] && { echo "$d/work"; return; }
    d="$(dirname -- "$d")"
  done
  echo "$(realpath -m -- "$PWD")/work"
}
WORK_ROOT="$(resolve_work_root)"

# Make a user-local .NET SDK (~/.dotnet) usable regardless of the caller's environment.
if [[ -d "$HOME/.dotnet" ]]; then
  export DOTNET_ROOT="$HOME/.dotnet"
  export PATH="$HOME/.dotnet:$HOME/.dotnet/tools:$PATH"
  export DOTNET_ROLL_FORWARD="${DOTNET_ROLL_FORWARD:-Major}"
  export DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_NOLOGO=1
fi
RUN_TIMEOUT="${SBA_RUN_TIMEOUT:-30}"
CSC_CANDIDATES=(/mnt/c/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe /mnt/c/Windows/Microsoft.NET/Framework/v4.0.30319/csc.exe)

usage() { sed -n '5,12p' "$0" | sed 's/^# //' >&2; exit 2; }
die() { echo "error: $*" >&2; exit 1; }

to_linux() {
  local p="$1"
  [[ "$p" =~ ^[A-Za-z]:[\\/] ]] && p="$(wslpath -u "$p")"
  realpath -m -- "$p"
}

in_work() {
  local p; p="$(to_linux "$1")"
  [[ "$p" == "$WORK_ROOT"/* ]] || die "$p is outside the work root $WORK_ROOT; only copies there may be modified or run"
  echo "$p"
}

find_csc() { local c; for c in "${CSC_CANDIDATES[@]}"; do [[ -x "$c" ]] && { echo "$c"; return 0; }; done; return 1; }

doctor() {
  local interop=disabled csc dotnet=""
  grep -q enabled /proc/sys/fs/binfmt_misc/WSLInterop 2>/dev/null && interop=enabled
  csc="$(find_csc || true)"
  [[ -x "/mnt/c/Program Files/dotnet/dotnet.exe" ]] && dotnet="/mnt/c/Program Files/dotnet/dotnet.exe"
  jq -n --arg root "$WORK_ROOT" --arg interop "$interop" --arg csc "$csc" --arg dotnet "$dotnet" \
    --arg mingw "$(command -v x86_64-w64-mingw32-gcc || true)" \
    '{workRoot:$root, wslInterop:$interop, csc:(if $csc=="" then null else $csc end),
      dotnet:(if $dotnet=="" then null else $dotnet end), mingw:(if $mingw=="" then null else $mingw end),
      notes:["csc is the .NET Framework 4 C# compiler (C# 5 language level: no string interpolation, no expression-bodied members).",
             "Windows programs run from WSL through interop; GUI windows appear on the Windows desktop.",
             "Windows cannot see Linux exec bits: labtool marks built and copied .exe files executable for WSL."]}'
}

cmd_copy() {
  local src name dir dest
  src="$(to_linux "${1:-}")"; name="${2:-}"
  [[ -f "$src" && -n "$name" ]] || usage
  [[ "$name" =~ ^[A-Za-z0-9._-]+$ ]] || die "name must be [A-Za-z0-9._-]+"
  dir="$WORK_ROOT/$name"; dest="$dir/$(basename -- "$src")"
  [[ -e "$dest" ]] && die "$dest already exists; pick another name or remove the old copy"
  mkdir -p -- "$dir" && cp -- "$src" "$dest" && chmod u+w,a+x -- "$dest" || die "copy failed"
  jq -n --arg source "$src" --arg copy "$dest" --arg sha "$(sha256sum -- "$src" | cut -d' ' -f1)" \
    '{source:$source, sourceSha256:$sha, copy:$copy}' | tee "$dir/ORIGIN.json"
}

backup_once() { [[ -e "$1.orig" ]] || cp -p -- "$1" "$1.orig"; }

# Prints "offset" of each occurrence of the byte string given as hex.
find_hex() {
  local file="$1" hex="$2"
  od -An -v -tx1 -- "$file" | tr -d ' \n' | grep -ob -- "$hex" | while IFS=: read -r pos _; do
    (( pos % 2 == 0 )) && echo $(( pos / 2 ))
  done
}

encode() {
  local enc="$1" text="$2"
  if [[ "$enc" == utf16 ]]; then printf '%s' "$text" | iconv -f UTF-8 -t UTF-16LE | od -An -v -tx1 | tr -d ' \n'
  else printf '%s' "$text" | od -An -v -tx1 | tr -d ' \n'; fi
}

hexdump_at() { xxd -s "$2" -l "$3" -- "$1"; }

cmd_patch_string() {
  local file old new enc="${4:-auto}" e oldhex newhex hits offset pad
  file="$(in_work "${1:-}")" || exit 1; old="${2:-}"; new="${3-}"
  [[ -f "$file" && -n "$old" ]] || usage
  for e in $([[ "$enc" == auto ]] && echo "utf16 ascii" || echo "$enc"); do
    oldhex="$(encode "$e" "$old")"
    hits="$(find_hex "$file" "$oldhex")"
    [[ -n "$hits" ]] && { enc="$e"; break; }
  done
  [[ -n "$hits" ]] || die "'$old' not found as ${enc/auto/utf16 or ascii}"
  (( $(wc -l <<<"$hits") == 1 )) || die "'$old' occurs $(wc -l <<<"$hits") times ($enc); patch a unique string or use patch-bytes"
  newhex="$(encode "$enc" "$new")"
  (( ${#newhex} <= ${#oldhex} )) || die "new string is longer than the old one (${#newhex} vs ${#oldhex} hex digits); in-place patches cannot grow"
  pad=$(( (${#oldhex} - ${#newhex}) / 2 ))
  offset="$hits"
  backup_once "$file"
  echo "encoding=$enc offset=0x$(printf '%x' "$offset") old_bytes=$(( ${#oldhex} / 2 )) new_bytes=$(( ${#newhex} / 2 )) nul_padding=$pad"
  echo "before:"; hexdump_at "$file" "$offset" $(( ${#oldhex} / 2 + 2 ))
  { printf '%s' "$newhex" | xxd -r -p; head -c "$pad" /dev/zero; } | dd of="$file" bs=1 seek="$offset" conv=notrunc status=none
  echo "after:"; hexdump_at "$file" "$offset" $(( ${#oldhex} / 2 + 2 ))
}

cmd_patch_bytes() {
  local file off new expect cur
  file="$(in_work "${1:-}")" || exit 1; off="${2:-}"; new="${3:-}"; expect="${4:-}"
  [[ -f "$file" && "$off" =~ ^0x[0-9a-fA-F]+$ && "$new" =~ ^([0-9a-fA-F]{2})+$ && -n "$expect" ]] || usage
  (( ${#new} == ${#expect} )) || die "new and expected-old must be the same length"
  cur="$(xxd -p -s "$off" -l $(( ${#expect} / 2 )) -- "$file" | tr -d '\n')"
  [[ "${cur,,}" == "${expect,,}" ]] || die "bytes at $off are $cur, expected $expect; refusing to patch"
  backup_once "$file"
  echo "before:"; hexdump_at "$file" "$off" $(( ${#new} / 2 ))
  printf '%s' "$new" | xxd -r -p | dd of="$file" bs=1 seek=$(( off )) conv=notrunc status=none
  echo "after:"; hexdump_at "$file" "$off" $(( ${#new} / 2 ))
}

cmd_diff() {
  local file; file="$(in_work "${1:-}")" || exit 1
  [[ -f "$file.orig" ]] || die "no backup $file.orig (nothing patched yet)"
  cmp -l -- "$file.orig" "$file" | awk '{printf "0x%x %02x -> %02x\n", $1-1, strtonum("0"$2), strtonum("0"$3)}' | head -200
  echo "changed_bytes=$(cmp -l -- "$file.orig" "$file" | wc -l)"
}

cmd_build_cs() {
  local out csc target=exe srcs=() extra=() s
  out="$(in_work "${1:-}")" || exit 1; shift || usage
  csc="$(find_csc)" || die "csc.exe not found under C:\\Windows\\Microsoft.NET"
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --winexe) target=winexe ;;
      --) shift; extra=("$@"); break ;;
      *) s="$(to_linux "$1")"; [[ -f "$s" ]] || die "no such source $1"; srcs+=("$(wslpath -w "$s")") ;;
    esac
    shift
  done
  (( ${#srcs[@]} > 0 )) || usage
  mkdir -p -- "$(dirname -- "$out")"
  "$csc" /nologo /target:"$target" /out:"$(wslpath -w "$out")" "${extra[@]}" "${srcs[@]}" 2>&1 | tr -d '\r'
  local rc=${PIPESTATUS[0]}
  [[ $rc -eq 0 && -f "$out" ]] || die "csc failed (exit $rc)"
  chmod a+x -- "$out"
  echo "built $out ($(stat -c %s -- "$out") bytes, target=$target)"
}

cmd_run() {
  local exe; exe="$(in_work "${1:-}")" || exit 1; shift
  [[ -f "$exe" ]] || die "no such program $exe"
  chmod a+x -- "$exe"
  local out err rc
  out="$(mktemp)"; err="$(mktemp)"
  (cd -- "$(dirname -- "$exe")" && timeout "$RUN_TIMEOUT" "./$(basename -- "$exe")" "$@" >"$out" 2>"$err" </dev/null)
  rc=$?
  echo "exit=$rc$([[ $rc -eq 124 ]] && echo " (timed out after ${RUN_TIMEOUT}s; a GUI program never exits: use launch)")"
  echo "--- stdout"; tr -d '\r' <"$out" | head -200
  echo "--- stderr"; tr -d '\r' <"$err" | head -60
  rm -f -- "$out" "$err"
  return 0
}

cmd_decompile_net() {
  local src outname out
  src="$(to_linux "${1:-}")"; outname="${2:-}"
  [[ -f "$src" && -n "$outname" ]] || usage
  command -v ilspycmd >/dev/null 2>&1 || die "ilspycmd not found (install the .NET SDK, then: dotnet tool install -g ilspycmd)"
  out="$(in_work "$outname")" || exit 1
  mkdir -p -- "$out"
  # Whole-assembly export to a compilable C# project (ilspycmd -p).
  ilspycmd -p -o "$out" "$src" 2>&1 | tr -d '\r' | tail -20
  echo "decompiled $src -> $out"
  find "$out" -maxdepth 1 -type f | sort
}

cmd_dotnet() {
  command -v dotnet >/dev/null 2>&1 || die "dotnet SDK not found under ~/.dotnet"
  local first; first="$(to_linux "${1:-$PWD}")"
  # The first path-like argument (project/dir/output) must be inside work/.
  [[ "$first" == "$WORK_ROOT"/* ]] || die "dotnet builds stay under the work root; '$first' is outside it"
  ( cd -- "$WORK_ROOT" && dotnet "$@" 2>&1 | tr -d '\r' )
}

cmd_wait_file() {
  local f timeout i
  f="$(in_work "${1:-}")" || exit 1
  timeout="${2:-15}"
  for (( i = 0; i < timeout * 2; i++ )); do
    [[ -e "$f" ]] && { echo "appeared after ~$(( i / 2 ))s: $f"; [[ -s "$f" ]] && { echo "--- contents"; head -40 -- "$f"; }; return 0; }
    sleep 0.5
  done
  die "timed out after ${timeout}s waiting for $f (end-to-end chain did not produce it)"
}

cmd_launch() {
  local exe; exe="$(in_work "${1:-}")" || exit 1; shift
  [[ -f "$exe" ]] || die "no such program $exe"
  chmod a+x -- "$exe"
  (cd -- "$(dirname -- "$exe")" && setsid "./$(basename -- "$exe")" "$@" >/dev/null 2>&1 </dev/null &)
  echo "launched $exe on the Windows desktop (working directory $(dirname -- "$exe")). Ask the Human what they see."
}

case "${1:-}" in
  doctor) doctor ;;
  copy) shift; cmd_copy "$@" ;;
  patch-string) shift; cmd_patch_string "$@" ;;
  patch-bytes) shift; cmd_patch_bytes "$@" ;;
  diff) shift; cmd_diff "$@" ;;
  build-cs) shift; cmd_build_cs "$@" ;;
  decompile-net) shift; cmd_decompile_net "$@" ;;
  dotnet) shift; cmd_dotnet "$@" ;;
  run) shift; cmd_run "$@" ;;
  wait-file) shift; cmd_wait_file "$@" ;;
  launch) shift; cmd_launch "$@" ;;
  *) usage ;;
esac
