import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const e2eDir = dirname(fileURLToPath(import.meta.url));
const frontendDir = resolve(e2eDir, '..');
const projectDir = resolve(frontendDir, '..');
const backendDir = resolve(projectDir, 'birge-backend');
const authFile = resolve(e2eDir, '.auth.json');
const pgDataRoot = process.env.E2E_PG_DATA_DIR
  || resolve(tmpdir(), 'birge-e2e-pg');
const port = process.env.E2E_API_PORT || '8765';
const python = process.env.BIRGE_E2E_PYTHON
  || (process.platform === 'win32'
    ? resolve(backendDir, 'venv', 'Scripts', 'python.exe')
    : 'python3');

if (process.platform === 'win32' && !existsSync(python)) {
  console.error(`[E2E] Python venv not found: ${python}`);
  process.exit(1);
}

rmSync(authFile, { force: true });
// Remove a server left behind by an interrupted previous run before starting.
spawnSync(
  python,
  ['scripts/stop_e2e_postgres.py'],
  {
    cwd: backendDir,
    env: { ...process.env, E2E_PG_DATA_DIR: pgDataRoot },
    stdio: 'ignore',
    timeout: 30_000,
  },
);
rmSync(pgDataRoot, { recursive: true, force: true });

const env = {
  ...process.env,
  E2E_API_PORT: port,
  E2E_AUTH_FILE: authFile,
  E2E_PG_DATA_DIR: pgDataRoot,
  ENVIRONMENT: 'test',
  SECRET_KEY: randomBytes(32).toString('hex'),
  ALLOWED_ORIGINS: 'http://127.0.0.1:4174',
  PYTHONUNBUFFERED: '1',
};

// This wrapper starts ephemeral PostgreSQL, runs Alembic, seeds the E2E user
// and then launches uvicorn. Keep the Python process as the child so its
// finally block can stop PostgreSQL cleanly.
const child = spawn(
  python,
  ['scripts/run_e2e_backend.py'],
  { cwd: backendDir, env, stdio: 'inherit' },
);

let cleaned = false;
const cleanup = () => {
  if (cleaned) return;
  cleaned = true;
  // The Python wrapper normally cleans up itself, but Playwright may terminate
  // the process tree without allowing its finally block to run.
  spawnSync(
    python,
    ['scripts/stop_e2e_postgres.py'],
    { cwd: backendDir, env, stdio: 'ignore', timeout: 30_000 },
  );
  rmSync(pgDataRoot, { recursive: true, force: true });
  rmSync(authFile, { force: true });
};

const stop = () => {
  if (!child.killed) child.kill();
  cleanup();
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
process.on('exit', cleanup);

child.on('error', (error) => {
  console.error(error);
  cleanup();
  process.exit(1);
});
child.on('exit', (code) => {
  cleanup();
  process.exit(code ?? 0);
});
