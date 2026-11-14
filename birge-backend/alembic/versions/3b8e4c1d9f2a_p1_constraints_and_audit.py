"""P1 constraints, active-request uniqueness and audit log

Revision ID: 3b8e4c1d9f2a
Revises: 2a7c9d1b4e6f
Create Date: 2026-11-13

The data normalization below makes the constraints safe for legacy rows:
invalid seat/price/rating values are clamped and duplicate active requests
keep one request (accepted wins over pending) while the rest are declined.
"""
from alembic import op
import sqlalchemy as sa


revision = "3b8e4c1d9f2a"
down_revision = "2a7c9d1b4e6f"
branch_labels = None
depends_on = None


def _normalize_legacy_data(connection) -> None:
    connection.execute(sa.text(
        "UPDATE trips SET seats = CASE "
        "WHEN seats < 1 THEN 1 WHEN seats > 8 THEN 8 ELSE seats END "
        "WHERE seats IS NOT NULL AND (seats < 1 OR seats > 8)"
    ))
    connection.execute(sa.text(
        "UPDATE trips SET seats_taken = 0 "
        "WHERE seats_taken IS NOT NULL AND seats_taken < 0"
    ))
    connection.execute(sa.text(
        "UPDATE trips SET seats_taken = seats "
        "WHERE seats_taken IS NOT NULL AND seats IS NOT NULL AND seats_taken > seats"
    ))
    connection.execute(sa.text(
        "UPDATE trips SET price_per_seat = 0 "
        "WHERE price_per_seat IS NOT NULL AND price_per_seat < 0"
    ))
    connection.execute(sa.text(
        "UPDATE trips SET price_per_seat = 100000 "
        "WHERE price_per_seat IS NOT NULL AND price_per_seat > 100000"
    ))
    connection.execute(sa.text(
        "UPDATE reviews SET rating = 1 "
        "WHERE rating IS NOT NULL AND rating < 1"
    ))
    connection.execute(sa.text(
        "UPDATE reviews SET rating = 5 "
        "WHERE rating IS NOT NULL AND rating > 5"
    ))

    duplicates = connection.execute(sa.text(
        "SELECT trip_id, requester_id FROM trip_requests "
        "WHERE trip_id IS NOT NULL AND requester_id IS NOT NULL "
        "AND status IN ('pending', 'accepted') "
        "GROUP BY trip_id, requester_id HAVING COUNT(*) > 1"
    )).fetchall()
    for trip_id, requester_id in duplicates:
        rows = connection.execute(
            sa.text(
                "SELECT id FROM trip_requests "
                "WHERE trip_id = :trip_id AND requester_id = :requester_id "
                "AND status IN ('pending', 'accepted') "
                "ORDER BY CASE status WHEN 'accepted' THEN 0 ELSE 1 END, id"
            ),
            {"trip_id": trip_id, "requester_id": requester_id},
        ).fetchall()
        keep_id = rows[0][0]
        connection.execute(
            sa.text(
                "UPDATE trip_requests SET status = 'declined' "
                "WHERE trip_id = :trip_id AND requester_id = :requester_id "
                "AND id != :keep_id AND status IN ('pending', 'accepted')"
            ),
            {"trip_id": trip_id, "requester_id": requester_id, "keep_id": keep_id},
        )


def upgrade() -> None:
    connection = op.get_bind()
    _normalize_legacy_data(connection)

    with op.batch_alter_table("trips", schema=None) as batch_op:
        batch_op.create_check_constraint(
            "ck_trips_seats_range",
            "seats IS NULL OR (seats >= 1 AND seats <= 8)",
        )
        batch_op.create_check_constraint(
            "ck_trips_seats_taken_range",
            "seats_taken IS NULL OR seats_taken >= 0",
        )
        batch_op.create_check_constraint(
            "ck_trips_seats_taken_le_seats",
            "seats_taken IS NULL OR seats IS NULL OR seats_taken <= seats",
        )
        batch_op.create_check_constraint(
            "ck_trips_price_range",
            "price_per_seat IS NULL OR (price_per_seat >= 0 AND price_per_seat <= 100000)",
        )

    with op.batch_alter_table("reviews", schema=None) as batch_op:
        batch_op.create_check_constraint(
            "ck_reviews_rating_range",
            "rating IS NULL OR (rating >= 1 AND rating <= 5)",
        )

    op.create_index(
        "uq_trip_requests_active",
        "trip_requests",
        ["trip_id", "requester_id"],
        unique=True,
        sqlite_where=sa.text("status IN ('pending', 'accepted')"),
        postgresql_where=sa.text("status IN ('pending', 'accepted')"),
    )

    op.create_table(
        "audit_logs",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("actor_id", sa.Integer(), nullable=True),
        sa.Column("action", sa.String(), nullable=False),
        sa.Column("entity_type", sa.String(), nullable=False),
        sa.Column("entity_id", sa.Integer(), nullable=True),
        sa.Column("details", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["actor_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_audit_logs_id", "audit_logs", ["id"], unique=False)
    op.create_index(
        "ix_audit_logs_entity", "audit_logs", ["entity_type", "entity_id"], unique=False
    )
    op.create_index(
        "ix_audit_logs_actor_created", "audit_logs", ["actor_id", "created_at"], unique=False
    )


def downgrade() -> None:
    op.drop_index("ix_audit_logs_actor_created", table_name="audit_logs")
    op.drop_index("ix_audit_logs_entity", table_name="audit_logs")
    op.drop_index("ix_audit_logs_id", table_name="audit_logs")
    op.drop_table("audit_logs")

    op.drop_index("uq_trip_requests_active", table_name="trip_requests")

    with op.batch_alter_table("reviews", schema=None) as batch_op:
        batch_op.drop_constraint("ck_reviews_rating_range", type_="check")

    with op.batch_alter_table("trips", schema=None) as batch_op:
        batch_op.drop_constraint("ck_trips_price_range", type_="check")
        batch_op.drop_constraint("ck_trips_seats_taken_le_seats", type_="check")
        batch_op.drop_constraint("ck_trips_seats_taken_range", type_="check")
        batch_op.drop_constraint("ck_trips_seats_range", type_="check")
