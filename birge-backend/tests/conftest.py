import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

# Must be set before importing database/main in any test module.
os.environ["DATABASE_URL"] = "sqlite:///./_test_birge.db"
os.environ["RENDER_EXTERNAL_URL"] = ""
os.environ["ENVIRONMENT"] = "test"
os.environ["ADMIN_PHONES"] = "+996555000001"
os.environ.pop("IMGBB_API_KEY", None)


def pytest_sessionfinish(session, exitstatus):
    # SQLite keeps the file handle in the pool on Windows; dispose before unlink.
    try:
        import database
        database.engine.dispose()
    except Exception:
        pass
    try:
        Path(ROOT / "_test_birge.db").unlink(missing_ok=True)
    except PermissionError:
        # A leaked external connection should not fail an otherwise green run.
        pass
