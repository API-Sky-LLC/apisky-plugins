#!/usr/bin/env bash
# Read-only static inspection for the StaticBinaryAnalysis skill. Never executes the target.
#
# Usage: inspect.sh doctor
#        inspect.sh manifest|inventory <path>
#        inspect.sh decompile <path> [function-or-class]
#        inspect.sh verify <path> <term> [term...]
#
# <path> may be a Linux path or a Windows path (C:\...), which is converted with wslpath.
# Exit codes: 0 ok, 1 error, 2 usage, 3 this mode is unsupported for the format or lacks a tool.
#
# Environment: SBA_RIZIN (rizin binary), SBA_TIMEOUT (seconds per tool call, default 300),
# SBA_LINES (excerpt line cap, default 160), SBA_CACHE (analysis cache dir).
set -u

TIMEOUT="${SBA_TIMEOUT:-300}"
LINES="${SBA_LINES:-160}"
CACHE="${SBA_CACHE:-${XDG_CACHE_HOME:-$HOME/.cache}/static-binary-analysis}"
RZ_OPTS=(-q -e scr.color=0 -e scr.utf8=false -e scr.interactive=false -e bin.relocs.apply=true)
RIZIN_URL="https://github.com/rizinorg/rizin/releases"

usage() {
  sed -n '4,7p' "$0" | sed 's/^# //' >&2
  exit 2
}

find_tool() {
  local name="$1" candidate
  command -v "$name" 2>/dev/null && return 0
  for candidate in "$HOME/.local/bin/$name" "$HOME/.dotnet/tools/$name" "/usr/local/bin/$name" "/opt/$name/bin/$name"; do
    [[ -x "$candidate" ]] && { echo "$candidate"; return 0; }
  done
  return 1
}

# Make a user-local .NET SDK (installed under ~/.dotnet) usable regardless of the caller's
# environment: ilspycmd 9.x targets .NET 8, so roll forward across the major version.
if [[ -d "$HOME/.dotnet" ]]; then
  export DOTNET_ROOT="$HOME/.dotnet"
  export PATH="$HOME/.dotnet:$HOME/.dotnet/tools:$PATH"
  export DOTNET_ROLL_FORWARD="${DOTNET_ROLL_FORWARD:-Major}"
  export DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_NOLOGO=1
fi

RIZIN="${SBA_RIZIN:-$(find_tool rizin || true)}"
JAVAP="$(find_tool javap || true)"
ILSPY="$(find_tool ilspycmd || true)"
JADX="$(find_tool jadx || true)"

section() { printf '\n=== %s ===\n' "$1"; }

SCRATCH=""
scratch_dir() {
  [[ -n "$SCRATCH" ]] || SCRATCH="$(mktemp -d)"
}
trap '[[ -n "$SCRATCH" ]] && rm -rf -- "$SCRATCH"' EXIT

doctor() {
  local tool path missing_required=() missing_recommended=() json='{}'
  for tool in file jq sha256sum stat strings objdump readelf unzip timeout flock; do
    path="$(find_tool "$tool" || true)"
    [[ -z "$path" ]] && missing_required+=("$tool")
    json="$(jq -c --arg t "$tool" --arg p "$path" '.required[$t] = (if $p == "" then null else $p end)' <<<"$json")"
  done
  json="$(jq -c --arg p "$RIZIN" '.recommended.rizin = (if $p == "" then null else $p end)' <<<"$json")"
  [[ -z "$RIZIN" ]] && missing_recommended+=(rizin)
  for tool in javap ilspycmd jadx; do
    path="$(find_tool "$tool" || true)"
    json="$(jq -c --arg t "$tool" --arg p "$path" '.optional[$t] = (if $p == "" then null else $p end)' <<<"$json")"
  done
  jq -n --argjson tools "$json" \
    --argjson req "$(printf '%s\n' "${missing_required[@]}" | jq -R . | jq -sc 'map(select(. != ""))')" \
    --argjson rec "$(printf '%s\n' "${missing_recommended[@]}" | jq -R . | jq -sc 'map(select(. != ""))')" \
    --arg rizinUrl "$RIZIN_URL" \
    '$tools + {
      ok: ($req | length == 0),
      missingRequired: $req,
      missingRecommended: $rec,
      install: {
        required: "sudo apt install file jq coreutils binutils unzip util-linux",
        rizin: ("Native call-level evidence and 32-bit/ARM/Mach-O disassembly need rizin. Without sudo: download rizin-*-static-x86_64.tar.xz from " + $rizinUrl + ", extract it to ~/.local/opt/rizin, and link bin/rizin into ~/.local/bin (or set SBA_RIZIN)."),
        javap: "Java class/JAR disassembly: sudo apt install default-jdk-headless",
        ilspycmd: ".NET decompilation: install the .NET SDK, then dotnet tool install -g ilspycmd",
        jadx: "Android APK decompilation: download jadx from https://github.com/skylot/jadx/releases"
      }
    }'
}

