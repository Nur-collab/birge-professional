"""Seed a deterministic user for browser E2E tests.

This script is only used by the Playwright harness. It never runs as part of
the application and refuses to touch a production database.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

if os.environ.get("ENVIRONMENT") != "test":
    raise SystemExit("seed_e2e.py requires ENVIRONMENT=test")
if os.environ.get("RENDER"):
    raise SystemExit("seed_e2e.py must not run in production")

database_url = os.environ.get("DATABASE_URL", "")
if not (database_url.startswith("sqlite") or database_url.startswith("postgresql")):
    raise SystemExit("seed_e2e.py expects an isolated SQLite or PostgreSQL database")

import auth  # noqa: E402
import database  # noqa: E402
import models  # noqa: E402


def main() -> None:
    auth_file = os.environ.get("E2E_AUTH_FILE")
    if not auth_file:
        raise SystemExit("E2E_AUTH_FILE is required")

    with database.SessionLocal() as db:
        user = db.query(models.User).filter(models.User.phone == "+996555000001").first()
        if user is None:
            user = models.User(
                name="E2E Passenger",
                phone="+996555000001",
                is_verified=True,
                token_version=0,
            )
            db.add(user)
            db.commit()
            db.refresh(user)

        token = auth.create_access_token({
            "sub": user.id,
            "ver": user.token_version or 0,
        })
        payload = {
            "token": token,
            "userId": user.id,
        }

    path = Path(auth_file)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload), encoding="utf-8")
    print(f"[E2E] seeded user {payload['userId']} -> {path}")


if __name__ == "__main__":
    main()
