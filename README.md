# apisky-plugins

Agent plugins for **Skyline**, Cursor and Claude Code — one repository, two consumers:

| Consumer | What it reads | Where |
|---|---|---|
| Cursor / Skyline / Claude Code | `.cursor-plugin/marketplace.json` + each `plugins/<slug>/.cursor-plugin/plugin.json` | repo root |
| Legion skill store (web + mobile) | `index.json` + `index.json.sig` | repo root |

A plugin is a **folder with skills, rules, commands and an optional MCP requirement**.
Cursor reads the standard manifest keys; the store-only metadata (visibility, trust,
tags, counters) rides in the same file under `x-skyline`, so there is exactly one
manifest per plugin.

## Layout

```
.cursor-plugin/marketplace.json     marketplace list (Cursor-compatible)
index.json                          generated catalog (do not hand-edit)
index.json.sig                      detached ed25519 over index.json's exact bytes
plugins/<slug>/
  .cursor-plugin/plugin.json        manifest (name == folder name, semver version)
  skills/<name>/SKILL.md            skill with YAML frontmatter (name, description)
  rules/<name>.mdc                  rules (frontmatter: description, alwaysApply, globs)
  commands/<name>.md                slash commands
  agents/<name>.md                  subagents
  .mcp.json                         MCP servers the plugin requires (never auto-started)
scripts/build-index.mjs             plugins/ → index.json + marketplace.json
scripts/sign-index.mjs              index.json → index.json.sig (+ --verify gate)
scripts/keygen.mjs                  ed25519 pair for a new signing key
```

## What is in here now

| Pack | Version | License | Trust | Items |
|---|---|---|---|---|
| `engineering-basics` | 1.0.0 | MIT | verified | skill `repo-analysis`, rule `commit-style`, command `review` |
| `qa-playwright` | 1.0.0 | Apache-2.0 | verified | skill `e2e-scenarios`, MCP requirement `playwright` |
| `kicad` | 1.0.0 | MIT | verified | skills `board-review`, `routing`, `dfm`, `footprint-audit`, rule `clearance`, command `fab-package`, MCP requirement `kicad` |
| `us-court-filings` | 1.0.0 | MIT | verified | skills `filing-structure`, `local-rules`, `authorities-table`, rule `no-invented-citations`, command `filing-check`, subagent `filing-reviewer` |

extension (`skyline/data/skills/`), they use Skyline-only tool tags, and a private
pack is filtered from the public catalog and 404s by id. It is here so the
catalog has an honest inventory — not to be installed from the store.

## Language

Everything in this repository is **English**: manifests, summaries, skill bodies, rules and
commands. The store is an English product surface and the packs are read by users of the web,
mobile and extension clients; a pack summary is not the place for a translation.
`node scripts/build-index.mjs --check` covers the generated files, so a stray non-ASCII
description is caught before it is published.

## Add or change a plugin

```bash
# 1. new plugin folder with a manifest and at least one item
mkdir -p plugins/my-pack/.cursor-plugin plugins/my-pack/skills/my-skill
$EDITOR plugins/my-pack/.cursor-plugin/plugin.json
$EDITOR plugins/my-pack/skills/my-skill/SKILL.md

# 2. regenerate the catalog
npm run build

# 3. validate + sign (CI does this too, and fails when you forget)
npm run check
SKILL_STORE_SIGNING_KEY=… npm run sign -- --key-id apisky-2026
npm run verify
```

`npm run check` fails on: a stale `index.json`, a stale `marketplace.json`, an item
whose bytes drifted from the recorded `contentHash`, a missing or malformed
manifest, a duplicate item name inside a pack, a pack whose folder name differs
from `plugin.json#name`, a non-semver version.

Version bumps are manual and semantic: change `version` in the manifest, run
`npm run build`. The store compares versions *and* bytes, so bumping the version
without touching a file still marks the item `unchanged`; changing a file without
bumping the version marks it `pack_changed` and the store asks for confirmation
before overwriting anyone's local edits.

