#!/usr/bin/env node
/**
 * Build-toolchain guard (100% Vite + Tailwind v4 + Vitest).
 *
 * Asserts the installed toolchain matches what we declare in package.json and
 * package-lock.json, and enforces CSS-first Tailwind v4 tokens.
 *
 * Run: npm run verify:toolchain
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

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
for (const name of ['tailwindcss', '@tailwindcss/vite', '@tailwindcss/typography', 'vite', 'vitest']) {
  const want = declared[name];
  const got = installedVersion(name);
  if (!want) {
    fail(`${name}: missing from package.json`);
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
for (const name of ['tailwindcss', '@tailwindcss/vite', 'vite', 'vitest']) {
  const locked = lock.packages?.[`node_modules/${name}`]?.version;
  if (!locked) fail(`package-lock.json has no entry for ${name} — regenerate with \`npm install\``);
  else notes.push(`lock: ${name}@${locked}`);
}

// --- 3. Tailwind v4 CSS shape ---------------------------------------------
const css = fs.readFileSync(path.join(root, 'src/index.css'), 'utf8');
if (!/@import\s+['"]tailwindcss/.test(css)) {
  fail('src/index.css: missing v4 `@import "tailwindcss"` — found v3 `@tailwind` directives?');
}
if (!/@import\s+['"]\.\/styles\/tokens\.css['"]/.test(css)) {
  fail('src/index.css: missing `@import "./styles/tokens.css"`');
}
if (/@tailwind\s+(base|components|utilities)/.test(css)) {
  fail('src/index.css: still contains v3 `@tailwind` directives, which v4 ignores');
}
const tokensCssPath = path.join(root, 'src/styles/tokens.css');
if (!fs.existsSync(tokensCssPath)) {
  fail('src/styles/tokens.css: missing design token file');
} else {
  const tokensCss = fs.readFileSync(tokensCssPath, 'utf8');
  for (const token of ['--color-accent:', '--color-line:', '--color-line-control:', '--color-ink:', '--color-ink-muted:']) {
    if (!tokensCss.includes(token)) fail(`src/styles/tokens.css: design token \`${token}\` missing`);
  }
}

// --- 4. v3 config must not linger -----------------------------------------
if (fs.existsSync(path.join(root, 'tailwind.config.js'))) {
  fail('tailwind.config.js present. Tailwind v4 is CSS-first; move any needed values into src/styles/tokens.css.');
}

// --- 5. Design-token linter -----------------------------------------------
try {
  execFileSync(process.execPath, [path.join(root, 'scripts/verify-design-tokens.mjs')], {
    stdio: 'inherit',
  });
} catch {
  fail('verify-design-tokens.mjs reported token or radius violations');
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
