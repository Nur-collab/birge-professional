import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const e2eDir = dirname(fileURLToPath(import.meta.url));
const frontendDir = resolve(e2eDir, '..');
const apiUrl = `http://127.0.0.1:${process.env.E2E_API_PORT || '8765'}`;
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const child = spawn(
  npm,
  ['run', 'dev', '--', '--host', '127.0.0.1', '--port', '4174', '--strictPort'],
  {
    cwd: frontendDir,
    env: { ...process.env, VITE_API_URL: apiUrl },
    stdio: 'inherit',
    // npm.cmd is a batch shim on Windows; Node 24 refuses to spawn it directly.
    shell: process.platform === 'win32',
  },
);

const stop = () => {
  if (!child.killed) child.kill();
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

child.on('error', (error) => {
  console.error(error);
  process.exit(1);
});
child.on('exit', (code) => process.exit(code ?? 0));
