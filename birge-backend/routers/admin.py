"""Administrative endpoints for maintenance, moderation reports, and conversion funnel analytics."""
from datetime import datetime, timezone
import json
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload

import models
import schemas
from analytics import build_funnel_summary
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


@router.get("/reports", response_model=List[schemas.AbuseReportOut])
def list_abuse_reports(
    status: Optional[str] = Query(None, max_length=20),
    limit: int = Query(50, ge=1, le=200),
    current_user: models.User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    """List submitted abuse reports for moderation review."""
    query = (
        db.query(models.AbuseReport)
        .options(
            joinedload(models.AbuseReport.reporter),
            joinedload(models.AbuseReport.target_user),
        )
        .order_by(models.AbuseReport.id.desc())
    )
    if status:
        query = query.filter(models.AbuseReport.status == status)
    reports = query.limit(limit).all()

    return [
        schemas.AbuseReportOut(
            id=r.id,
            reporter_id=r.reporter_id,
            reporter_name=r.reporter.name if r.reporter else None,
            target_user_id=r.target_user_id,
            target_name=r.target_user.name if r.target_user else None,
            trip_id=r.trip_id,
            reason=r.reason,
            details=r.details,
            status=r.status,
            admin_note=r.admin_note,
            target_is_blocked=bool(r.target_user.is_blocked) if r.target_user else False,
            created_at=r.created_at.isoformat() if r.created_at else None,
            resolved_at=r.resolved_at.isoformat() if r.resolved_at else None,
        )
        for r in reports
    ]


@router.patch("/reports/{report_id}", response_model=schemas.AbuseReportOut)
def moderate_abuse_report(
    report_id: int,
    payload: schemas.AbuseReportModerationUpdate,
    current_user: models.User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    """Update moderation status on a report and optionally suspend/unsuspend the target user."""
    report = (
        db.query(models.AbuseReport)
        .options(
            joinedload(models.AbuseReport.reporter),
            joinedload(models.AbuseReport.target_user),
        )
        .filter(models.AbuseReport.id == report_id)
        .first()
    )
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")

    now_naive = datetime.now(timezone.utc).replace(tzinfo=None)
    now_tz = datetime.now(timezone.utc)
    report.status = payload.status
    if payload.admin_note is not None:
        report.admin_note = payload.admin_note.strip() or None
    report.reviewed_by = current_user.id
    if payload.status in ("resolved", "dismissed"):
        report.resolved_at = now_naive

    target = report.target_user
    if payload.block_target is not None and target is not None:
        if target.id == current_user.id and payload.block_target:
            raise HTTPException(status_code=400, detail="Cannot block yourself")
        target.is_blocked = bool(payload.block_target)
        if payload.block_target:
            target.token_version = (target.token_version or 0) + 1
            db.query(models.RefreshSession).filter(
                models.RefreshSession.user_id == target.id,
                models.RefreshSession.revoked_at.is_(None),
            ).update({"revoked_at": now_tz}, synchronize_session=False)

    db.add(
        models.AuditLog(
            actor_id=current_user.id,
            action="report.moderated",
            entity_type="abuse_report",
            entity_id=report.id,
            details=json.dumps(
                {
                    "status": report.status,
                    "block_target": payload.block_target,
                    "target_user_id": report.target_user_id,
                }
            ),
        )
    )
    db.commit()
    db.refresh(report)

    return schemas.AbuseReportOut(
        id=report.id,
        reporter_id=report.reporter_id,
        reporter_name=report.reporter.name if report.reporter else None,
        target_user_id=report.target_user_id,
        target_name=target.name if target else None,
        trip_id=report.trip_id,
        reason=report.reason,
        details=report.details,
        status=report.status,
        admin_note=report.admin_note,
        target_is_blocked=bool(target.is_blocked) if target else False,
        created_at=report.created_at.isoformat() if report.created_at else None,
        resolved_at=report.resolved_at.isoformat() if report.resolved_at else None,
    )


@router.get("/funnel", response_model=schemas.FunnelSummaryResponse)
def get_conversion_funnel(
    days: int = Query(7, ge=1, le=90),
    current_user: models.User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    """Return anonymized conversion funnel counts and conversion percentages."""
    return build_funnel_summary(db, days=days)