resolve_target() {
  local p="$1"
  if [[ "$p" =~ ^[A-Za-z]:[\\/] ]] && command -v wslpath >/dev/null 2>&1; then
    p="$(wslpath -u "$p")"
  fi
  realpath -e -- "$p" 2>/dev/null
}

classify() {
  desc="$(file -bL -- "$target")"
  format=unsupported kind=unknown arch=unknown bits=0
  case "$desc" in
    PE32+*) format="PE32+" kind=native bits=64 ;;
    PE32*) format=PE32 kind=native bits=32 ;;
    "ELF 64-bit"*) format=ELF64 kind=native bits=64 ;;
    "ELF 32-bit"*) format=ELF32 kind=native bits=32 ;;
    *"Mach-O universal"*) format=Mach-O-universal kind=native arch=multi ;;
    *"Mach-O 64-bit"*) format=Mach-O kind=native bits=64 ;;
    *Mach-O*) format=Mach-O kind=native bits=32 ;;
    "compiled Java class"*) format=class kind=java arch=jvm ;;
    *Zip* | *"Java archive"* | *"Android package"* | *JAR*)
      local entries
      entries="$(unzip -Z1 -- "$target" 2>/dev/null)"
      if grep -qx 'AndroidManifest.xml' <<<"$entries"; then
        format=APK kind=android arch=dalvik
      elif grep -q '\.class$' <<<"$entries"; then
        format=JAR kind=java arch=jvm
      else
        format=zip kind=archive
      fi
      ;;
  esac
  [[ "$desc" == *"Mono/.Net assembly"* ]] && kind=dotnet
  if [[ ("$kind" == native || "$kind" == dotnet) && "$arch" == unknown ]]; then
    case "$desc" in
      *x86-64* | *x86_64*) arch=x86-64 ;;
      *[Aa]arch64* | *ARM64* | *arm64*) arch=arm64 ;;
      *80386* | *i386* | *"Intel 386"*) arch=x86 ;;
      *ARM* | *arm*) arch=arm ;;
      *MIPS*) arch=mips ;;
      *PowerPC* | *ppc*) arch=ppc ;;
      *RISC-V*) arch=riscv ;;
    esac
  fi
}

analyzers() {
  case "$kind" in
    native)
      if [[ -n "$RIZIN" ]]; then inv=rizin dec=rizin ver=rizin-xrefs
      elif objdump -f -- "$target" >/dev/null 2>&1; then inv=objdump dec=objdump ver=presence
      else inv=strings dec=none ver=presence
      fi ;;
    dotnet) inv="${RIZIN:+rizin}"; inv="${inv:-objdump}"; dec="${ILSPY:+ilspycmd}"; dec="${dec:-none}"; ver=presence ;;
    java) inv=javap dec="${JAVAP:+javap}"; dec="${dec:-none}"; ver="${JAVAP:+javap-bytecode}"; ver="${ver:-presence}" ;;
    android) inv=unzip dec="${JADX:+jadx}"; dec="${dec:-none}"; ver=presence ;;
    archive) inv=unzip dec=none ver=presence ;;
    *) inv=none dec=none ver=none ;;
  esac
}

missing_tools_json() {
  local missing=()
  [[ "$kind" == native || "$kind" == dotnet ]] && [[ -z "$RIZIN" ]] && missing+=(rizin)
  [[ "$kind" == java && -z "$JAVAP" ]] && missing+=(javap)
  [[ "$kind" == dotnet && -z "$ILSPY" ]] && missing+=(ilspycmd)
  [[ "$kind" == android && -z "$JADX" ]] && missing+=(jadx)
  printf '%s\n' "${missing[@]}" | jq -R . | jq -sc 'map(select(. != ""))'
}

