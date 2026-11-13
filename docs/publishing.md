# Publishing a plugin

How a plugin (a "pack") gets into this registry: the two routes in, who signs
what, and what a deploy breaks if the order is wrong.

This is the guide, not a second copy of `maintaining.md`: the folder layout, the
hash scheme, the CI gate and the rules a plugin has to pass are documented there
and linked to from here instead of repeated.

## Who signs what

- There is **one signature per published index**: `index.json.sig`, a detached
  ed25519 signature over the **exact bytes** of `index.json`
  (`{ schemaVersion: 1, algorithm: "ed25519", keyId, signature, signedAt }`).
- It is produced by the registry's signing key `apisky-2026`, whose public half is
  `MCowBQYDK2VwAyEAd6YQFAwPBaKq9xTqdtLRai5hlfCGaf0RqgFMPuYirKg=` - that is the
  value Legion is configured with in `SKILL_STORE_PUBLIC_KEYS`. CI owns that
  signature; while the workflow file is missing (see the honest status in Route A)
  a maintainer runs the same script by hand with the offline key.
- The private half exists only as the repository secret
  `SKILL_STORE_SIGNING_KEY` (base64 PKCS8) and in the offline key store. It is
  never in git (`.gitignore` covers `*.key`), and it is never handled by a
  plugin author.

| Who | Key needed |
|---|---|
| Contributor opening a pull request | **None.** You cannot and must not sign. |
| Reviewer / maintainer merging | None - CI holds the secret. |
| Maintainer signing by hand, or running the publish CI outside GitHub Actions | `~/.keys/apisky-2026.key` (or the same material in `SKILL_STORE_SIGNING_KEY`). |
| A publisher running their own registry | Their own pair - see "Adding an independent publisher". |

Which command needs the key, exactly:

| Command | Key | What it does |
|---|---|---|
| `npm run build` | no | `plugins/` -> `index.json` + `.skycoder-plugin/marketplace.json` |
| `npm run check` | no | fails when `index.json`/`marketplace.json` are stale or an item's bytes drifted from `contentHash` |
| `npm run publish` | **yes** | build -> check -> sign -> verify -> commit the three generated files (never pushes); the one command a maintainer runs |
| `npm run publish -- --check` | no | build -> check; verifies the signature when a key happens to be present, `not signed: no key available` when it is not |
| `npm run sign` | **yes** | `index.json` -> `index.json.sig` |
| `npm run verify` | **yes** | the deploy gate: the signature must cover the bytes that will be published |
| `npm run release` | **yes** | build + sign + verify in one step (maintainers only) |

`npm run verify` needs the *private* key, because the script derives the public
half from it (`createPublicKey(privateKey)`). Without key material both `sign`
and `verify` stop with
`no signing key: pass --key-file or set SKILL_STORE_SIGNING_KEY (base64 PKCS8 ed25519)`
and exit code 2. That is the whole reason a contributor can only run a *check*: the
verification gate is not theirs to run, and `npm run publish` without a key stops
the same way.

## The one command: `npm run publish`

`npm run publish` is what a maintainer runs after merging a pull request (or
before pushing). One command, in this order, stopping at the first failure:

1. `scripts/build-index.mjs` - regenerate `index.json` +
   `.skycoder-plugin/marketplace.json` from `plugins/`;
2. `scripts/build-index.mjs --check --check-hashes` - refuse a stale index or an
   item whose bytes drifted from the recorded `contentHash`;
3. `scripts/sign-index.mjs` - sign the exact bytes -> `index.json.sig`;
4. `scripts/sign-index.mjs --verify` - the deploy gate, on the bytes about to be
   committed;
5. commit `index.json`, `index.json.sig` and `.skycoder-plugin/marketplace.json` -
   those three paths and nothing else - with `registry: rebuild and sign the index`.

It **never pushes**: it prints the commit sha and the `git push` line and stops.
`--no-commit` runs steps 1-4 and leaves the changes in the working tree for you to
commit by hand; `--message <text>` overrides the commit message; `--key-file <path>`
and `--key-id <id>` choose the key (defaults: `SKILL_STORE_SIGNING_KEY`, else
`~/.keys/<key-id>.key`; `apisky-2026`). The private key is only ever passed onward
as a path or an env var - the script never reads, prints or writes key material.

If the working tree holds staged or unstaged changes **outside** those three paths,
`npm run publish` refuses before it writes anything and names the blocking paths: a
signing pass must not sweep someone's half-finished work into a registry commit.
(`--no-commit` only warns; `--check` does not care, since it writes nothing.)

## Route A - a pull request (the normal path)

1. Fork the repository, or branch off `main`.
2. Add `plugins/<slug>/` with `.skycoder-plugin/plugin.json` (folder name ==
   `plugin.json#name`, semver `version`) and **at least one item**. The folder
   layout and the frontmatter every item needs (`description`, and `name` +
   `description` on skills) are in `maintaining.md` -> "One manifest per plugin".
   `plugins/engineering-basics/` is the smallest real example: one manifest, one
   skill, one rule, one command and one icon.
