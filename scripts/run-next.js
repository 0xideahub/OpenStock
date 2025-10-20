#!/usr/bin/env node

const { spawn } = require('child_process');

const DEFAULT_PORT = '4000';

const [, , subcommand, ...rawArgs] = process.argv;

if (!subcommand) {
  console.error('Usage: run-next.js <dev|start> [args...]');
  process.exit(1);
}

const hasPortFlag = rawArgs.some((arg) => arg === '-p' || arg === '--port');
const envPort =
  process.env.PORT ||
  process.env.port || // Allow lowercase env var just in case
  '';

const normalizedPort = hasPortFlag
  ? null
  : envPort && Number.isFinite(Number(envPort))
    ? String(Number(envPort))
    : DEFAULT_PORT;

const args = ['next', subcommand, ...rawArgs];

if (normalizedPort) {
  args.push('--port', normalizedPort);
}

const child = spawn('npx', args, {
  stdio: 'inherit',
  env: process.env,
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});

child.on('error', (error) => {
  console.error(`Failed to launch Next.js: ${error.message}`);
  process.exit(1);
});
