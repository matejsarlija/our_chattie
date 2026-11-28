#!/usr/bin/env node
/**
 * Design-token & radius linter for `src/components/`.
 *
 * Prevents token drift and silent Tailwind v4 undefined-utility regressions:
 *  1. Bans raw Tailwind color scales (bg-red-*, text-emerald-*, etc.)
 *  2. Bans raw CSS variable bracket hacks (border-[var(--...)], text-[var(--...)], bg-[var(--...)])
 *  3. Bans off-scale card radii (rounded-xl, rounded-2xl, rounded-3xl)
 *  4. Catches undefined semantic text-* / bg-* / border-* color classes not declared in src/styles/tokens.css
 *
 * Run standalone: npm run verify:tokens
 * Invoked automatically by: npm run verify:toolchain
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tokensPath = path.join(root, 'src/styles/tokens.css');
const componentsDir = path.join(root, 'src/components');

/**
 * Untouched Wave 2 / Wave 3 & static legacy files that will be migrated
 * in upcoming sprint waves. Wave 1 files and all `src/components/ui/`
 * primitives are NOT allowlisted and are checked strictly.
 */
const LEGACY_ALLOWLIST = new Set([]);

const RAW_TAILWIND_COLOR_RE =
  /(?:^|[\s"'`:])((?:bg|text|border|ring|fill|stroke|divide|from|to|via)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}(?:\/\d+)?)/g;

const VAR_BRACKET_RE =
  /(?:^|[\s"'`:])((?:bg|text|border|ring|outline)-\[var\(--[^\]]+\)\])/g;

const OFF_SCALE_RADIUS_RE =
  /(?:^|[\s"'`:])(rounded-(?:xl|2xl|3xl))(?=$|[\s"'`:])/g;

const SEMANTIC_COLOR_CLASS_RE =
  /(?:^|[\s"'`:])(text|bg|border)-([a-z][a-z0-9-]*(?:\/[0-9]+)?)(?=$|[\s"'`:])/g;

const NON_COLOR_UTILITIES = {
  text: new Set([
    'xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl', '4xl',
    'left', 'right', 'center', 'justify', 'start', 'end',
    'wrap', 'nowrap', 'balance', 'pretty', 'ellipsis', 'clip',
    'white', 'black', 'transparent', 'current', 'inherit',
  ]),
  bg: new Set([
    'white', 'black', 'transparent', 'current', 'inherit', 'none',
    'fixed', 'local', 'scroll', 'clip', 'origin', 'cover', 'contain',
    'auto', 'center', 'top', 'bottom', 'left', 'right',
    'repeat', 'no-repeat', 'repeat-x', 'repeat-y',
    'gradient-to-t', 'gradient-to-tr', 'gradient-to-r', 'gradient-to-br',
    'gradient-to-b', 'gradient-to-bl', 'gradient-to-l', 'gradient-to-tl',
    'linear-to-t', 'linear-to-r', 'linear-to-b', 'linear-to-l',
  ]),
  border: new Set([
    '0', '2', '4', '8', 't', 'r', 'b', 'l', 'x', 'y', 's', 'e',
    't-0', 't-2', 'r-0', 'r-2', 'b-0', 'b-2', 'l-0', 'l-2',
    'x-0', 'x-2', 'y-0', 'y-2',
    'solid', 'dashed', 'dotted', 'double', 'hidden', 'none',
    'collapse', 'separate',
    'white', 'black', 'transparent', 'current', 'inherit',
  ]),
};

function loadDeclaredColorTokens() {
  const css = fs.readFileSync(tokensPath, 'utf8');
  const themeMatch = css.match(/@theme\s+inline\s*\{([\s\S]*?)\}/);
  if (!themeMatch) {
    throw new Error('src/styles/tokens.css is missing an `@theme inline { ... }` block');
  }
  const declared = new Set();
  const re = /--color-([a-z0-9-]+)\s*:/g;
  let m;
  while ((m = re.exec(themeMatch[1])) !== null) {
    declared.add(m[1]);
  }
  return declared;
}

function walkComponentFiles(dir, relBase = '') {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const rel = relBase ? `${relBase}/${entry.name}` : entry.name;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'pyramid-hero') continue;
      files.push(...walkComponentFiles(full, rel));
    } else if (/\.(jsx?|tsx?)$/.test(entry.name) && !/\.test\./.test(entry.name)) {
      files.push({ rel, full });
    }
  }
  return files;
}

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/^\s*\/\/.*$/gm, '');
}

function lineNumberAt(text, index) {
  return text.slice(0, index).split('\n').length;
}

function lintFile({ rel, full }, declaredColors) {
  const raw = fs.readFileSync(full, 'utf8');
  const content = stripComments(raw);
  const violations = [];

  for (const [label, regex] of [
    ['raw Tailwind color scale', RAW_TAILWIND_COLOR_RE],
    ['raw CSS variable bracket hack', VAR_BRACKET_RE],
    ['off-scale radius', OFF_SCALE_RADIUS_RE],
  ]) {
    regex.lastIndex = 0;
    let m;
    while ((m = regex.exec(content)) !== null) {
      violations.push({
        file: rel,
        line: lineNumberAt(content, m.index),
        rule: label,
        token: m[1],
      });
    }
  }

  // Only check semantic class names inside className / cva / string literals
  // by scanning lines that look like JSX/CVA class strings.
  const lines = content.split('\n');
  lines.forEach((line, idx) => {
    if (!/(className|cva|TONE|GLYPH_CLASS|statusToneClass|variant|size|\?\s*['"`])/.test(line) && !/^\s*['"`]/.test(line)) {
      return;
    }
    // Extract quoted string literals on the line
    const strRe = /(['"`])((?:\\.|(?!\1).)*)\1/g;
    let sm;
    while ((sm = strRe.exec(line)) !== null) {
      const str = sm[2];
      // Skip URLs or CSS selectors or non-class strings
      if (str.includes('://') || str.startsWith('/')) continue;
      SEMANTIC_COLOR_CLASS_RE.lastIndex = 0;
      let cm;
      while ((cm = SEMANTIC_COLOR_CLASS_RE.exec(str)) !== null) {
        const [, prefix, rawToken] = cm;
        const baseToken = rawToken.split('/')[0];
        if (NON_COLOR_UTILITIES[prefix].has(baseToken)) continue;
        if (baseToken.startsWith('[')) continue;
        const colorToken = prefix === 'border'
          ? baseToken.replace(/^(?:t|r|b|l|x|y|s|e)-/, '')
          : baseToken;
        if (!declaredColors.has(colorToken)) {
          violations.push({
            file: rel,
            line: idx + 1,
            rule: 'undefined semantic color token',
            token: `${prefix}-${rawToken}`,
          });
        }
      }
    }
  });

  return violations;
}

const declaredColors = loadDeclaredColorTokens();
const files = walkComponentFiles(componentsDir);
const allViolations = [];
let checkedCount = 0;
let skippedAllowlistCount = 0;

for (const file of files) {
  if (LEGACY_ALLOWLIST.has(file.rel)) {
    skippedAllowlistCount += 1;
    continue;
  }
  checkedCount += 1;
  allViolations.push(...lintFile(file, declaredColors));
}

if (allViolations.length > 0) {
  console.error(`\nDesign-token lint failed (${allViolations.length} violation(s)):\n`);
  for (const v of allViolations) {
    console.error(`  FAIL src/components/${v.file}:${v.line} — ${v.rule}: \`${v.token}\``);
  }
  console.error('');
  process.exit(1);
}

console.log(
  `  ok   design tokens: ${checkedCount} component files clean (${declaredColors.size} tokens declared, ${skippedAllowlistCount} Wave 2/3 allowlisted)`,
);
