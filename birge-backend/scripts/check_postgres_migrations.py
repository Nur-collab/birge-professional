"""Run the Alembic chain against a real ephemeral PostgreSQL server.

Usage:
    python scripts/check_postgres_migrations.py

This is a local verification helper. CI uses the postgres:16 service directly.
"""
from __future__ import annotations

import os
import secrets
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]


def main() -> int:
    import pgserver

    data_root = Path(tempfile.mkdtemp(prefix="birge-pg-migrations-"))
    pg = pgserver.get_server(data_root / "data", cleanup_mode="delete")
    try:
        env = {
            **os.environ,
            "DATABASE_URL": pg.get_uri(),
            "ENVIRONMENT": "test",
            "SECRET_KEY": secrets.token_hex(32),
            "REDIS_URL": "",
            "TELEGRAM_BOT_TOKEN": "",
            "RENDER_EXTERNAL_URL": "",
        }
        print(f"[PostgreSQL] {pg.get_uri().split('@')[-1]}")
        for command in (["upgrade", "head"], ["check"]):
            print(f"[PostgreSQL] alembic {' '.join(command)}")
            result = subprocess.run(
                [sys.executable, "-m", "alembic", *command],
                cwd=BACKEND_DIR,
                env=env,
            )
            if result.returncode != 0:
                return result.returncode
        print("[PostgreSQL] migrations and drift check passed")
        return 0
    finally:
        pg.cleanup()
        shutil.rmtree(data_root, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