3. Commit the pack first. This is not cosmetic: the build derives each pack's
   `updatedAt` from `git log -1 --format=%cI -- plugins/<slug>`, and a folder
   that has no commit yet falls back to file mtimes. An index generated *before*
   the pack's own commit therefore goes stale the moment CI looks at the commit
   date, and `npm run check` fails.
4. `npm run build` - regenerates `index.json` and
   `.skycoder-plugin/marketplace.json`, then commit those two files in a second
   commit.
5. `npm run publish -- --check` - the only gate you can run, and it needs no key.
   It builds in memory and then validates what you would publish: `index.json` is
   not stale, `marketplace.json` is not stale, no item's bytes drifted from the
   recorded `contentHash`. With no key available it prints
   `not signed: no key available` and still exits 0 on a clean index; when a key
   happens to be present (`SKILL_STORE_SIGNING_KEY`, or `~/.keys/apisky-2026.key`)
   it also verifies the signature. What it cannot do is *prove* the signature: on
   a fork there is no key, and `npm run verify` would derive the public half from
   the private one you do not have. It fails on a stale `index.json`, a stale
   `marketplace.json`, an item whose bytes drifted from the recorded
   `contentHash`, a missing or malformed manifest, a duplicate item name inside a
   plugin, a folder name that differs from `plugin.json#name` or a non-semver
   version. Do not run `npm run sign` or `npm run publish` without `--check`: they
   need the private key and will refuse.
6. What the pull request contains, precisely:
   - **It must contain** the new `plugins/<slug>/` tree *and* the regenerated
     `index.json` + `.skycoder-plugin/marketplace.json`. The contributor commits
     the generated index themselves: CI's first step is
     `node scripts/build-index.mjs --check --check-hashes`, which fails a stale
     index instead of regenerating it for you, so an index missing from the PR is
     a red build, not a bot commit.
   - **It must not contain** a hand-edited `index.json` - the signature is over
     the exact bytes, and editing, reformatting or re-serializing the index after
     signing invalidates it. Every index change goes through `npm run build`.
   - **It must not contain** a hand-written or hand-edited `index.json.sig`, and
     no `.key` / `.pem` file ever. Leave `index.json.sig` untouched: a contributor
     has no key, a pull request from a fork gets no secret (that run only
     validates), and CI replaces the signature after merge.
7. Open the pull request into `main`. Review covers the rules in
   `maintaining.md` -> "Rules of review": a pack ships hooks and commands that an
   agent **executes**, so no binaries, no `curl | sh`, no absolute paths, MCP
   servers declared as requirements without credentials, a compatible licence,
   and a `description` on every item.
8. After merge, CI (`docs/ci/publish.yml`, the workflow source of truth) runs the
   same `--check`, signs with `SKILL_STORE_KEY_ID=apisky-2026` from the secret
   `SKILL_STORE_SIGNING_KEY`, verifies, and on `main` commits the regenerated
   `index.json` + `index.json.sig` + `marketplace.json` back with a bot commit -
   so the raw URL always serves a signed, installable index. The checkout uses
   `fetch-depth: 0` because a shallow clone has no commit history for any pack and
   would report every pack as stale.
   *Honest status:* the workflow file is not in the repository yet (there is no
   `.github/workflows/`), so until it is added the post-merge steps do not run and
   a merge must be signed by hand - which is exactly how the store ended up
   serving a signature that no longer covered `index.json`. The manual equivalent
   is `npm run publish` (see "The one command" above): build, check, sign, verify,
   commit, and never push.
9. **The merge window.** Between the merge commit and CI's bot commit the tree can
   hold a new `index.json` next to the previous `index.json.sig`. Legion is
   fail-closed, so any client asking in that window is refused with
   `signature_invalid`. Shipping the freshly built index in the pull request
   (step 4) is what keeps the window to the length of one CI run; with the
   workflow still absent the window lasts until a maintainer runs `npm run publish`
   and pushes the commit it prints.

## Route B - no git access at all (authorized product users)

A signed-in human user can publish a pack straight through the product, without
git, a fork or a key of any kind:

- `POST /api/skill-store/submissions` on Legion, with the Bearer session of a
  signed-in human user. The route is guarded by `MiddlewareAuthGuard` plus a
  human-only check: an executor token is refused with
  `400 executor_token_not_allowed`.
- Body: `{ "pack": { slug, name, summary?, description?, version, license?,
  author?, tags?, requires?, items: [{ name, kind, description?, requiresMcp?,
  path? }] }, "files": [{ "path": "<pack-relative path>", "data": "<base64>" }] }`
  - the manifest plus every byte it declares, uploaded in one request. Hashes are
  computed server-side, so the submitter cannot lie about them.
- The submitter can follow the queue with `GET /api/skill-store/submissions`
  (mine, newest first), `GET /api/skill-store/submissions/:id` and
  `POST /api/skill-store/submissions/:id/withdraw` while it is still `pending`.
