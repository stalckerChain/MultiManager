import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join, extname } from 'path';
import { execSync } from 'child_process';

const args = process.argv.slice(2);
if (!args[0]) {
  console.error('Usage: node scripts/bump-version.mjs <version>');
  console.error('  <version> — exact (1.2.0) or semver keyword (patch, minor, major)');
  process.exit(1);
}

const newVer = args[0];
const root = process.cwd();

try {
  execSync(`npm version ${newVer} --no-git-tag-version`, { cwd: root, stdio: 'pipe' });
} catch {
  console.log(`npm version skipped (${newVer} unchanged), reading package.json directly`);
}

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'));
const version = pkg.version;

const mdFiles = [];
function walk(dir) {
  if (dir.includes('node_modules')) return;
  if (dir.endsWith('.git')) return;
  try {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (extname(full) === '.md') {
        mdFiles.push(full);
      }
    }
  } catch { /* ignore */ }
}
walk(root);

const patterns = [
  { regex: /^(#\s*MultiManager\s*)v?\d+\.\d+\.\d+/gm, replace: `$1v${version}` },
  { regex: /^(\*\*Версия системы:\s*)\d+\.\d+\.\d+/gm, replace: `$1${version}` },
  { regex: /(\(MultiManager\s*)v?\d+\.\d+\.\d+(\))/gm, replace: `$1v${version}$2` },
  { regex: /^(\*\*Версия:\s*)\d+\.\d+\.\d+/gm, replace: `$1${version}` },
  { regex: /(TS\.md\s*#\s*ТЕХНИЧЕСКОЕ ЗАДАНИЕ\s*\()v?\d+\.\d+\.\d+(\))/gm, replace: `$1v${version}$2` },
  { regex: /(MultiManager\s*(Setup|Portable)-)\d+\.\d+\.\d+(\.exe|\.zip)/gm, replace: `$1${version}$3` },
];

let count = 0;
for (const file of mdFiles) {
  let content = readFileSync(file, 'utf-8');
  const orig = content;
  for (const { regex, replace } of patterns) {
    content = content.replace(regex, replace);
  }
  if (content !== orig) {
    writeFileSync(file, content, 'utf-8');
    console.log(`  ✓ ${file}`);
    count++;
  }
}

console.log(`\nUpdated ${count} .md files.`);

execSync('git add -A', { cwd: root, stdio: 'inherit' });
execSync(`git commit -m "v${version} — bump version"`, { cwd: root, stdio: 'inherit' });
execSync(`git tag -a v${version} -m "v${version}"`, { cwd: root, stdio: 'inherit' });

console.log(`\n✅ v${version} committed and tagged.`);
console.log(`   Push with: git push origin main --tags`);