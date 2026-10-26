#!/usr/bin/env node
/**
 * sign-index.mjs — detached ed25519 signature over the exact bytes of index.json.
 *
 * `index.json.sig` sits next to the index and names a keyId; Legion resolves that
 * id against `SKILL_STORE_PUBLIC_KEYS` and verifies the signature *before* it
 * parses the JSON. Consequences worth knowing:
 *
 *  - the bytes are the contract: never reformat `index.json` after signing;
 *  - `--verify` is the deploy gate — CI runs it and publishes only when it passes;
 *  - nothing here is canonicalized, re-serialized or normalized.
 *
 *   node scripts/sign-index.mjs --key-id apisky-2026 --key-file ~/.keys/apisky-2026.key
 *   node scripts/sign-index.mjs --key-id apisky-2026 --key-file … --verify
 */
import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const INDEX = join(ROOT, 'index.json');
const SIG = `${INDEX}.sig`;
const SCHEMA_VERSION = 1;
const ALGORITHM = 'ed25519';

function arg(name, fallback) {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? fallback : process.argv[at + 1];
}

function loadPrivate(material) {
  const trimmed = (material ?? '').trim();
  if (!trimmed) return null;
  try {
    return trimmed.includes('-----')
      ? createPrivateKey(trimmed)
      : createPrivateKey({ key: Buffer.from(trimmed, 'base64'), format: 'der', type: 'pkcs8' });
  } catch {
    return null;
  }
}

const keyId = arg('key-id');
if (!keyId) {
  console.error('usage: node scripts/sign-index.mjs --key-id <keyId> [--key-file <path>] [--verify]');
  process.exit(2);
}

const keyFile = arg('key-file');
const material = keyFile ? readFileSync(resolve(keyFile.replace(/^~(?=$|\/)/, process.env.HOME ?? '')), 'utf8') : (process.env.SKILL_STORE_SIGNING_KEY ?? '');
const privateKey = loadPrivate(material);
if (!privateKey) {
  console.error('no signing key: pass --key-file or set SKILL_STORE_SIGNING_KEY (base64 PKCS8 ed25519)');
  process.exit(2);
}

const bytes = readFileSync(INDEX);

if (process.argv.includes('--verify')) {
  if (!existsSync(SIG)) {
    console.error(`✗ ${SIG} does not exist`);
    process.exit(1);
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(SIG, 'utf8'));
  } catch {
    console.error('✗ index.json.sig is not valid JSON');
    process.exit(1);
  }
  if (parsed.algorithm !== ALGORITHM || parsed.schemaVersion !== SCHEMA_VERSION) {
    console.error(`✗ unexpected signature header: ${JSON.stringify({ schemaVersion: parsed.schemaVersion, algorithm: parsed.algorithm })}`);
    process.exit(1);
  }
  if (parsed.keyId !== keyId) {
    console.error(`✗ signature names keyId "${parsed.keyId}", expected "${keyId}"`);
    process.exit(1);
  }
  const publicKey = createPublicKey(privateKey);
  const ok = verify(null, bytes, publicKey, Buffer.from(parsed.signature, 'base64'));
  if (!ok) {
    console.error('✗ signature does not match index.json — the index changed after signing');
    process.exit(1);
  }
  console.log(`✓ index.json.sig verifies with ${keyId} (${bytes.length} bytes signed)`);
  process.exit(0);
}

const signature = sign(null, bytes, privateKey).toString('base64');
const sig = {
  schemaVersion: SCHEMA_VERSION,
  algorithm: ALGORITHM,
  keyId,
  signature,
  signedAt: new Date(Number(process.env.SOURCE_DATE_EPOCH ?? 0) * 1000 || Date.now()).toISOString(),
};
writeFileSync(SIG, `${JSON.stringify(sig, null, 2)}\n`);
console.log(`✓ index.json.sig — keyId ${keyId}, ${bytes.length} bytes, signed ${sig.signedAt}`);
