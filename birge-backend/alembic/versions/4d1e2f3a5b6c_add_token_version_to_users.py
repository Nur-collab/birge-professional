"""Add token_version to users for session revocation

Revision ID: 4d1e2f3a5b6c
Revises: 3b8e4c1d9f2a
Create Date: 2026-11-15
"""
from alembic import op
import sqlalchemy as sa


revision = "4d1e2f3a5b6c"
down_revision = "3b8e4c1d9f2a"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "token_version",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("0"),
        ),
    )


def downgrade() -> None:
    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.drop_column("token_version")
