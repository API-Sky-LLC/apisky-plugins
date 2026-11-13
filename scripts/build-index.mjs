#!/usr/bin/env node
/**
 * build-index.mjs — assemble the registry index from plugin manifests.
 *
 * The repository is the source of truth: `plugins/<slug>/` with a
 * `.skycoder-plugin/plugin.json` manifest, item folders (`skills/`, `rules/`,
 * `commands/`, `agents/`) and an optional `.mcp.json`. This script turns that
 * tree into:
 *
 *   index.json            what Legion's skill store reads (ids, hashes, trust)
 *   .skycoder-plugin/marketplace.json   the marketplace list (generated; agent
 *                                       clients that read this layout)
 *
 * Hashes are not decorative: `items[].contentHash` is the *framed tree hash*
 * Legion stores in the runtime profile (`contentHash`), and `files[].sha256` is
 * the raw per-file hash. Both are recomputed here with the same byte layout
 * Legion uses, so a hand-edited file can never be installed under the old hash.
 *
 * Usage:
 *   node scripts/build-index.mjs            # write index.json
 *   node scripts/build-index.mjs --check    # fail when index.json is stale
 *   node scripts/build-index.mjs --check-hashes  # also fail on drifted bytes
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PLUGINS_DIR = join(ROOT, 'plugins');

const REPO_SLUG = 'api-sky/plugins';
const REPO_LABEL = 'APISky plugins';
const REPO_TRUST = 'official';
const SCHEMA_VERSION = 1;

/** Mirrors legion/src/skill-store/skill-store.schema.ts */
const SLUG_SEGMENT = /^[a-z0-9][a-z0-9._-]*$/;
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const VERSION = /^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$/;
const TRUST_LEVELS = ['official', 'verified', 'community'];

const SKIP_DIRS = new Set(['node_modules', '.git']);
/** The store is an English product surface; the index must not carry Cyrillic. */
const CYRILLIC = /[\u0400-\u04FF]/;
const RULE_EXT = /\.(md|mdc)$/i;

// ── hashing (byte-identical to legion's content-tree.ts) ─────────────────────

/**
 * Framed tree hash: for every file, sorted by path, write
 * u32be(pathLen) + path + u64be(size) + bytes into one sha256.
 * A single-file item is hashed as a one-file tree, which is exactly what
 * Legion does when it reads `item.path` and hands the file over.
 */
export function hashContentTree(files) {
  const hash = createHash('sha256');
  for (const file of [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) {
    const pathBuf = Buffer.from(file.path, 'utf8');
    const pathLen = Buffer.alloc(4);
    pathLen.writeUInt32BE(pathBuf.length);
    hash.update(pathLen);
    hash.update(pathBuf);
    const size = Buffer.alloc(8);
    size.writeBigUInt64BE(BigInt(file.bytes.length));
    hash.update(size);
    hash.update(file.bytes);
  }
  return `sha256:${hash.digest('hex')}`;
}

export function rawSha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

// ── filesystem helpers ───────────────────────────────────────────────────────

const toPosix = (p) => p.split(sep).join('/');

function walk(dir, base = dir) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) out.push(...walk(full, base));
    else if (stat.isFile()) out.push({ abs: full, rel: toPosix(relative(base, full)), bytes: readFileSync(full) });
  }
  return out;
}

