#!/usr/bin/env node
/**
 * publish.mjs - build, check, sign and verify the registry in one command.
 *
 * The failure this closes is one this repository already lived through: an
 * `index.json` regenerated without re-signing it. `index.json.sig` covers the
 * exact bytes of `index.json`, so the two files are one artifact, and every
 * process that rebuilds the index and forgets the signature publishes an index
 * Legion refuses with `signature_invalid`. This script is that process, in order:
 *
 *   1. scripts/build-index.mjs                          plugins/ -> index.json
 *   2. scripts/build-index.mjs --check --check-hashes    stale index or drifted bytes: stop
 *   3. scripts/sign-index.mjs                           index.json -> index.json.sig
 *   4. scripts/sign-index.mjs --verify                  the deploy gate
 *   5. git add + git commit                             the three generated files only
 *
 * It NEVER pushes - it prints the commit and the `git push` line and stops. It
 * never touches a path outside the three files it commits, and it refuses to run
 * at all while the working tree holds changes outside them: a signing pass must
 * not sweep someone's half-finished work into a registry commit.
 *
 * `--no-commit` builds, signs and verifies but leaves the changes in the tree
 * (that mode only warns about outside changes). `--check` writes nothing and is
 * the mode a contributor with no signing key can run: a missing key is not a
 * failure there, it prints `not signed: no key available` and still validates
 * the one thing a contributor can check locally - a fresh index and matching
 * hashes.
 *
 * The private key is never read, printed or written here: only a path (or the
 * name of the environment variable) is handed to sign-index.mjs.
 *
 *   npm run publish                  build, check, sign, verify, commit
 *   npm run publish -- --check       validate only (no key needed)
 *   npm run publish -- --no-commit   build and sign, leave the tree dirty
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BUILD_SCRIPT = join(ROOT, 'scripts', 'build-index.mjs');
const SIGN_SCRIPT = join(ROOT, 'scripts', 'sign-index.mjs');

/** The only paths a publish commit may touch. Nothing else is ever `git add`ed. */
const REGISTRY_PATHS = ['index.json', 'index.json.sig', '.skycoder-plugin/marketplace.json'];

const DEFAULT_KEY_ID = 'apisky-2026';
const DEFAULT_MESSAGE = 'registry: rebuild and sign the index';

const HELP = `usage: npm run publish [-- <options>]

Build the registry index, validate it, sign it, verify the signature and commit
the three generated files (index.json, index.json.sig,
.skycoder-plugin/marketplace.json). It never pushes.

options:
  --check            validate only, write nothing: the index is not stale, the
                     hashes match, and the signature verifies when a key is
                     available. A missing key is NOT a failure here - it prints
                     "not signed: no key available" and still exits 0 when the
                     index and the hashes are clean.
  --key-id <id>      signing key id (default: ${DEFAULT_KEY_ID})
  --key-file <path>  private half; default: $SKILL_STORE_SIGNING_KEY, else
                     ~/.keys/<key-id>.key when that file exists
  --no-commit        build, sign and verify, then leave the changes in the tree;
                     changes outside the three registry files only warn here
  --message <text>   commit message (default: "${DEFAULT_MESSAGE}")
  --help             this text

The private key is only ever passed onward as a file path or an env var - never
printed, never copied, never committed.

exit codes: 0 ok (including "registry unchanged"), 1 a step failed or the working
tree holds changes outside the three registry files (only --no-commit warns
instead of refusing), 2 bad usage.

examples:
  npm run publish                       # maintainer, after a merge
  npm run publish -- --check            # contributor: is my pull request publishable?
  npm run publish -- --no-commit        # build and sign, commit by hand
  node scripts/publish.mjs --key-file ~/.keys/apisky-2026.key
`;

function arg(argv, name, fallback) {
  const at = argv.indexOf(`--${name}`);
  return at === -1 ? fallback : argv[at + 1];
}

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

/** Run one of the sibling scripts as a child, output inherited so its own lines show. */
function runNode(script, args) {
  const res = spawnSync(process.execPath, [script, ...args], { cwd: ROOT, stdio: 'inherit' });
  if (res.error) fail(`${script} could not run: ${res.error.message}`);
  if (res.status !== 0) fail(`${script.split('/').pop()} ${args.join(' ')} failed (exit ${res.status})`);
}

function git(args, { check = true } = {}) {
  const res = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (res.error) fail(`git ${args.join(' ')} could not run: ${res.error.message}`);
  if (check && res.status !== 0) fail(`git ${args.join(' ')} failed: ${(res.stderr || '').trim()}`);
  return res.stdout ?? '';
}

/** git quotes a path that carries odd bytes; take it literally, without the quotes. */
function unquote(path) {
  const trimmed = path.trim();
  if (!trimmed.startsWith('"') || !trimmed.endsWith('"')) return trimmed;
  return trimmed.slice(1, -1).replace(/\\(.)/g, (_, c) => ({ n: '\n', t: '\t', r: '\r', '"': '"', '\\': '\\' })[c] ?? c);
}

/** `git status --porcelain` as records. A rename names both paths: either one counts. */
function statusEntries() {
  const entries = [];
  for (const line of git(['status', '--porcelain']).split('\n')) {
    if (!line.trim()) continue;
    const status = line.slice(0, 2);
    const rest = line.slice(3);
    for (const path of rest.includes(' -> ') ? rest.split(' -> ') : [rest]) {
      entries.push({ status, path: unquote(path) });
    }
  }
  return entries;
}

