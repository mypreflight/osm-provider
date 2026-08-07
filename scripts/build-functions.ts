#!/usr/bin/env node
/**
 * Assembles the deployable project under build/.
 *
 * Everything in build/ is generated, so it is gitignored and safe to delete.
 * The inner `packages/` name is not a choice: DigitalOcean's builder only looks
 * at project.yml, packages/ and lib/ inside the project directory.
 *
 * Why bundle at all: a remote build would only upload those same three paths
 * and so would never see src/. Bundling locally keeps src/ the single source of
 * truth for both the CLI and the functions, and collapses the .ts import
 * extensions that Node's type stripping needs but the Functions runtime does
 * not understand.
 */
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { copyFileSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';

interface FunctionTarget {
  name: string;
  package: string;
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BUILD_DIR = join(ROOT, 'build');

const FUNCTIONS: FunctionTarget[] = [
  { name: 'pull', package: 'airport' },
  { name: 'sync', package: 'airport' },
];

const requested = process.argv.slice(2);
const selected =
  requested.length > 0 ? FUNCTIONS.filter((fn) => requested.includes(fn.name)) : FUNCTIONS;

if (selected.length === 0) {
  console.error(
    `Unknown function(s): ${requested.join(', ')}. Known: ${FUNCTIONS.map((fn) => fn.name).join(', ')}`,
  );
  process.exit(1);
}

// A full rebuild every time, so a renamed or deleted function cannot linger.
if (requested.length === 0) {
  rmSync(BUILD_DIR, { recursive: true, force: true });
}
mkdirSync(BUILD_DIR, { recursive: true });

// project.yml has to sit beside packages/ inside the project directory.
copyFileSync(join(ROOT, 'project.yml'), join(BUILD_DIR, 'project.yml'));

for (const fn of selected) {
  const directory = join(BUILD_DIR, 'packages', fn.package, fn.name);
  mkdirSync(directory, { recursive: true });

  const outfile = join(directory, 'index.js');
  await build({
    entryPoints: [join(ROOT, 'src', 'function', `${fn.name}.ts`)],
    outfile,
    bundle: true,
    platform: 'node',
    // Must track project.yml's runtime, which the platform caps at nodejs:24.
    target: 'node24',
    format: 'cjs',
    logLevel: 'warning',
  });

  // The repo root declares "type": "module", which would make this bare .js
  // load as ESM locally. Excluded from the deploy by .include below.
  writeFileSync(
    join(directory, 'package.json'),
    `${JSON.stringify({ type: 'commonjs' }, null, 2)}\n`,
  );

  // Ship the bundle and nothing else.
  writeFileSync(join(directory, '.include'), 'index.js\n');

  const bytes = statSync(outfile).size;
  console.log(`built ${fn.package}/${fn.name} -> ${(bytes / 1024).toFixed(1)} KB`);
}

console.log(`deployable project ready at build/ (doctl serverless deploy build)`);
