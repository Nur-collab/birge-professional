"""Export the FastAPI OpenAPI schema for frontend type generation."""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_ROOT))
os.environ.setdefault("ENVIRONMENT", "development")

import main  # noqa: E402  (environment must be set before app imports)

ROOT = BACKEND_ROOT.parent
OUTPUT = ROOT / "birge" / "openapi.json"

OUTPUT.write_text(
    json.dumps(main.app.openapi(), ensure_ascii=False, indent=2, sort_keys=True) + "\n",
    encoding="utf-8",
)
print(f"Wrote {OUTPUT}")