- Review is a platform-admin action in apisky-fe: **Admin -> Skill Store**
  (`/admin/skill-store`), backed by the Legion queue
  `GET /v1/admin/skill-submissions` (`?status=pending|approved|rejected|withdrawn`,
  `?q=`), `GET /v1/admin/skill-submissions/:id` and
  `POST /v1/admin/skill-submissions/:id/approve|reject`. A rejection requires a
  reason or a note, which the submitter sees and can resubmit against.
- Approval publishes the pack as `community/<userId>/<slug>` with pack trust
  `verified`. `official` is reserved for the signed registry index and is never
  granted here; the pack appears in the catalog under the `community` source
  ("Community submissions") next to the `official` registry source, and the two
  coexist - a community pack id can never shadow an official one, because the
  namespaces differ.
- Trust clamps to the **minimum** of pack, repository and signing key, so a key
  with `community` trust can never promote a pack to `official`, and an approved
  submission can never be promoted either - it is reviewed by a human, but it is
  not covered by the signature.
- *Honest status:* the submitter-side form is not shipped in the client yet (the
  web client's skill-store service has no submission call). The endpoint above is
  the interface today; the admin review screen in apisky-fe is in place.

## The ordering rule that breaks a deploy

Legion's `SKILL_STORE_PUBLIC_KEYS` is a comma-separated list of
`<keyId>:<official|verified|community>:<base64 SPKI DER>`. The public half of a
key must be listed **before** the first index signed with that key is published:
verification is fail-closed, and an index whose `keyId` is not configured answers
`key_unknown` and the store serves nothing.

Two keys may be listed at once, because the signature names its own `keyId` and
Legion picks the configured key that matches. A rotation is therefore an append,
never a swap - the mechanics are in `maintaining.md` -> "Rotating the signing
key".

## Verifying a published index

`scripts/sign-index.mjs --verify` reads `index.json` and `index.json.sig` from
the repository root, so to check the *published* bytes a maintainer fetches that
pair over a checkout first (`curl -O <raw url>/index.json -O <raw url>/index.json.sig`
next to the files they replace) and then runs one of the two forms:

```bash
# the private half is in the environment (npm run verify already passes
# --key-id apisky-2026; --key-file wins over the env var)
SKILL_STORE_SIGNING_KEY=<base64 PKCS8> npm run verify

# or read the private half from the offline key store
node scripts/sign-index.mjs --key-id apisky-2026 \
  --key-file ~/.keys/apisky-2026.key --verify
```

It prints `index.json.sig verifies with apisky-2026 (N bytes signed)` and exits 0
when the published bytes are the signed ones. A non-zero exit means one of: the
signature file is missing or not valid JSON, the header is not
`schemaVersion 1` + `ed25519`, the signature names a different `keyId`, or the
signature does not match the bytes (`the index changed after signing`).

What Legion reports when it accepts the same index - the catalog's `signature`
block:

```jsonc
"signature": { "enforced": true, "signed": true, "verified": true,
               "algorithm": "ed25519", "keyId": "apisky-2026",
               "trust": "official", "signedAt": "..." }
```

When it refuses, the client sees `503 skill_store_unavailable:<reason>`, where
`<reason>` is one of:

| Reason | Meaning |
|---|---|
| `signature_missing` | no `index.json.sig` was readable next to the index |
| `signature_malformed` | the signature file is not valid JSON, or its header/keyId/signature does not fit the schema |
| `key_unknown` | the signature names a `keyId` that is not in `SKILL_STORE_PUBLIC_KEYS` - deploy the public half first |
| `signature_invalid` | the key is known, but the signature does not cover these bytes |

## Adding an independent publisher

For a partner who runs their own registry and signs it with their own key:

1. Generate the pair - offline, on a machine that keeps the private half:

   ```bash
   node scripts/keygen.mjs --id <partner-key-id> --out ~/.keys
   # -> ~/.keys/<partner-key-id>.key  (0600, base64 PKCS8 - the private half)
   #    ~/.keys/<partner-key-id>.pub  (0644, base64 SPKI  - the public half)
   ```

   The script prints a `SKILL_STORE_PUBLIC_KEYS=...:official:...` line as a hint;
   that trust is **not** a default you should copy.
2. Hand the private half over out of band (a password manager, not a chat, never
   a commit - `.gitignore` covers `*.key` but that is no substitute for not
   putting it there).
3. List the public half in Legion's `SKILL_STORE_PUBLIC_KEYS` with the trust that
   publisher should confer: `community` for anyone outside the organization,
   `verified` only for a party whose review process you can vouch for. **Never
   use `official` for a key you do not control** - `official` is the trust of
   APISky's own signed index, and a pack can only ever be clamped down from its
   key's trust, never promoted above it.
4. The publisher then signs their own index with their own `keyId`; their packs
   land in the catalog as a separate source with that key's trust, next to the
   `official` registry source. Their own release process is theirs - they need
   `scripts/build-index.mjs` and `scripts/sign-index.mjs` from this repository or
   any tool that produces byte-identical `index.json` + `index.json.sig` pairs.
