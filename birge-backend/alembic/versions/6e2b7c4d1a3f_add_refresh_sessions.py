"""Add refresh sessions for refresh-token rotation

Revision ID: 6e2b7c4d1a3f
Revises: 5c8f1a2b9d4e
Create Date: 2026-11-16
"""
from alembic import op
import sqlalchemy as sa


revision = "6e2b7c4d1a3f"
down_revision = "5c8f1a2b9d4e"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "refresh_sessions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("jti_hash", sa.String(length=64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_refresh_sessions_id", "refresh_sessions", ["id"])
    op.create_index("ix_refresh_sessions_user_id", "refresh_sessions", ["user_id"])
    op.create_index(
        "ix_refresh_sessions_jti_hash",
        "refresh_sessions",
        ["jti_hash"],
        unique=True,
    )
    op.create_index(
        "ix_refresh_sessions_user_revoked",
        "refresh_sessions",
        ["user_id", "revoked_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_refresh_sessions_user_revoked", table_name="refresh_sessions")
    op.drop_index("ix_refresh_sessions_jti_hash", table_name="refresh_sessions")
    op.drop_index("ix_refresh_sessions_user_id", table_name="refresh_sessions")
    op.drop_index("ix_refresh_sessions_id", table_name="refresh_sessions")
    op.drop_table("refresh_sessions")