function partition(entries) {
  const registry = [];
  const other = [];
  for (const entry of entries) (REGISTRY_PATHS.includes(entry.path) ? registry : other).push(entry);
  return { registry, other };
}

function displayPath(path) {
  const home = homedir();
  return path.startsWith(home) ? `~${path.slice(home.length)}` : path;
}

/**
 * Where the private half comes from - resolved, never read: sign-index.mjs does
 * the reading, so no key material ever passes through this process.
 */
function resolveKey(keyId, keyFile) {
  if (keyFile) {
    const path = resolve(keyFile.replace(/^~(?=$|\/)/, homedir()));
    return existsSync(path) ? { kind: 'file', path } : null;
  }
  if ((process.env.SKILL_STORE_SIGNING_KEY ?? '').trim()) return { kind: 'env' };
  const conventional = join(homedir(), '.keys', `${keyId}.key`);
  return existsSync(conventional) ? { kind: 'file', path: conventional } : null;
}

const keyArgs = (key) => (key.kind === 'file' ? ['--key-file', key.path] : []);
const keyLabel = (key) => (key.kind === 'file' ? displayPath(key.path) : 'SKILL_STORE_SIGNING_KEY');

function main(argv) {
  if (argv.includes('--help')) {
    console.log(HELP.trimEnd());
    return;
  }

  const checkOnly = argv.includes('--check');
  const noCommit = argv.includes('--no-commit');
  const keyId = arg(argv, 'key-id', DEFAULT_KEY_ID);
  const keyFile = arg(argv, 'key-file');
  const message = arg(argv, 'message') ?? DEFAULT_MESSAGE;
  const key = resolveKey(keyId, keyFile);

  // A publish run ends in a commit of the three registry files: anything else in
  // the tree would ride along, so this is refused before a single file is
  // rewritten. `--check` writes nothing at all, so it does not care what else is
  // in the tree - a contributor's pull request is nothing but such files.
  if (!checkOnly) {
    const unrelated = partition(statusEntries()).other;
    if (unrelated.length > 0) {
      const lines = unrelated.map((entry) => `    ${entry.status} ${entry.path}`);
      if (noCommit) {
        console.warn('  ! changes outside the registry files are present (a publish commit would not carry them):');
        for (const line of lines) console.warn(line);
      } else {
        console.error('✗ refusing to publish: changes outside the registry files are staged or unstaged:');
        for (const line of lines) console.error(line);
        console.error('  commit, stash or revert them first, or run with --no-commit');
        process.exit(1);
      }
    }
  }

  if (checkOnly) {
    console.log(`check: is the index fresh, do the hashes match${key ? ` and does the signature verify with ${keyId}` : ''}?`);
    runNode(BUILD_SCRIPT, ['--check', '--check-hashes']);
    if (!key) {
      console.log('not signed: no key available');
      console.log('✓ registry check passed: the index is not stale and every hash matches');
      return;
    }
    runNode(SIGN_SCRIPT, ['--key-id', keyId, ...keyArgs(key), '--verify']);
    console.log(`✓ registry check passed: index fresh, hashes match, signature verifies (${keyId} from ${keyLabel(key)})`);
    return;
  }

  if (!key) {
    if (keyFile) console.error(`✗ no signing key: --key-file ${keyFile} does not exist`);
    else {
      console.error('✗ no signing key: pass --key-file <path>, set SKILL_STORE_SIGNING_KEY,');
      console.error(`  or place the key at ~/.keys/${keyId}.key`);
    }
    console.error('  (npm run publish -- --check validates the index without a key)');
    process.exit(1);
  }

  console.log(`publish: build -> check -> sign -> verify -> commit (keyId ${keyId}, key from ${keyLabel(key)})`);

  runNode(BUILD_SCRIPT, []);
  runNode(BUILD_SCRIPT, ['--check', '--check-hashes']);
  runNode(SIGN_SCRIPT, ['--key-id', keyId, ...keyArgs(key)]);
  runNode(SIGN_SCRIPT, ['--key-id', keyId, ...keyArgs(key), '--verify']);

  const changed = partition(statusEntries()).registry;
  if (changed.length === 0) {
    console.log('registry unchanged');
    return;
  }

  console.log('registry changed:');
  for (const entry of changed) console.log(`    ${entry.status} ${entry.path}`);

  if (noCommit) {
    console.log('--no-commit: the changes are in the working tree, not committed and not pushed');
    return;
  }

  // Re-read the tree: the commit must not carry anything the first check missed.
  const late = partition(statusEntries()).other;
  if (late.length > 0) {
    console.error('✗ refusing to commit: changes outside the registry files appeared during the run:');
    for (const entry of late) console.error(`    ${entry.status} ${entry.path}`);
    process.exit(1);
  }

  git(['add', '--', ...REGISTRY_PATHS]);
  git(['commit', '-m', message]);
  const sha = git(['rev-parse', '--short', 'HEAD']).trim();
  console.log(`✓ committed ${sha}: ${message}`);
  console.log('  push it: git push   (scripts/publish.mjs never pushes)');
}

main(process.argv.slice(2));
