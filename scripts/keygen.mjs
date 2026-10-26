#!/usr/bin/env node
/**
 * keygen.mjs — create an ed25519 signing pair for the registry index.
 *
 * Same material Legion consumes: the public half goes into
 * `SKILL_STORE_PUBLIC_KEYS=<keyId>:<trust>:<base64 SPKI>`, the private half is a
 * CI secret (`SKILL_STORE_SIGNING_KEY`, base64 PKCS8) and never enters this repo.
 *
 *   node scripts/keygen.mjs --id apisky-2026 --out ~/.keys
 *   → ~/.keys/apisky-2026.key  (0600, base64 PKCS8)
 *     ~/.keys/apisky-2026.pub  (0644, base64 SPKI)
 */
import { generateKeyPairSync } from 'node:crypto';
import { mkdirSync, writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

function arg(name, fallback) {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? fallback : process.argv[at + 1];
}

const keyId = arg('id');
if (!keyId) {
  console.error('usage: node scripts/keygen.mjs --id <keyId> [--out <dir>]');
  process.exit(2);
}

const outDir = (arg('out') ?? join(homedir(), '.keys')).replace(/^~(?=$|\/)/, homedir());
mkdirSync(outDir, { recursive: true, mode: 0o700 });

const pair = generateKeyPairSync('ed25519');
const publicKey = pair.publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
const privateKey = pair.privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64');

const keyPath = join(outDir, `${keyId}.key`);
const pubPath = join(outDir, `${keyId}.pub`);
writeFileSync(keyPath, `${privateKey}\n`, { mode: 0o600 });
chmodSync(keyPath, 0o600);
writeFileSync(pubPath, `${publicKey}\n`);

console.log(`✓ private key → ${keyPath} (0600, never commit)`);
console.log(`✓ public key  → ${pubPath}`);
console.log('');
console.log('Legion:');
console.log(`  SKILL_STORE_PUBLIC_KEYS=${keyId}:official:${publicKey}`);
console.log('CI:');
console.log(`  gh secret set SKILL_STORE_SIGNING_KEY < ${keyPath}`);
