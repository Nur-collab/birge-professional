"""Best-effort cleanup for the ephemeral E2E PostgreSQL instance."""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]


def main() -> int:
    root = os.environ.get("E2E_PG_DATA_DIR")
    if not root:
        return 0

    data_dir = Path(root) / "data"
    pg_ctl = (
        BACKEND_DIR
        / "venv"
        / "Lib"
        / "site-packages"
        / "pgserver"
        / "pginstall"
        / "bin"
        / ("pg_ctl.exe" if sys.platform == "win32" else "pg_ctl")
    )
    if not pg_ctl.exists():
        # On Linux the interpreter may use a system/venv site-packages path;
        # locate the same binary through the installed package.
        try:
            import pgserver

            pg_ctl = Path(pgserver.__file__).parent / "pginstall" / "bin" / (
                "pg_ctl.exe" if sys.platform == "win32" else "pg_ctl"
            )
        except ImportError:
            pg_ctl = None

    if pg_ctl is not None and pg_ctl.exists() and data_dir.exists():
        subprocess.run(
            [str(pg_ctl), "-D", str(data_dir), "stop", "-m", "fast"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=30,
            check=False,
        )

    shutil.rmtree(root, ignore_errors=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
