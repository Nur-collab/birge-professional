"""Run the API against an ephemeral PostgreSQL server for Playwright E2E.

This is a test harness, not application code. It uses pgserver to start a
real PostgreSQL 16 instance, applies the Alembic chain, creates a deterministic
test user and then runs uvicorn until the parent process stops it.
"""
from __future__ import annotations

import os
import shutil
import signal
import subprocess
import sys
import tempfile
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
PROJECT_DIR = BACKEND_DIR.parent
sys.path.insert(0, str(BACKEND_DIR))

if os.environ.get("ENVIRONMENT", "").lower() == "production" or os.environ.get("RENDER"):
    raise SystemExit("run_e2e_backend.py must not run in production")


def _run(args: list[str], env: dict[str, str]) -> None:
    subprocess.run(args, cwd=BACKEND_DIR, env=env, check=True)


def main() -> int:
    import secrets

    import pgserver

    data_root = Path(
        os.environ.get("E2E_PG_DATA_DIR")
        or tempfile.mkdtemp(prefix="birge-e2e-pg-")
    )
    data_root.mkdir(parents=True, exist_ok=True)
    pg = pgserver.get_server(data_root / "data", cleanup_mode="delete")
    child: subprocess.Popen[bytes] | None = None
    try:
        uri = pg.get_uri()
        auth_file = Path(
            os.environ.get(
                "E2E_AUTH_FILE",
                str(PROJECT_DIR / "birge" / "e2e" / ".auth.json"),
            )
        )
        env = {
            **os.environ,
            "DATABASE_URL": uri,
            "E2E_DATABASE_URL": uri,
            "ENVIRONMENT": "test",
            "SECRET_KEY": os.environ.get("SECRET_KEY") or secrets.token_hex(32),
            "PII_ENCRYPTION_KEY": os.environ.get("PII_ENCRYPTION_KEY") or "e2e-only-pii-key",
            "OTP_HASH_KEY": os.environ.get("OTP_HASH_KEY") or "e2e-only-otp-key",
            "REDIS_URL": "",
            "TELEGRAM_BOT_TOKEN": "",
            "RENDER_EXTERNAL_URL": "",
            "ALLOWED_ORIGINS": "http://127.0.0.1:4174",
            "E2E_AUTH_FILE": str(auth_file),
        }

        print(f"[E2E] PostgreSQL started: {uri.split('@')[-1]}")
        _run([sys.executable, "-m", "alembic", "upgrade", "head"], env)
        _run([sys.executable, "scripts/seed_e2e.py"], env)

        port = os.environ.get("E2E_API_PORT", "8765")
        child = subprocess.Popen(
            [
                sys.executable,
                "-m",
                "uvicorn",
                "main:app",
                "--host",
                "127.0.0.1",
                "--port",
                port,
                "--no-access-log",
            ],
            cwd=BACKEND_DIR,
            env=env,
        )

        def stop(_signum=None, _frame=None) -> None:
            if child is not None and child.poll() is None:
                child.terminate()

        signal.signal(signal.SIGINT, stop)
        signal.signal(signal.SIGTERM, stop)
        return child.wait()
    finally:
        if child is not None and child.poll() is None:
            child.terminate()
            try:
                child.wait(timeout=10)
            except subprocess.TimeoutExpired:
                child.kill()
        pg.cleanup()
        shutil.rmtree(data_root, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
