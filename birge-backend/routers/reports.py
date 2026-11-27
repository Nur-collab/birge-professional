"""Abuse reporting endpoint."""
import json
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

import models
import schemas
from database import get_db
from dependencies import get_current_user
from rate_limit import enforce_user_limit_sync
from realtime import is_trip_participant

router = APIRouter(prefix="/reports", tags=["reports"])


@router.post("/", response_model=schemas.AbuseReportOut)
def submit_abuse_report(
    payload: schemas.AbuseReportCreate,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Submit a conduct/safety report against another participant."""
    enforce_user_limit_sync(current_user.id, "report.create", 10, 3600)

    if payload.target_user_id == current_user.id:
        raise HTTPException(status_code=400, detail="Cannot report yourself")

    target = db.query(models.User).filter(models.User.id == payload.target_user_id).first()
    if not target or (target.phone or "").startswith("deleted_"):
        raise HTTPException(status_code=404, detail="Target user not found")

    if payload.trip_id is not None:
        trip = db.query(models.Trip).filter(models.Trip.id == payload.trip_id).first()
        if not trip:
            raise HTTPException(status_code=404, detail="Trip not found")
        if not is_trip_participant(db, payload.trip_id, current_user.id) or not is_trip_participant(
            db, payload.trip_id, payload.target_user_id
        ):
            raise HTTPException(status_code=403, detail="Access denied to report on this trip")

    dup_query = db.query(models.AbuseReport).filter(
        models.AbuseReport.reporter_id == current_user.id,
        models.AbuseReport.target_user_id == payload.target_user_id,
        models.AbuseReport.status == "open",
    )
    if payload.trip_id is not None:
        dup_query = dup_query.filter(models.AbuseReport.trip_id == payload.trip_id)
    if dup_query.first():
        raise HTTPException(status_code=409, detail="Active report already submitted")

    report = models.AbuseReport(
        reporter_id=current_user.id,
        target_user_id=payload.target_user_id,
        trip_id=payload.trip_id,
        reason=payload.reason,
        details=payload.details.strip() if payload.details else None,
        status="open",
    )
    db.add(report)
    db.flush()
    db.add(
        models.AuditLog(
            actor_id=current_user.id,
            action="report.created",
            entity_type="abuse_report",
            entity_id=report.id,
            details=json.dumps({"target_user_id": payload.target_user_id, "reason": payload.reason}),
        )
    )
    db.commit()
    db.refresh(report)

    return schemas.AbuseReportOut(
        id=report.id,
        reporter_id=report.reporter_id,
        reporter_name=current_user.name,
        target_user_id=report.target_user_id,
        target_name=target.name,
        trip_id=report.trip_id,
        reason=report.reason,
        details=report.details,
        status=report.status,
        admin_note=report.admin_note,
        target_is_blocked=bool(target.is_blocked),
        created_at=report.created_at.isoformat() if report.created_at else None,
        resolved_at=report.resolved_at.isoformat() if report.resolved_at else None,
    )
