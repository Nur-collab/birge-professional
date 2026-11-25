"""Add browser-bound Telegram auth challenges

Revision ID: a7f1c3e8b9d2
Revises: 9c4e7a1b2d6f
Create Date: 2026-11-25
"""
from alembic import op
import sqlalchemy as sa


revision = "a7f1c3e8b9d2"
down_revision = "9c4e7a1b2d6f"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "telegram_auth_challenges",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("challenge_hash", sa.String(length=64), nullable=False),
        sa.Column("verifier_hash", sa.String(length=64), nullable=False),
        sa.Column("chat_id", sa.BigInteger(), nullable=True),
        sa.Column("phone_e164", sa.String(length=24), nullable=True),
        sa.Column("phone_formatted", sa.String(length=32), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("verified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_telegram_auth_challenges_id", "telegram_auth_challenges", ["id"])
    op.create_index(
        "ix_telegram_auth_challenges_challenge_hash",
        "telegram_auth_challenges",
        ["challenge_hash"],
        unique=True,
    )
    op.create_index("ix_telegram_auth_challenges_chat_id", "telegram_auth_challenges", ["chat_id"])
    op.create_index(
        "ix_tg_auth_challenges_chat_status",
        "telegram_auth_challenges",
        ["chat_id", "status"],
    )


def downgrade() -> None:
    op.drop_index("ix_tg_auth_challenges_chat_status", table_name="telegram_auth_challenges")
    op.drop_index("ix_telegram_auth_challenges_chat_id", table_name="telegram_auth_challenges")
    op.drop_index("ix_telegram_auth_challenges_challenge_hash", table_name="telegram_auth_challenges")
    op.drop_index("ix_telegram_auth_challenges_id", table_name="telegram_auth_challenges")
    op.drop_table("telegram_auth_challenges")