function isDir(p) {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function listDirs(dir) {
  if (!isDir(dir)) return [];
  return readdirSync(dir)
    .filter((name) => !SKIP_DIRS.has(name) && isDir(join(dir, name)))
    .sort();
}

function listFiles(dir, re) {
  if (!isDir(dir)) return [];
  return readdirSync(dir)
    .filter((name) => re.test(name) && statSync(join(dir, name)).isFile())
    .sort();
}

/** `description:` / `name:` from YAML frontmatter. Deliberately tiny: no YAML dep. */
export function frontmatter(text) {
  if (!text.startsWith('---')) return {};
  const end = text.indexOf('\n---', 3);
  if (end === -1) return {};
  const head = text.slice(3, end);
  const out = {};
  for (const line of head.split('\n')) {
    const at = line.indexOf(':');
    if (at <= 0) continue;
    const key = line.slice(0, at).trim();
    let value = line.slice(at + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (value) out[key] = value;
  }
  return out;
}

function lastCommitDate(relPath) {
  try {
    const iso = execFileSync('git', ['log', '-1', '--format=%cI', '--', relPath], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    // Git 2.56 writes UTC as "Z". Older git writes "+00:00". The index uses
    // "+00:00", so a runner on the newer git would otherwise call the index stale.
    return iso ? iso.replace(/Z$/, '+00:00') : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Fallback `updatedAt` for a pack with no commit yet (a pack under review, or a
 * checkout without history). It must be deterministic: the index is signed as
 * bytes, so a timestamp taken from the clock would make every rebuild a new
 * signature — and `--check` would never be green. The newest file mtime in the
 * pack directory is stable across rebuilds and moves only when the pack does.
 */
function newestFileTime(dir) {
  let newest = 0;
  for (const file of walk(dir)) {
    const mtime = statSync(file.abs).mtimeMs;
    if (mtime > newest) newest = mtime;
  }
  return newest > 0 ? new Date(Math.floor(newest / 1000) * 1000).toISOString() : undefined;
}

// ── manifest → pack ─────────────────────────────────────────────────────────

function readManifest(pluginDir) {
  const path = join(pluginDir, '.skycoder-plugin', 'plugin.json');
  if (!existsSync(path)) throw new Error(`missing ${toPosix(relative(ROOT, path))}`);
  return JSON.parse(readFileSync(path, 'utf8'));
}

/**
 * Store-only metadata rides in the manifest under `x-skyline`, so a plugin has
 * ONE manifest: agent clients that read this layout get the standard keys, and
 * the Legion-facing fields live in the extension block. Unknown keys are ignored
 * by Skyline's own (loose) schema.
 */
function skylineBlock(manifest) {
  const block = manifest['x-skyline'] ?? {};
  return {
    visibility: block.visibility === 'private' ? 'private' : 'public',
    trust: TRUST_LEVELS.includes(block.trust) ? block.trust : undefined,
    tags: Array.isArray(block.tags) ? block.tags : [],
    requires: Array.isArray(block.requires) ? block.requires : [],
    installs: Number.isInteger(block.installs) ? block.installs : 0,
    stars: Number.isInteger(block.stars) ? block.stars : 0,
    summary: typeof block.summary === 'string' ? block.summary : undefined,
    icon: typeof block.icon === 'string' ? block.icon : undefined,
    color: typeof block.color === 'string' ? block.color : undefined,
  };
}

// ── pack icon ───────────────────────────────────────────────────────────────

/**
 * Palette for a pack that does not ship its own icon. Chosen so every entry has
 * enough contrast against white text (the badge always draws white glyphs).
 */
const ICON_COLORS = [
  '#3794ff',
  '#89d185',
  '#cca700',
  '#c586c0',
  '#4ec9b0',
  '#e07a5f',
  '#5b8def',
  '#7f6ae0',
  '#d16969',
  '#3f9e8f',
  '#b58900',
  '#8a6fd1',
];

/** Stable colour per slug — the same pack keeps its badge across rebuilds. */
function iconColor(slug) {
  const digest = createHash('sha256').update(slug).digest();
  return ICON_COLORS[digest[0] % ICON_COLORS.length];
}

/**
 * A pack icon as an inline `data:` URL, so the catalog card needs no second
 * request and the index stays a single self-contained file.
 *
 * A pack may ship `x-skyline.icon` (a repo-relative SVG path); otherwise the
 * badge is derived from the pack name — first letter over a stable colour. The
 * derivation is deterministic on purpose: the index is served to clients that
 * must get the same bytes on every rebuild, and the signature pins those bytes.
 */
export function packIcon(slug, displayName, pluginDir, block) {
  const declared = block.icon;
  if (declared) {
    const abs = join(pluginDir, declared);
    if (!existsSync(abs)) throw new Error(`${slug}: x-skyline.icon points at a missing file (${declared})`);
    const bytes = readFileSync(abs);
    const type = declared.toLowerCase().endsWith('.svg') ? 'image/svg+xml' : 'image/png';
    return `data:${type};base64,${bytes.toString('base64')}`;
  }
  const fill = block.color ?? iconColor(slug);
  if (!/^#[0-9a-fA-F]{6}$/.test(fill)) throw new Error(`${slug}: x-skyline.color must be #rrggbb`);
  const glyph = escapeXml((displayName || slug).trim().charAt(0).toUpperCase() || '?');
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">` +
    `<rect width="64" height="64" rx="14" fill="${fill}"/>` +
    `<text x="32" y="32" fill="#ffffff" font-family="Helvetica,Arial,sans-serif" font-size="30" font-weight="600" ` +
    `text-anchor="middle" dominant-baseline="central">${glyph}</text></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
}

function escapeXml(text) {
  return text.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]);
}

export function buildPack(slug) {
  const pluginDir = join(PLUGINS_DIR, slug);
  const manifest = readManifest(pluginDir);
  const meta = skylineBlock(manifest);
  const packId = `${REPO_SLUG}/${slug}`;
  const items = [];

  const addItem = (item) => {
    if (!NAME_RE.test(item.name)) throw new Error(`${packId}: invalid item name "${item.name}"`);
    if (items.some((i) => i.name === item.name)) throw new Error(`${packId}: duplicate item name "${item.name}"`);
    items.push(item);
  };

  for (const dir of listDirs(join(pluginDir, 'skills'))) {
    const skillDir = join(pluginDir, 'skills', dir);
    const skillFile = join(skillDir, 'SKILL.md');
    if (!existsSync(skillFile)) continue;
    const fm = frontmatter(readFileSync(skillFile, 'utf8'));
    addItem({
      name: dir,
      kind: 'skill',
      description: fm.description,
      path: `plugins/${slug}/skills/${dir}`,
      rootAbs: skillDir,
      folder: true,
    });
  }

  for (const file of listFiles(join(pluginDir, 'rules'), RULE_EXT)) {
    const abs = join(pluginDir, 'rules', file);
    addItem({
      name: file.replace(RULE_EXT, ''),
      kind: 'rule',
      description: frontmatter(readFileSync(abs, 'utf8')).description ?? firstHeading(readFileSync(abs, 'utf8')),
      path: `plugins/${slug}/rules/${file}`,
      rootAbs: abs,
      folder: false,
    });
  }

  for (const file of listFiles(join(pluginDir, 'commands'), RULE_EXT)) {
    const abs = join(pluginDir, 'commands', file);
    addItem({
      name: file.replace(RULE_EXT, ''),
      kind: 'command',
      description: frontmatter(readFileSync(abs, 'utf8')).description ?? firstHeading(readFileSync(abs, 'utf8')),
      path: `plugins/${slug}/commands/${file}`,
      rootAbs: abs,
      folder: false,
    });
  }

  for (const file of listFiles(join(pluginDir, 'agents'), RULE_EXT)) {
    const abs = join(pluginDir, 'agents', file);
    addItem({
      name: file.replace(RULE_EXT, ''),
      kind: 'subagent',
      description: frontmatter(readFileSync(abs, 'utf8')).description ?? firstHeading(readFileSync(abs, 'utf8')),
      path: `plugins/${slug}/agents/${file}`,
      rootAbs: abs,
      folder: false,
    });
  }

  const mcpFile = join(pluginDir, '.mcp.json');
  const requires = [...meta.requires];
  if (existsSync(mcpFile)) {
    const parsed = JSON.parse(readFileSync(mcpFile, 'utf8'));
    for (const server of Object.keys(parsed.mcpServers ?? {}).sort()) {
      addItem({ name: server, kind: 'mcp', description: `MCP server the pack requires: ${server}`, requiresMcp: server });
      const req = `mcp:${server}`;
      if (!requires.includes(req)) requires.push(req);
    }
  }

  for (const f of walk(pluginDir)) {
    if (!/\.(md|mdc|json)$/i.test(f.rel)) continue;
    if (CYRILLIC.test(f.bytes.toString('utf8'))) throw new Error(`${packId}: ${f.rel} must be English (found Cyrillic)`);
  }

  // Every file in the plugin dir is declared with its raw hash: the install
  // path reads only item paths, but the whole tree is pinned so a silent byte
  // change anywhere is caught by `--check-hashes`.
  const files = walk(pluginDir).map((f) => ({
    path: `plugins/${slug}/${f.rel}`,
    sha256: rawSha256(f.bytes),
    bytes: f.bytes.length,
  }));
  const fileByPath = new Map(walk(pluginDir).map((f) => [`plugins/${slug}/${f.rel}`, f.bytes]));

  for (const item of items) {
    if (item.kind === 'mcp') {
      delete item.rootAbs;
      delete item.folder;
      continue;
    }
    if (item.folder) {
      const tree = walk(item.rootAbs).map((f) => ({ path: f.rel, bytes: f.bytes }));
      item.contentHash = hashContentTree(tree);
      item.fileCount = tree.length;
    } else {
      const bytes = fileByPath.get(item.path);
      if (!bytes) throw new Error(`${packId}: item ${item.name} has no bytes at ${item.path}`);
      item.contentHash = hashContentTree([{ path: posix.basename(item.path), bytes }]);
      item.fileCount = 1;
    }
    delete item.rootAbs;
    delete item.folder;
  }

  const version = manifest.version ?? '0.0.0';
  if (!VERSION.test(version)) throw new Error(`${packId}: version "${version}" is not semver`);
  if (!SLUG_SEGMENT.test(slug)) throw new Error(`${packId}: slug "${slug}" is not a valid pack slug`);
  if (manifest.name !== slug) {
    throw new Error(`${packId}: plugin.json name "${manifest.name}" must equal the folder name "${slug}"`);
  }

  // The store is an English surface: a Cyrillic summary or body lands on a card
  // in the web/mobile/ext clients and cannot be translated there.
  for (const text of [meta.summary ?? '', manifest.description ?? '', ...items.map((i) => i.description ?? '')]) {
    if (CYRILLIC.test(text)) throw new Error(`${packId}: text must be English (found Cyrillic): "${text.slice(0, 60)}"`);
  }

  return {
    slug,
    name: manifest.displayName ?? manifest.name,
    summary: meta.summary ?? manifest.description ?? '',
    description: manifest.description ?? '',
    version,
    license: manifest.license ?? 'UNLICENSED',
    author: typeof manifest.author === 'object' ? (manifest.author.name ?? REPO_LABEL) : (manifest.author ?? REPO_LABEL),
    updatedAt:
      lastCommitDate(`plugins/${slug}`) ??
      newestFileTime(pluginDir) ??
      new Date(Number(process.env.SOURCE_DATE_EPOCH ?? 0) * 1000 || Date.now()).toISOString(),
    tags: meta.tags,
    icon: packIcon(slug, manifest.displayName ?? manifest.name, pluginDir, meta),
    path: `plugins/${slug}`,
    items,
    requires,
    ...(meta.trust ? { trust: meta.trust } : {}),
    visibility: meta.visibility,
    installs: meta.installs,
    stars: meta.stars,
    files,
  };
}

function firstHeading(text) {
  const line = text.split('\n').find((l) => l.startsWith('# '));
  return line ? line.slice(2).trim() : undefined;
}

export function buildIndex(generatedAt) {
  const slugs = listDirs(PLUGINS_DIR);
  const packs = slugs.map(buildPack);
  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt,
    repo: { slug: REPO_SLUG, label: REPO_LABEL, trust: REPO_TRUST },
    packs,
  };
}

export function buildMarketplace(index) {
  return {
    name: 'apisky-plugins',
    owner: { name: 'APISky', email: 'plugins@apisky.net' },
    metadata: {
      description: 'APISky agent plugins: skills, rules, commands and MCP requirements for Skyline and other agent clients.',
      version: '1.0.0',
    },
    plugins: index.packs.map((pack) => ({
      name: pack.slug,
      source: `./${pack.path}`,
      description: pack.summary || pack.description,
      ...(pack.visibility === 'private' ? { visibility: 'private' } : {}),
    })),
  };
}

/** Deterministic JSON: 2-space, trailing newline, no key sorting (insertion order is the contract). */
export function serialize(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

// ── CLI ─────────────────────────────────────────────────────────────────────

function main(argv) {
  const check = argv.includes('--check');
  const checkHashes = argv.includes('--check-hashes');
  const indexPath = join(ROOT, 'index.json');
  const marketPath = join(ROOT, '.skycoder-plugin', 'marketplace.json');

  const current = existsSync(indexPath) ? JSON.parse(readFileSync(indexPath, 'utf8')) : undefined;
  const generatedAt =
    current?.generatedAt ?? new Date(Number(process.env.SOURCE_DATE_EPOCH ?? 0) * 1000 || Date.now()).toISOString();
  const index = buildIndex(generatedAt);
  const marketplace = buildMarketplace(index);
  const indexText = serialize(index);
  const marketText = serialize(marketplace);

  const problems = [];

  if (check) {
    if (!current) problems.push('index.json is missing');
    else if (serialize(current) !== indexText) {
      problems.push('index.json is stale — run: npm run build');
      for (const pack of index.packs) {
        const prev = (current.packs ?? []).find((p) => p.slug === pack.slug);
        if (!prev) problems.push(`  ${pack.slug}: not in index.json`);
        else if (prev.updatedAt !== pack.updatedAt) {
          problems.push(`  ${pack.slug}: updatedAt index ${prev.updatedAt} rebuild ${pack.updatedAt}`);
        }
      }
    }
    const marketCurrent = existsSync(marketPath) ? readFileSync(marketPath, 'utf8') : '';
    if (marketCurrent !== marketText) problems.push('marketplace.json is stale — run: npm run build');
  }

  if (checkHashes && current) {
    // Rebuild with the on-disk bytes and diff the hashes only: catches a file
    // edited after the index was generated (the index would install stale bytes).
    const fresh = buildIndex(current.generatedAt);
    for (const pack of current.packs ?? []) {
      const now = fresh.packs.find((p) => p.slug === pack.slug);
      if (!now) {
        problems.push(`pack ${pack.slug} is gone from disk but still in index.json`);
        continue;
      }
      for (const item of pack.items ?? []) {
        const freshItem = now.items.find((i) => i.name === item.name);
        if (!freshItem) problems.push(`${pack.slug}: item ${item.name} disappeared`);
        else if (freshItem.contentHash !== item.contentHash) {
          problems.push(`${pack.slug}: ${item.name} bytes changed (index ${item.contentHash}, disk ${freshItem.contentHash})`);
        }
      }
    }
  }

  if (problems.length > 0) {
    for (const p of problems) console.error(`✗ ${p}`);
    process.exit(1);
  }

  if (!check) {
    writeFileSync(indexPath, indexText);
    writeFileSync(marketPath, marketText);
    const items = index.packs.reduce((n, p) => n + p.items.length, 0);
    console.log(`✓ index.json — ${index.packs.length} pack(s), ${items} item(s), ${index.packs.flatMap((p) => p.files).length} file(s)`);
    console.log('  next: npm run sign  (writes index.json.sig)');
  } else {
    console.log('✓ index.json and marketplace.json are up to date');
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