# Cached rizin analysis, keyed by content hash and path, shared by concurrent callers.
project=""
ensure_project() {
  [[ -n "$RIZIN" ]] || return 1
  local analysis="${SBA_ANALYSIS:-}"
  if [[ -z "$analysis" ]]; then
    if (( size > 40 * 1024 * 1024 )); then analysis=aa; else analysis=aaa; fi
  fi
  mkdir -p "$CACHE" || return 1
  project="$CACHE/${sha:0:16}-$(printf '%s' "$target" | sha256sum | cut -c1-8)-$analysis.rzdb"
  [[ -s "$project" ]] && return 0
  (
    flock 9
    if [[ ! -s "$project" ]]; then
      local tmp="$project.tmp.$$"
      if timeout "$TIMEOUT" "$RIZIN" "${RZ_OPTS[@]}" -c "$analysis" -c "Ps $tmp" -- "$target" >/dev/null 2>&1 && [[ -s "$tmp" ]]; then
        mv -f -- "$tmp" "$project"
      else
        rm -f -- "$tmp"
      fi
    fi
  ) 9>"$project.lock"
  [[ -s "$project" ]] || { project=""; return 1; }
}

rzq() {
  if [[ -n "$project" ]]; then
    timeout "$TIMEOUT" "$RIZIN" "${RZ_OPTS[@]}" -p "$project" "$@" 2>/dev/null
  else
    timeout "$TIMEOUT" "$RIZIN" "${RZ_OPTS[@]}" -c aa "$@" -- "$target" 2>/dev/null
  fi
}

JQ_HEX='def hex: if . == null then "?" elif . == 0 then "0x0" else "0x" + ([recurse(if . >= 16 then (. / 16 | floor) else empty end) | . % 16 | "0123456789abcdef"[.:.+1]] | reverse | join("")) end;'

manifest() {
  analyzers
  jq -n \
    --arg path "$target" --arg name "$(basename -- "$target")" \
    --arg format "$format" --arg kind "$kind" --arg arch "$arch" --argjson bits "$bits" \
    --argjson size "$size" --arg sha256 "$sha" --arg description "$desc" \
    --arg inv "$inv" --arg dec "$dec" --arg ver "$ver" --argjson missing "$(missing_tools_json)" \
    '{target: {path:$path, name:$name, format:$format, kind:$kind, arch:$arch, bits:$bits, size:$size, sha256:$sha256},
      description: $description,
      analyzers: {inventory:$inv, decompile:$dec, verify:$ver},
      missingTools: $missing}'
}

strings_block() {
  section "strings (ascii, -n 6, first 80)"; strings -n 6 -- "$target" | head -80
  section "wide strings (UTF-16LE, -n 6, first 60)"; strings -n 6 -e l -- "$target" | head -60
}

inventory_native_rizin() {
  local out
  out="$(timeout "$TIMEOUT" "$RIZIN" "${RZ_OPTS[@]}" -c iIj -c iSj -c iij -c iEj -c iej -c ilj -- "$target" 2>/dev/null)"
  line() { sed -n "${1}p" <<<"$out"; }
  section "tool"; echo "rizin $("$RIZIN" -v | head -1 | awk '{print $2}') (static, no execution)"
  section "file"; echo "$desc"
  section "info"
  line 1 | jq -r '"class=\(.class) arch=\(.arch) bits=\(.bits) os=\(.os) subsys=\(.subsys) machine=\(.machine) lang=\(.lang) stripped=\(.stripped) static=\(.static) signed=\(.signed // "unknown") compiled=\(.compiled // "")"'
  section "sections (name size vsize perm, max 40)"
  line 2 | jq -r '.[:40][] | "\(.name)\t\(.size)\t\(.vsize)\t\(.perm)"'
  section "libraries"
  line 6 | jq -r '.[]?'
  section "imports by library (max 30 libraries, 40 functions each)"
  line 3 | jq -r 'group_by(.libname // "") | .[:30][] | "\(.[0].libname // "(unbound)") [\(length)]: \([.[].name][:40] | join(", "))"'
  section "exports (count, first 40)"
  line 4 | jq -r 'length as $n | "count=\($n)", (.[:40][] | .name)'
  section "entry points"
  line 5 | jq -r "$JQ_HEX"' .[] | "\(.type) \(.vaddr | hex)"'
  strings_block
}

