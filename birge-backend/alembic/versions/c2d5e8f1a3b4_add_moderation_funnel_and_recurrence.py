"""Add moderation reports, funnel events, late cancellation counter, and recurring trips

Revision ID: c2d5e8f1a3b4
Revises: b1e4c9d2a6f0
Create Date: 2026-11-27
"""
from alembic import op
import sqlalchemy as sa


revision = "c2d5e8f1a3b4"
down_revision = "b1e4c9d2a6f0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("is_blocked", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "users",
        sa.Column("late_cancellations", sa.Integer(), nullable=False, server_default=sa.text("0")),
    )
    op.add_column(
        "trips",
        sa.Column("recurrence_days", sa.String(length=40), nullable=True),
    )

    op.create_table(
        "abuse_reports",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("reporter_id", sa.Integer(), nullable=True),
        sa.Column("target_user_id", sa.Integer(), nullable=False),
        sa.Column("trip_id", sa.Integer(), nullable=True),
        sa.Column("reason", sa.String(length=40), nullable=False),
        sa.Column("details", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False, server_default=sa.text("'open'")),
        sa.Column("admin_note", sa.Text(), nullable=True),
        sa.Column("reviewed_by", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("resolved_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["reporter_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["reviewed_by"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["target_user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["trip_id"], ["trips.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_abuse_reports_id", "abuse_reports", ["id"])
    op.create_index("ix_abuse_reports_reporter_id", "abuse_reports", ["reporter_id"])
    op.create_index("ix_abuse_reports_target_user_id", "abuse_reports", ["target_user_id"])
    op.create_index("ix_abuse_reports_trip_id", "abuse_reports", ["trip_id"])
    op.create_index("ix_abuse_reports_status_created", "abuse_reports", ["status", "created_at"])

    op.create_table(
        "funnel_events",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("stage", sa.String(length=40), nullable=False),
        sa.Column("role", sa.String(length=20), nullable=True),
        sa.Column("actor_hash", sa.String(length=32), nullable=True),
        sa.Column("day", sa.String(length=10), nullable=False),
        sa.Column("meta", sa.String(length=80), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_funnel_events_id", "funnel_events", ["id"])
    op.create_index("ix_funnel_events_stage", "funnel_events", ["stage"])
    op.create_index("ix_funnel_events_actor_hash", "funnel_events", ["actor_hash"])
    op.create_index("ix_funnel_events_day", "funnel_events", ["day"])
    op.create_index("ix_funnel_events_day_stage", "funnel_events", ["day", "stage"])


def downgrade() -> None:
    op.drop_index("ix_funnel_events_day_stage", table_name="funnel_events")
    op.drop_index("ix_funnel_events_day", table_name="funnel_events")
    op.drop_index("ix_funnel_events_actor_hash", table_name="funnel_events")
    op.drop_index("ix_funnel_events_stage", table_name="funnel_events")
    op.drop_index("ix_funnel_events_id", table_name="funnel_events")
    op.drop_table("funnel_events")

    op.drop_index("ix_abuse_reports_status_created", table_name="abuse_reports")
    op.drop_index("ix_abuse_reports_trip_id", table_name="abuse_reports")
    op.drop_index("ix_abuse_reports_target_user_id", table_name="abuse_reports")
    op.drop_index("ix_abuse_reports_reporter_id", table_name="abuse_reports")
    op.drop_index("ix_abuse_reports_id", table_name="abuse_reports")
    op.drop_table("abuse_reports")

    with op.batch_alter_table("trips", schema=None) as batch_op:
        batch_op.drop_column("recurrence_days")

    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.drop_column("late_cancellations")
        batch_op.drop_column("is_blocked")
