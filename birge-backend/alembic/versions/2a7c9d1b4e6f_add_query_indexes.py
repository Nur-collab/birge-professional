"""add query indexes

Revision ID: 2a7c9d1b4e6f
Revises: 1fdb9f734fe9
Create Date: 2026-11-13

"""
from alembic import op


revision = "2a7c9d1b4e6f"
down_revision = "1fdb9f734fe9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index("ix_trips_status_date_role", "trips", ["status", "date", "role"], unique=False)
    op.create_index("ix_trips_route_lookup", "trips", ["role", "origin", "destination", "date"], unique=False)
    op.create_index("ix_trips_user_status", "trips", ["user_id", "status"], unique=False)

    op.create_index("ix_trip_requests_trip_status", "trip_requests", ["trip_id", "status"], unique=False)
    op.create_index("ix_trip_requests_requester_status", "trip_requests", ["requester_id", "status"], unique=False)
    op.create_index("ix_trip_requests_driver_status", "trip_requests", ["driver_id", "status"], unique=False)

    op.create_index("ix_chat_messages_trip_id_id", "chat_messages", ["trip_id", "id"], unique=False)
    op.create_index("ix_reviews_user_author", "reviews", ["user_id", "author_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_reviews_user_author", table_name="reviews")
    op.drop_index("ix_chat_messages_trip_id_id", table_name="chat_messages")
    op.drop_index("ix_trip_requests_driver_status", table_name="trip_requests")
    op.drop_index("ix_trip_requests_requester_status", table_name="trip_requests")
    op.drop_index("ix_trip_requests_trip_status", table_name="trip_requests")
    op.drop_index("ix_trips_user_status", table_name="trips")
    op.drop_index("ix_trips_route_lookup", table_name="trips")
    op.drop_index("ix_trips_status_date_role", table_name="trips")