inventory_native_objdump() {
  section "tool"; echo "objdump/readelf (rizin not installed: no xrefs, limited formats)"
  section "file"; echo "$desc"
  section "sections (objdump -h)"; objdump -h -- "$target" 2>&1 | sed -n '6,60p'
  case "$format" in
    ELF*) section "dynamic (readelf -d)"; readelf -d -- "$target" 2>&1 | head -60 ;;
    PE*)
      section "imports (objdump -p)"
      objdump -p -- "$target" 2>&1 | awk '/DLL Name:/{print; n=0; next} /^\s+[0-9a-f]+\s+[0-9]+\s+\S+/{if(n++<30)print}' | head -160 ;;
  esac
  strings_block
}

jar_main_class() {
  unzip -p -- "$target" META-INF/MANIFEST.MF 2>/dev/null | tr -d '\r' | awk -F': *' '$1=="Main-Class"{print $2; exit}'
}

jar_classes() {
  unzip -Z1 -- "$target" 2>/dev/null | grep '\.class$' | grep -v 'module-info\|\$' | sed 's/\.class$//; s#/#.#g'
}

inventory_java() {
  section "tool"; echo "unzip + javap (static, no execution)"
  section "file"; echo "$desc"
  if [[ "$format" == class ]]; then
    section "class (javap -p)"; [[ -n "$JAVAP" ]] && "$JAVAP" -p -- "$target" 2>&1 | head -80
  else
    section "manifest (META-INF/MANIFEST.MF)"; unzip -p -- "$target" META-INF/MANIFEST.MF 2>/dev/null | tr -d '\r' | head -30
    section "entries (count, first 80 classes)"
    echo "entries=$(unzip -Z1 -- "$target" 2>/dev/null | wc -l) classes=$(jar_classes | wc -l)"
    jar_classes | head -80
    local main; main="$(jar_main_class)"
    if [[ -n "$main" && -n "$JAVAP" ]]; then
      section "main class $main (javap -p)"; "$JAVAP" -p -classpath "$target" "$main" 2>&1 | head -60
    fi
  fi
  section "class-file strings (constant pools, -n 6, first 80)"
  if [[ "$format" == class ]]; then strings -n 6 -- "$target"; else unzip -p -- "$target" '*.class' 2>/dev/null | strings -n 6; fi | awk '!seen[$0]++' | head -80
}

inventory_zip() {
  section "tool"; echo "unzip (listing only)"
  section "file"; echo "$desc"
  section "entries (size name, first 120)"
  unzip -Z -s -- "$target" 2>/dev/null | awk 'NR>1 && NF>=9 {print $4"\t"$NF}' | head -120
  [[ "$kind" == android ]] && { section "dex files"; unzip -Z1 -- "$target" | grep '\.dex$'; }
}

# Stripped CRT start-up: the program's main is the last internal call before exit, in entry0
# or one level below it (MSVC entry0 -> __scrt_common_main_seh -> main).
guess_main() {
  local fn
  for fn in entry0 $(rzq -c 'pdsf @ entry0' | awk '$2=="call" && $3 ~ /^fcn\./ {print $3}' | awk '!seen[$0]++' | head -4); do
    rzq -c "pdsf @ $fn" | awk '
      $2=="call" && $3 ~ /^fcn\./ { last=$3; next }
      $2=="call" && !/amsg_exit/ && /[._](exit|_exit|_cexit|ExitProcess)\]?( |$)/ && last { print last; found=1; exit }
      END { if (!found) exit 1 }' && return 0
  done
  return 1
}

