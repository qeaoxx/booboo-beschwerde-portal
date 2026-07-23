import { readdir, readFile } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = new URL('..', import.meta.url).pathname;
const ignored = new Set(['node_modules', '.git', 'sources']);
const files = [];

async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await walk(path);
    else files.push(path);
  }
}

await walk(root);
let failed = false;
for (const file of files.filter((path) => extname(path) === '.js' || extname(path) === '.mjs')) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) {
    failed = true;
    console.error(`Syntaxfehler in ${relative(root, file)}\n${result.stderr}`);
  }
}

for (const file of files.filter((path) => extname(path) === '.js' || extname(path) === '.mjs')) {
  const content = await readFile(file, 'utf8');
  for (const match of content.matchAll(/(?:from\s+|import\s*\()(['"])(\.{1,2}\/[^'"]+)\1/g)) {
    const target = resolve(dirname(file), match[2]);
    if (!files.includes(target)) {
      failed = true;
      console.error(`Fehlender relativer Import in ${relative(root, file)}: ${match[2]}`);
    }
  }
}

const forbidden = [
  /x-admin-password/i,
  /sessionStorage\.setItem\(['"]boobooAdminPassword/i,
  /TELEGRAM_BOT_TOKEN\s*=\s*['"][^'"]+['"]/,
  /BOOBOO_(?:PORTAL|ADMIN)_PASSWORD\s*=\s*['"][^'"]+['"]/,
];
for (const file of files.filter((path) => ['.js', '.mjs', '.html', '.toml', '.md'].includes(extname(path)) && !path.includes('/tests/') && !path.endsWith('/scripts/check.mjs'))) {
  const content = await readFile(file, 'utf8');
  for (const pattern of forbidden) {
    if (pattern.test(content)) {
      failed = true;
      console.error(`Verbotenes Muster in ${relative(root, file)}: ${pattern}`);
    }
  }
}

const index = await readFile(join(root, 'public/index.html'), 'utf8');
if (/fonts\.googleapis|fonts\.gstatic/.test(index)) {
  failed = true;
  console.error('Externe Google Fonts sind weiterhin eingebunden.');
}

if (failed) process.exit(1);
console.log(`Prüfung erfolgreich: ${files.length} Dateien, Syntax und Secret-Regeln bestanden.`);
