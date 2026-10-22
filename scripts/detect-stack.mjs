import { existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', 'build', 'out', '.git', '.vercel', '.netlify', '.vibe-secure', 'coverage']);
const MANIFESTS = ['package.json', 'pyproject.toml', 'requirements.txt'];
const MAX_DEPTH = 3;

function readDeps(dir) {
  try {
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    return new Set([...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})]);
  } catch {
    return new Set();
  }
}

function findAppDirs(root) {
  const found = [];
  const walk = (rel, depth) => {
    const abs = join(root, rel);
    if (MANIFESTS.some((m) => existsSync(join(abs, m)))) found.push(rel);
    if (depth >= MAX_DEPTH) return;
    for (const e of readdirSync(abs, { withFileTypes: true })) {
      if (e.isDirectory() && !SKIP_DIRS.has(e.name)) walk(rel ? `${rel}/${e.name}` : e.name, depth + 1);
    }
  };
  walk('', 0);
  return found;
}

function detectApp(root, rel) {
  const dir = join(root, rel);
  const has = (f) => existsSync(join(dir, f));
  const base = { path: rel || '.', language: 'js', framework: 'unknown', db: [], payments: [], ai: [], host: 'unknown', generator: null };
  if (!has('package.json')) return { ...base, language: 'python' };

  const deps = readDeps(dir);
  const any = (...names) => names.some((n) => deps.has(n));

  let framework = 'unknown';
  if (deps.has('next')) framework = 'next';
  else if ([...deps].some((d) => d.startsWith('@remix-run/'))) framework = 'remix';
  else if (deps.has('@sveltejs/kit')) framework = 'sveltekit';
  else if (deps.has('vite') && deps.has('react')) framework = 'react-vite';
  else if (deps.has('express')) framework = 'express';

  const db = [];
  if (any('@supabase/supabase-js', '@supabase/ssr') || has('supabase')) db.push('supabase');
  if (any('firebase', 'firebase-admin') || has('firebase.json') || has('firestore.rules')) db.push('firebase');
  if (deps.has('@prisma/client')) db.push('prisma');
  if (deps.has('drizzle-orm')) db.push('drizzle');
  if (any('mongodb', 'mongoose')) db.push('mongodb');

  const ai = [];
  if (deps.has('openai')) ai.push('openai');
  if (deps.has('@anthropic-ai/sdk')) ai.push('anthropic');
  if (any('@google/generative-ai', '@google/genai')) ai.push('google');
  if (deps.has('ai')) ai.push('vercel-ai');

  let host = 'unknown';
  if (has('vercel.json') || has('.vercel')) host = 'vercel';
  else if (has('netlify.toml')) host = 'netlify';
  else if (has('firebase.json') && readFileSync(join(dir, 'firebase.json'), 'utf8').includes('"hosting"')) host = 'firebase';

  const generator = deps.has('lovable-tagger') ? 'lovable' : has('.bolt') ? 'bolt' : null;

  return { ...base, framework, db, payments: any('stripe', '@stripe/stripe-js') ? ['stripe'] : [], ai, host, generator };
}

export function detectStack(root) {
  const apps = findAppDirs(root).map((rel) => detectApp(root, rel));
  apps.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { root, apps };
}

function main(args) {
  if (args.length !== 1) {
    console.error('usage: node scripts/detect-stack.mjs <root>');
    return 2;
  }
  const root = resolve(args[0]);
  const json = JSON.stringify(detectStack(root), null, 2);
  mkdirSync(join(root, '.vibe-secure'), { recursive: true });
  writeFileSync(join(root, '.vibe-secure', 'stack.json'), json + '\n');
  console.log(json);
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
