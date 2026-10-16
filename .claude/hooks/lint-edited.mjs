// PostToolUse hook (Edit|Write): runs ESLint with --fix on the edited TS/JS file.
// Remaining errors exit 2 so Claude sees them and fixes them before moving on.
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, relative, isAbsolute } from 'node:path';

const input = JSON.parse(readFileSync(0, 'utf8'));
const file = input.tool_input?.file_path ?? input.tool_response?.filePath;
const root = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
if (!file || !/\.(ts|mts|js|mjs)$/.test(file)) process.exit(0);

const rel = relative(root, file);
if (rel.startsWith('..') || isAbsolute(rel) || /^(dist|node_modules)[\\/]/.test(rel)) process.exit(0);

const eslint = join(root, 'node_modules', 'eslint', 'bin', 'eslint.js');
const res = spawnSync(process.execPath, [eslint, '--fix', '--no-warn-ignored', rel], { cwd: root, encoding: 'utf8' });
if (res.status === 0) process.exit(0);
process.stderr.write(`ESLint found problems in ${rel}:\n${res.stdout}${res.stderr}`);
process.exit(2);
