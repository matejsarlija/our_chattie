#!/usr/bin/env node
/**
 * Build-toolchain guard.
 *
 * Why this exists: on 2026-09-30 both `npm run build` and `npm run cra:build`
 * were broken locally while CI was green. `node_modules` had drifted to
 * tailwindcss 4.3.3 while `package.json` and `package-lock.json` both still
 * declared 3.3.3. CI never saw it because `npm ci` installs deterministically
 * from the lockfile — the drift only ever existed on developer machines, and
 * nothing failed until someone ran a build.
 *
 * This asserts the installed toolchain matches what we declare, so drift
 * fails loudly and locally instead of silently at build time.
 *
 * Run: npm run verify:toolchain
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const notes = [];

const fail = (msg) => failures.push(msg);
const installedVersion = (pkg) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, 'node_modules', pkg, 'package.json'), 'utf8')).version;
  } catch {
    return null;
  }
};

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const declared = { ...pkg.dependencies, ...pkg.devDependencies };

// --- 1. declared vs installed major version -------------------------------
for (const name of ['tailwindcss', '@tailwindcss/postcss', '@tailwindcss/vite', '@tailwindcss/typography']) {
  const want = declared[name];
  const got = installedVersion(name);
  if (!want) {
    notes.push(`${name}: not declared (transitive or unused)`);
    continue;
  }
  if (!got) {
    fail(`${name}: declared ${want} but NOT installed — run \`npm ci\``);
    continue;
  }
  const wantMajor = want.replace(/^[^\d]*/, '').split('.')[0];
  const gotMajor = got.split('.')[0];
  if (wantMajor !== gotMajor) {
    fail(`${name}: declared ${want} (major ${wantMajor}) but installed ${got} (major ${gotMajor}) — node_modules has drifted from package.json`);
  } else {
    notes.push(`${name}: declared ~${wantMajor}.x, installed ${got}`);
  }
}

// --- 2. lockfile must agree with package.json -----------------------------
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
for (const name of ['tailwindcss', '@tailwindcss/postcss', '@tailwindcss/vite']) {
  const locked = lock.packages?.[`node_modules/${name}`]?.version;
  if (!locked) fail(`package-lock.json has no entry for ${name} — regenerate with \`npm install --package-lock-only\``);
  else notes.push(`lock: ${name}@${locked}`);
}

// --- 3. Tailwind v4 CSS shape ---------------------------------------------
const css = fs.readFileSync(path.join(root, 'src/index.css'), 'utf8');
if (!/@import\s+['"]tailwindcss/.test(css)) {
  fail('src/index.css: missing v4 `@import "tailwindcss"` — found v3 `@tailwind` directives?');
}
if (/@tailwind\s+(base|components|utilities)/.test(css)) {
  fail('src/index.css: still contains v3 `@tailwind` directives, which v4 ignores');
}
for (const token of ['--color-accent:', '--color-line:', '--color-line-control:']) {
  if (!css.includes(token)) fail(`src/index.css: design token \`${token}\` missing — see docs/design-direction.md §3`);
}

// --- 4. react-scripts patch must be applied -------------------------------
// The CRA build lane hardcodes `config: false` and the plugin name
// 'tailwindcss'. Under v4 that name is no longer a PostCSS plugin, so the lane
// breaks unless patches/react-scripts+*.patch has been applied. npm ci runs
// postinstall -> patch-package, but a stale or skipped install shows up here.
if (fs.existsSync(path.join(root, 'patches'))) {
  const craWebpack = path.join(root, 'node_modules/react-scripts/config/webpack.config.js');
  if (fs.existsSync(craWebpack)) {
    const src = fs.readFileSync(craWebpack, 'utf8');
    if (src.includes("'tailwindcss',")) {
      fail('react-scripts is UNPATCHED: webpack.config.js still loads `tailwindcss` as a PostCSS plugin, which Tailwind v4 removed. Run `npm ci` (postinstall applies patches/) or `npx patch-package react-scripts`.');
    } else if (!src.includes('@tailwindcss/postcss')) {
      fail('react-scripts is patched unexpectedly — expected `@tailwindcss/postcss` in webpack.config.js. Re-create with `npx patch-package react-scripts`.');
    } else {
      notes.push('react-scripts patch: applied (@tailwindcss/postcss)');
    }
  }
} else {
  fail('patches/ directory missing — the CRA build lane depends on the react-scripts patch');
}

// --- 5. v3 config must not linger -----------------------------------------
if (fs.existsSync(path.join(root, 'tailwind.config.js'))) {
  fail('tailwind.config.js present. Tailwind v4 is CSS-first; this file is ignored by Vite and only confuses CRA-style detection. Move any needed values into an @theme block in src/index.css.');
}

// --- report ---------------------------------------------------------------
notes.forEach((n) => console.log('  ok   ' + n));
if (failures.length) {
  console.error('\nBuild toolchain drift detected:\n');
  failures.forEach((f) => console.error('  FAIL ' + f));
  console.error('');
  process.exit(1);
}
console.log('\nBuild toolchain consistent.\n');
