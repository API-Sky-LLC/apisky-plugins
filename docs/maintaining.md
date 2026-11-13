# Maintaining the registry

Everything about changing this repository: adding a plugin, regenerating the signed index, the CI publish
gate and the rules a plugin has to pass before it is merged.

## One manifest per plugin

Store-only metadata rides in the manifest under `x-skyline` (visibility, trust, tags, counters, icon,
summary), so a plugin has exactly one manifest: agent clients read the standard keys and ignore the
extension block, the Legion skill store reads `x-skyline`.

```
.skycoder-plugin/marketplace.json   marketplace list (generated; agent clients)
index.json                          generated catalog (do not hand-edit)
index.json.sig                      detached ed25519 over index.json's exact bytes
plugins/<slug>/
  .skycoder-plugin/plugin.json      manifest (name == folder name, semver version)
  skills/<name>/SKILL.md            skill with YAML frontmatter (name, description)
  rules/<name>.mdc                  rules (frontmatter: description, alwaysApply, globs)
  commands/<name>.md                slash commands
  agents/<name>.md                  subagents
  .mcp.json                         MCP servers the plugin requires (never auto-started)
scripts/build-index.mjs             plugins/ → index.json + marketplace.json
scripts/sign-index.mjs              index.json → index.json.sig (+ --verify gate)
scripts/keygen.mjs                  ed25519 pair for a new signing key
```

## Add or change a plugin

```bash
# 1. new plugin folder with a manifest and at least one item
mkdir -p plugins/my-pack/.skycoder-plugin plugins/my-pack/skills/my-skill
$EDITOR plugins/my-pack/.skycoder-plugin/plugin.json
$EDITOR plugins/my-pack/skills/my-skill/SKILL.md

# 2. regenerate the catalog
npm run build

# 3. validate + sign (CI does this too, and fails when you forget)
npm run check
SKILL_STORE_SIGNING_KEY=… npm run sign -- --key-id apisky-2026
npm run verify
```

`npm run check` fails on: a stale `index.json`, a stale `marketplace.json`, an item whose bytes drifted from
the recorded `contentHash`, a missing or malformed manifest, a duplicate item name inside a plugin, a plugin
whose folder name differs from `plugin.json#name`, a non-semver version.

Version bumps are manual and semantic: change `version` in the manifest, run `npm run build`. The store
compares versions *and* bytes, so bumping the version without touching a file still marks the item
`unchanged`; changing a file without bumping the version marks it `pack_changed` and the store asks for
confirmation before overwriting anyone's local edits.

Give every item frontmatter: `description` on rules and commands, `name` + `description` on skills. The
index and the store cards are built from those fields, and an item without them shows up blank.

## Hashes are the product

Two different hashes, both recomputed on every build:

- `items[].contentHash` — the **framed tree hash** (`u32be pathLen + path + u64be size + bytes`, sorted by
  path, one sha256). This is the value the runtime profile stores, so a mismatch means Legion refuses the
  item (`hash_mismatch` → plan action `unreadable`) instead of installing it.
- `files[].sha256` — plain `sha256` over the raw file bytes (what `sha256sum` prints), plus `bytes`.

The index is signed and the signature covers those hashes; verifying the signature and then checking the
bytes is what makes "install" mean "install exactly what was reviewed".

## Signing

Per Legion's contract (`SKILL_STORE_PUBLIC_KEYS=<keyId>:<trust>:<base64 SPKI>`):

```bash
node scripts/keygen.mjs --id apisky-2026 --out ~/.keys     # once, offline
# private half → CI secret SKILL_STORE_SIGNING_KEY (base64 PKCS8); never commit
# public half  → Legion config, with the trust it should confer
```

- `index.json.sig` = `{ schemaVersion, algorithm: "ed25519", keyId, signature, signedAt }` over the
  **exact bytes** of `index.json`. Any reformat invalidates it — that is the point, not an inconvenience.
- `trust` clamps to the **minimum** of plugin, repository and signing key, so a `community` key can never
  promote a plugin to `official`.
- `npm run verify` is the deploy gate: it refuses to pass when the bytes moved after signing.
- Never edit `index.json` after signing. Run `npm run release`, which builds, signs and verifies in one step.

`index.json.sig` is made with the live `apisky-2026` key: the public half below is what Legion is
configured with, and the private half exists only as the CI secret `SKILL_STORE_SIGNING_KEY` and in the
offline key store — never in git. A Legion that does not know this key reports `key_unknown` and serves
nothing (fail-closed, by design).