## Pack icons

Every pack carries one badge in the store card, and the index carries it as an
inline `data:image/svg+xml;base64,…` URL (`packs[].icon`) — one self-contained,
signed file, no second request from the client.

- **Ship your own**: drop `icon.svg` (64×64, no external references) next to the
  manifest and set `x-skyline.icon` to it. The build inlines the bytes.
- **No icon**: the build derives a letter badge from `displayName` on a stable
  colour, so a pack never renders as an empty box. `x-skyline.color` (`#rrggbb`)
  pins the colour.

Icons are part of the index, so they are covered by the signature: never edit
`index.json` after signing — run `npm run release`, which builds, signs and
verifies in one step.

## Hashes are the product
Two different hashes, both recomputed on every build:

- `items[].contentHash` — the **framed tree hash** (`u32be pathLen + path +
  u64be size + bytes`, sorted by path, one sha256). This is the value the runtime
  profile stores in `contentHash`, so a mismatch means Legion will refuse the item
  (`hash_mismatch` → plan action `unreadable`) instead of installing it.
- `files[].sha256` — plain `sha256` over the raw file bytes (what `sha256sum`
  prints), plus `bytes`.

The index is signed, and the signature covers those hashes; verifying the
signature and then checking the bytes is what makes "install" mean "install
exactly what was reviewed".

## Signing

Per Legion's contract (`SKILL_STORE_PUBLIC_KEYS=<keyId>:<trust>:<base64 SPKI>`):

```bash
node scripts/keygen.mjs --id apisky-2026 --out ~/.keys     # once, offline
# private half → CI secret SKILL_STORE_SIGNING_KEY (base64 PKCS8); never commit
# public half  → Legion config, with the trust it should confer
```

- `index.json.sig` = `{ schemaVersion, algorithm: "ed25519", keyId, signature, signedAt }`
  over the **exact bytes** of `index.json`. Any reformat invalidates it — that is
  the point, not an inconvenience.
- `trust` clamps to the **minimum** of pack, repository and signing key, so a
  `community` key can never promote a pack to `official`.
- `npm run verify` is the deploy gate: it refuses to pass when the bytes moved
  after signing.

## CI

`.github/workflows/publish.yml` runs on every push and PR to `main`:

1. `npm run check` — the index is not stale, hashes match the files;
2. `npm run sign` with `SKILL_STORE_SIGNING_KEY` (skipped on PRs from forks, which
   have no secret);
3. `npm run verify` — the signature must match the bytes that will be published;
4. on `main`: commit the regenerated `index.json` + `index.json.sig` back with a
   bot commit, so `raw.githubusercontent.com/API-Sky-LLC/apisky-plugins/main/index.json`
   is always a signed, installable index.

Point Legion at it:

```bash
SKILL_STORE_REGISTRY_URL=https://raw.githubusercontent.com/API-Sky-LLC/apisky-plugins/main/index.json
SKILL_STORE_PUBLIC_KEYS=apisky-2026:official:<base64 SPKI>
SKILL_STORE_REQUIRE_SIGNATURE=true
```

> The `index.json.sig` committed right now was made with a throwaway `apisky-dev`
> key so the repo could be validated end to end against a local Legion. The first
> CI run on `main` replaces it with the real `apisky-2026` signature — until then
> a Legion configured with the official key will report `key_unknown` and serve
> nothing (fail-closed, by design).

For a private registry (GitLab, S3) keep the same three files at whatever URL the
index lives at: `<index>.sig` is looked up as a sibling, and a query-string token
on the index URL is preserved for the signature request.

## Rules of review

A pack ships hooks and commands that an agent **executes**. Before merging:

- no binaries, no `curl | sh`, no absolute paths;
- hooks name an interpreter and a script inside the pack;
- `.mcp.json` declares a server requirement, never credentials (`${secret:KEY}` only);
- license is present and compatible with publication (`private` packs must not be
  published to a public index).
