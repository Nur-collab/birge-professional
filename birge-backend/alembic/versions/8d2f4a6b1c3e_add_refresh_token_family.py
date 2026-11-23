"""Track refresh-token families for reuse detection

Revision ID: 8d2f4a6b1c3e
Revises: 6e2b7c4d1a3f
Create Date: 2026-11-23
"""
from alembic import op
import sqlalchemy as sa


revision = "8d2f4a6b1c3e"
down_revision = "6e2b7c4d1a3f"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "refresh_sessions",
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "refresh_sessions",
        sa.Column("family_id", sa.String(length=32), nullable=True),
    )
    op.create_index(
        "ix_refresh_sessions_family_id",
        "refresh_sessions",
        ["family_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_refresh_sessions_family_id", table_name="refresh_sessions")
    op.drop_column("refresh_sessions", "family_id")
    op.drop_column("refresh_sessions", "used_at")
