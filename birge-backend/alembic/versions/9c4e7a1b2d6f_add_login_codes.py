"""Add one-time login exchange codes

Revision ID: 9c4e7a1b2d6f
Revises: 8d2f4a6b1c3e
Create Date: 2026-11-23
"""
from alembic import op
import sqlalchemy as sa


revision = "9c4e7a1b2d6f"
down_revision = "8d2f4a6b1c3e"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "login_codes",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("code_hash", sa.String(length=64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_login_codes_id", "login_codes", ["id"])
    op.create_index("ix_login_codes_user_id", "login_codes", ["user_id"])
    op.create_index("ix_login_codes_code_hash", "login_codes", ["code_hash"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_login_codes_code_hash", table_name="login_codes")
    op.drop_index("ix_login_codes_user_id", table_name="login_codes")
    op.drop_index("ix_login_codes_id", table_name="login_codes")
    op.drop_table("login_codes")