## CI

CI lives at `.github/workflows/publish.yml` (`docs/ci/publish.yml` keeps the same content as the source of
truth for review); it runs on every push and PR to `main`:

1. `node scripts/build-index.mjs --check --check-hashes` — the index is not stale, hashes match the files;
2. `npm run sign` with `SKILL_STORE_SIGNING_KEY` and `SKILL_STORE_KEY_ID=apisky-2026` (skipped on PRs from
   forks, which have no secret);
3. `npm run verify` — the signature must match the bytes that will be published;
4. on `main`: commit the regenerated `index.json` + `index.json.sig` back with a bot commit, so
   `raw.githubusercontent.com/API-Sky-LLC/apisky-plugins/main/index.json` is always a signed, installable index.

The checkout uses `fetch-depth: 0` on purpose: `updatedAt` comes from the last commit date of
`plugins/<slug>`, so a shallow clone has no history for any pack and `--check` reports the index as stale.
Editing the workflow itself needs a token with the `workflow` scope — a plain `repo` token is rejected with
`refusing to allow a Personal Access Token to create or update workflow`.

Point Legion at it:

```bash
SKILL_STORE_REGISTRY_URL=https://raw.githubusercontent.com/API-Sky-LLC/apisky-plugins/main/index.json
SKILL_STORE_PUBLIC_KEYS=apisky-2026:official:MCowBQYDK2VwAyEAd6YQFAwPBaKq9xTqdtLRai5hlfCGaf0RqgFMPuYirKg=
SKILL_STORE_REQUIRE_SIGNATURE=true
```

For a private registry (GitLab, S3) keep the same three files at whatever URL the index lives at:
`<index>.sig` is looked up as a sibling, and a query-string token on the index URL is preserved for the
signature request.

## Rotating the signing key

Legion resolves the signing key by the `keyId` inside `index.json.sig`, so two keys can be trusted at once
and a rotation never has a window where the store serves nothing.

```bash
npm run keygen -- --id apisky-2027 --out ~/.keys     # new ed25519 pair, offline
```

1. Store the private half as the repo secret `SKILL_STORE_SIGNING_KEY` (and keep an offline copy).
2. Append the public half to `SKILL_STORE_PUBLIC_KEYS` in Legion **before** the first index signed with it
   is pushed — list both keys, comma-separated, each with its trust level:
   `apisky-2027:official:…,apisky-2026:official:…`. A key Legion does not know is `key_unknown`, which
   fails closed.
3. Set `SKILL_STORE_KEY_ID` in `.github/workflows/publish.yml` to the new id and merge; CI signs the next
   index with it.
4. Keep the old public key listed until no index signed with it is in use (the store, a mirror or a pinned
   checkout may still be serving the old bytes), then drop it from `SKILL_STORE_PUBLIC_KEYS`.

## Icons

Every plugin carries one badge in the store card, and the index carries it as an inline
`data:image/svg+xml;base64,…` URL (`packs[].icon`) — one self-contained, signed file, no second request
from the client.

House style: a 64×64 rounded tile (r=14) in the plugin's brand colour with a single white mark — one
silhouette, no gradients, no text, no external refs.

- **Ship your own**: drop `icon.svg` next to the manifest and set `x-skyline.icon` to it. The build inlines
  the bytes.
- **No icon**: the build derives a letter badge from `displayName` on a stable colour, so a plugin never
  renders as an empty box. `x-skyline.color` (`#rrggbb`) pins the colour.

Third-party marks are used as logos, not as brand claims: `qa-playwright` ships the Playwright mark,
`kicad` the KiCad mark.

## Language

Everything in this repository is **English**: manifests, summaries, skill bodies, rules and commands. The
store is an English product surface and the plugins are read by users of the web, mobile and extension
clients; a plugin summary is not the place for a translation. `node scripts/build-index.mjs --check` covers
the generated files, so a stray non-ASCII description is caught before it is published.

## Rules of review

A plugin ships hooks and commands that an agent **executes**. Before merging:

- no binaries, no `curl | sh`, no absolute paths;
- hooks name an interpreter and a script inside the plugin;
- `.mcp.json` declares a server requirement, never credentials (`${secret:KEY}` only);
- license is present and compatible with publication (`private` plugins must not be published to a public
  index);
- every item has a `description` — an unlabelled item is unusable in the store.
