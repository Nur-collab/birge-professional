"""Administrative endpoints."""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

import models
from database import get_db
from dependencies import get_current_admin
from trip_maintenance import cleanup_stale_trips

router = APIRouter(prefix="/admin", tags=["admin"])


@router.post("/cleanup-trips")
def run_admin_cleanup(
    current_user: models.User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    """Force stale-trip cleanup by an allowlisted admin."""
    stats = cleanup_stale_trips(db)
    return {"ok": True, "stats": stats}
