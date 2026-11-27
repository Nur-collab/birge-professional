"""Add optional route coordinates to trips

Revision ID: b1e4c9d2a6f0
Revises: a7f1c3e8b9d2
Create Date: 2026-11-27
"""
from alembic import op
import sqlalchemy as sa


revision = "b1e4c9d2a6f0"
down_revision = "a7f1c3e8b9d2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("trips", sa.Column("origin_lat", sa.Float(), nullable=True))
    op.add_column("trips", sa.Column("origin_lng", sa.Float(), nullable=True))
    op.add_column("trips", sa.Column("dest_lat", sa.Float(), nullable=True))
    op.add_column("trips", sa.Column("dest_lng", sa.Float(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("trips", schema=None) as batch_op:
        batch_op.drop_column("dest_lng")
        batch_op.drop_column("dest_lat")
        batch_op.drop_column("origin_lng")
        batch_op.drop_column("origin_lat")
