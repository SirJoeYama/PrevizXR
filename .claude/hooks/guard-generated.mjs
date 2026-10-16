// PreToolUse hook (Edit|Write): blocks hand edits to generated files and points at the command that regenerates them.
import process from 'node:process';
import { readFileSync } from 'node:fs';
import { relative } from 'node:path';

const GENERATED = [
  [/^src[\\/]assets[\\/]mesh2motionData\.ts$/, 'npm run catalog:m2m'],
  [/^public[\\/]catalog[\\/].+\.json$/, 'npm run catalog'],
  [/^package-lock\.json$/, 'npm install / npm update'],
];

const input = JSON.parse(readFileSync(0, 'utf8'));
const file = input.tool_input?.file_path;
if (!file) process.exit(0);
const rel = relative(process.env.CLAUDE_PROJECT_DIR ?? process.cwd(), file);
const hit = GENERATED.find(([re]) => re.test(rel));
if (!hit) process.exit(0);

process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: `${rel} is generated. Change its generator script or inputs and run \`${hit[1]}\` instead.`,
    },
  }),
);