decompile_native_rizin() {
  ensure_project
  local want="${1:-}" sel note="" tmp
  scratch_dir; tmp="$SCRATCH"
  rzq -c aflj >"$tmp/funcs.json"
  [[ -s "$tmp/funcs.json" ]] || echo '[]' >"$tmp/funcs.json"
  if [[ -n "$want" ]]; then
    sel="$want"
  else
    sel="$(jq -r '[.[].name] as $n | ["main","sym.main","sym._main","dbg.main","sym.WinMain","sym.wWinMain","sym.wmain","sym.DllMain","sym._DllMain"] | map(select(. as $c | $n | index($c))) | .[0] // ""' "$tmp/funcs.json")"
    if [[ -z "$sel" ]]; then
      if sel="$(guess_main)"; then
        note="no main symbol; $sel is the last internal call before exit in the start-up code (heuristic)"
      else
        sel=entry0 note="no main symbol and no start-up pattern; showing entry0"
      fi
    fi
  fi
  rzq -c "afij @ $sel" >"$tmp/fn.json"
  rzq -c iij >"$tmp/imports.json"
  section "tool"
  echo "rizin $("$RIZIN" -v | head -1 | awk '{print $2}'): annotated disassembly with recovered signatures, not decompiled source"
  section "analysis"
  echo "functions=$(jq 'length' "$tmp/funcs.json") selected=$sel cache=${project:-none}"
  [[ -n "$note" ]] && echo "note: $note"
  section "function"
  jq -r "$JQ_HEX"' .[0] // {} | "name=\(.name // "?") offset=\(.offset | hex) size=\(.size // "?") blocks=\(.nbbs // "?") signature=\(.signature // "?")"' "$tmp/fn.json"
  section "summary of $sel (calls, strings, arguments)"
  rzq -c "pdsf @ $sel" | awk '!seen[$0]++' | head -80
  # pdf renders the whole function graph first, which takes minutes on very large functions.
  if (( $(jq '.[0].size // 0' "$tmp/fn.json") <= 1500 )); then
    section "disassembly of $sel (pdf, first $LINES lines)"
    rzq -c "pdf @ $sel" | head -"$LINES"
  else
    section "disassembly of $sel (linear pd, first $LINES instructions of a large function)"
    rzq -c "pd $LINES @ $sel"
  fi
  section "direct callees of $sel"
  local callees
  callees="$(jq -r --slurpfile funcs "$tmp/funcs.json" --slurpfile imports "$tmp/imports.json" "$JQ_HEX"'
    (.[0].callrefs // []) | map(.to) | unique | .[] as $to
    | ($funcs[0] | map(select(.offset == $to)) | .[0].name) as $fn
    | ($imports[0] | map(select(.plt == $to)) | .[0]) as $imp
    | if $fn and ($fn | startswith("sym.imp.")) then "import \($fn | ltrimstr("sym.imp.")) \($to | hex)"
      elif $fn then "internal \($fn) \($to | hex)"
      elif $imp then "import \($imp.libname // "")!\($imp.name) \($to | hex)"
      else "unknown \($to | hex)" end' "$tmp/fn.json")"
  echo "$callees" | head -60
  local k name n=0
  while read -r k name _; do
    [[ "$k" == internal ]] || continue
    (( n++ >= 5 )) && break
    section "summary of callee $name"
    rzq -c "pdsf @ $name" | awk '!seen[$0]++' | head -25
  done <<<"$callees"
}

decompile_native_objdump() {
  local entry
  entry="$(objdump -f -- "$target" 2>/dev/null | awk '/start address/{print $3}')"
  if [[ -z "$entry" ]]; then
    echo "error: objdump cannot read this $format/$arch file and rizin is not installed. $(doctor | jq -r .install.rizin)" >&2
    exit 3
  fi
  section "tool"; echo "objdump: instruction excerpt, not decompiled source (rizin not installed)"
  section "entry"; echo "$entry"
  dump() {
    local from="$1" stop
    stop="$(printf '0x%x' $((from + 0x180)))"
    section "objdump -d $from..$stop"
    objdump -d --no-show-raw-insn --start-address="$from" --stop-address="$stop" -- "$target" 2>&1 | sed -n '7,$p' | awk '/\tint3/{if(++pad>2)exit; next} {pad=0; print}' | head -90
  }
  dump "$entry"
  objdump -d --no-show-raw-insn --start-address="$entry" --stop-address="$(printf '0x%x' $((entry + 0x40)))" -- "$target" 2>/dev/null \
    | awk '$2 ~ /^(call|jmp)$/ && $3 ~ /^0x[0-9a-f]+$/ {print $3}' | head -3 | while read -r next; do dump "$next"; done
}

decompile_java() {
  [[ -n "$JAVAP" ]] || { echo "error: javap not installed. $(doctor | jq -r .install.javap)" >&2; exit 3; }
  section "tool"; echo "javap -c -p: JVM bytecode listing, not decompiled source"
  if [[ "$format" == class ]]; then
    "$JAVAP" -c -p -- "$target" 2>&1 | head -"$LINES"
    return
  fi
  local cls="${1:-$(jar_main_class)}"
  [[ -n "$cls" ]] || cls="$(jar_classes | head -1)"
  section "class $cls"
  "$JAVAP" -c -p -classpath "$target" "$cls" 2>&1 | head -"$LINES"
}

decompile_dotnet() {
  [[ -n "$ILSPY" ]] || { echo "error: managed .NET assembly; ilspycmd is not installed. $(doctor | jq -r .install.ilspycmd)" >&2; exit 3; }
  section "tool"; echo "ilspycmd $("$ILSPY" --version 2>/dev/null | head -1): decompiled C# (managed code)"
  if [[ -n "${1:-}" ]]; then
    section "type ${1}"
    timeout "$TIMEOUT" "$ILSPY" -t "$1" "$target" 2>&1 | head -"$LINES"
  else
    section "assembly (first $LINES lines; pass a type name for the full type)"
    timeout "$TIMEOUT" "$ILSPY" "$target" 2>&1 | head -"$LINES"
  fi
}

decompile_android() {
  [[ -n "$JADX" ]] || { echo "error: Android package; jadx is not installed. $(doctor | jq -r .install.jadx)" >&2; exit 3; }
  local tmp; scratch_dir; tmp="$SCRATCH"
  timeout "$TIMEOUT" "$JADX" --no-res -d "$tmp" -- "$target" >/dev/null 2>&1
  section "tool"; echo "jadx: decompiled Java from dex"
  find "$tmp" -name '*.java' | head -3 | while read -r f; do section "${f#"$tmp"/}"; head -80 -- "$f"; done
}

verify_native_rizin() {
  ensure_project
  jq -rn --slurpfile all <(rzq -c iij -c izzj -c aflj -c axlj) \
    --argjson terms "$(printf '%s\n' "$@" | jq -R . | jq -sc .)" "$JQ_HEX"'
    ($all[0] // []) as $imports | ($all[1] // []) as $strings | ($all[2] // []) as $funcs | ($all[3] // []) as $xrefs
    | def owner($a): ($funcs | map(select(.offset <= $a and $a < (.offset + .size))) | .[0].name) // "?";
      def sites($to; $types): [$xrefs[] | select(.to == $to and (.type as $t | $types | index($t)))] | map("\(owner(.from))@\(.from | hex)") | unique;
    $terms[] as $term
    | ([$imports[] | select(.name == $term or ((.libname // "") + "_" + .name) == $term)] | if length == 0 then [$imports[] | select(.name | contains($term))] else . end) as $imp
    | ([$funcs[] | select(.name == $term or (.name | endswith("." + $term)))]) as $fn
    | ([$strings[] | select(.string | contains($term))]) as $str
    | ([$imp[] | sites(.plt; ["CALL","CODE"])[]] + [$fn[] | sites(.offset; ["CALL","CODE"])[]] | unique) as $calls
    | ([$str[] | sites(.vaddr; ["DATA","STRING","CODE"])[]] + [$imp[] | sites(.plt; ["DATA"])[]] | unique) as $refs
    | if ($calls | length) > 0 then
        "CALLED     \($term) (\(if ($imp | length) > 0 then "import \($imp[0].libname // "")!\($imp[0].name)" else "function \($fn[0].name)" end); call sites: \($calls[:6] | join(", ")))"
      elif ($refs | length) > 0 then
        "REFERENCED \($term) (\(if ($str | length) > 0 then "\($str[0].type) string at \($str[0].vaddr | hex)" else "import \($imp[0].name)" end); referenced from: \($refs[:6] | join(", ")))"
      elif ($imp | length) + ($fn | length) + ($str | length) > 0 then
        "PRESENT    \($term) (\([if ($imp | length) > 0 then "import" else empty end, if ($fn | length) > 0 then "function" else empty end, if ($str | length) > 0 then "string" else empty end] | join("+")); no code reference found)"
      else "NOT_FOUND  \($term)" end'
}

verify_presence() {
  local imports term ascii wide imp
  imports="$(objdump -p -- "$target" 2>/dev/null; readelf -d --dyn-syms -- "$target" 2>/dev/null || true)"
  for term in "$@"; do
    ascii="$(strings -n 4 -- "$target" | grep -cF -- "$term")"
    wide="$(strings -n 4 -e l -- "$target" | grep -cF -- "$term")"
    imp="$(printf '%s\n' "$imports" | grep -cF -- "$term")"
    if (( ascii + wide + imp > 0 )); then
      printf 'PRESENT    %s (ascii=%s wide=%s imports=%s; call-level evidence unavailable)\n' "$term" "$ascii" "$wide" "$imp"
    else
      printf 'NOT_FOUND  %s\n' "$term"
    fi
  done
}

verify_java() {
  local listing pool term
  if [[ "$format" == class ]]; then
    listing="$("$JAVAP" -c -p -- "$target" 2>/dev/null)"
    pool="$(strings -n 4 -- "$target")"
  else
    listing="$(jar_classes | head -300 | xargs -r "$JAVAP" -c -p -classpath "$target" 2>/dev/null)"
    pool="$(unzip -p -- "$target" '*.class' 2>/dev/null | strings -n 4)"
  fi
  for term in "$@"; do
    # javap prints member references as java/util/List.add and declarations as java.util.List.
    local variants=(-e "$term" -e "${term//./\/}") owner hit
    if [[ "$term" == *.* ]]; then owner="${term%.*}"; variants+=(-e "${owner//./\/}.${term##*.}"); fi
    if hit="$(grep -E 'invoke(virtual|static|special|interface|dynamic)' <<<"$listing" | grep -F "${variants[@]}" | head -1)" && [[ -n "$hit" ]]; then
      printf 'CALLED     %s (bytecode: %s)\n' "$term" "$(sed 's/^ *//; s/  */ /g' <<<"$hit")"
    elif hit="$(grep -E '(ldc|getstatic|getfield|putfield|putstatic|new|checkcast|instanceof|anewarray)' <<<"$listing" | grep -F "${variants[@]}" | head -1)" && [[ -n "$hit" ]]; then
      printf 'REFERENCED %s (bytecode: %s)\n' "$term" "$(sed 's/^ *//; s/  */ /g' <<<"$hit")"
    elif grep -qF "${variants[@]}" <<<"$listing$pool"; then
      printf 'PRESENT    %s (declared or in a constant pool; no bytecode use found)\n' "$term"
    else
      printf 'NOT_FOUND  %s\n' "$term"
    fi
  done
}

mode="${1:-}"
[[ -n "$mode" ]] || usage
if [[ "$mode" == doctor ]]; then
  doctor
  exit 0
fi
[[ -n "${2:-}" ]] || usage
target="$(resolve_target "$2")" || { echo "error: no such file: $2" >&2; exit 1; }
[[ -f "$target" ]] || { echo "error: not a regular file: $target" >&2; exit 1; }
[[ -r "$target" ]] || { echo "error: not readable: $target" >&2; exit 1; }
size="$(stat -c %s -- "$target")"
sha="$(sha256sum -- "$target" | cut -d' ' -f1)"
classify
shift 2

case "$mode" in
  manifest) manifest ;;
  inventory)
    case "$kind" in
      native | dotnet) if [[ -n "$RIZIN" ]]; then inventory_native_rizin; else inventory_native_objdump; fi
        [[ "$kind" == dotnet ]] && { section "note"; echo "Managed .NET assembly: native imports show only the CLR loader; behavior lives in IL."; } ;;
      java) inventory_java ;;
      android | archive) inventory_zip ;;
      *) echo "error: unsupported format: $desc" >&2; exit 3 ;;
    esac ;;
  decompile)
    case "$kind" in
      native) if [[ -n "$RIZIN" ]]; then decompile_native_rizin "${1:-}"; else decompile_native_objdump; fi ;;
      dotnet) decompile_dotnet "${1:-}" ;;
      java) decompile_java "${1:-}" ;;
      android) decompile_android ;;
      *) echo "error: no decompiler for $format ($desc)" >&2; exit 3 ;;
    esac ;;
  verify)
    [[ $# -gt 0 ]] || usage
    case "$kind" in
      native) if [[ -n "$RIZIN" ]]; then verify_native_rizin "$@"; else verify_presence "$@"; fi ;;
      java) if [[ -n "$JAVAP" ]]; then verify_java "$@"; else verify_presence "$@"; fi ;;
      *) verify_presence "$@" ;;
    esac ;;
  *) usage ;;
esac
