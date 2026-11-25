"""Review routes."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

import models
import schemas
from database import get_db
from dependencies import get_current_user
from rate_limit import enforce_user_limit_sync
from realtime import is_trip_participant

router = APIRouter(tags=["reviews"])


@router.post("/reviews/", response_model=schemas.Review)
def create_review(
    review: schemas.ReviewCreate,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Сохраняет отзыв о пользователе после завершённой совместной поездки."""
    enforce_user_limit_sync(current_user.id, "review.create", 10, 3600)
    if review.user_id == current_user.id:
        raise HTTPException(status_code=400, detail="Cannot review yourself")

    user = db.query(models.User).filter(models.User.id == review.user_id).with_for_update().first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    joint_query = db.query(models.TripRequest).filter(
        (
            (models.TripRequest.requester_id == current_user.id)
            & (models.TripRequest.driver_id == review.user_id)
        )
        | (
            (models.TripRequest.requester_id == review.user_id)
            & (models.TripRequest.driver_id == current_user.id)
        )
    )

    if review.trip_id:
        trip = db.query(models.Trip).filter(models.Trip.id == review.trip_id).first()
        if not trip:
            raise HTTPException(status_code=404, detail="Trip not found")
        if not is_trip_participant(db, review.trip_id, current_user.id) or not is_trip_participant(
            db, review.trip_id, review.user_id
        ):
            raise HTTPException(
                status_code=403,
                detail="Отзыв можно оставить только после совместной поездки",
            )

        joint = joint_query.filter(
            models.TripRequest.trip_id == review.trip_id,
            models.TripRequest.status == "completed",
        ).first()
        if not joint and trip.status != "completed":
            raise HTTPException(
                status_code=403,
                detail="Отзыв можно оставить только после завершённой поездки",
            )
    else:
        joint = joint_query.filter(models.TripRequest.status == "completed").first()
        if not joint:
            raise HTTPException(
                status_code=403,
                detail="Отзыв можно оставить только после завершённой поездки",
            )

    query = db.query(models.Review).filter(
        models.Review.user_id == review.user_id,
        (models.Review.author_id == current_user.id)
        | (models.Review.author_id.is_(None) & (models.Review.author_name == current_user.name)),
    )
    if review.trip_id:
        query = query.filter(models.Review.trip_id == review.trip_id)
    if query.first():
        raise HTTPException(status_code=409, detail="You have already reviewed this user")

    new_review = models.Review(
        user_id=review.user_id,
        author_id=current_user.id,
        author_name=current_user.name,
        trip_id=review.trip_id,
        text=review.text,
        rating=review.rating,
    )
    db.add(new_review)

    all_reviews = db.query(models.Review).filter(models.Review.user_id == review.user_id).all()
    total_rating = sum((r.rating or 0) for r in all_reviews) + review.rating
    count = len(all_reviews) + 1
    user.trust_rating = int(total_rating * 10 / count) / 10.0

    db.commit()
    db.refresh(new_review)
    return new_review
