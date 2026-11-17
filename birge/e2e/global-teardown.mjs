import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const e2eDir = dirname(fileURLToPath(import.meta.url));
const backendDir = resolve(e2eDir, '../../birge-backend');
const pgDataRoot = process.env.E2E_PG_DATA_DIR
  || resolve(tmpdir(), 'birge-e2e-pg');
const python = process.env.BIRGE_E2E_PYTHON
  || (process.platform === 'win32'
    ? resolve(backendDir, 'venv', 'Scripts', 'python.exe')
    : 'python3');
const authFile = resolve(e2eDir, '.auth.json');

export default function globalTeardown() {
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
  rmSync(authFile, { force: true });
}
