"""Encrypt payment PII and invalidate legacy plaintext OTP codes

Revision ID: 5c8f1a2b9d4e
Revises: 4d1e2f3a5b6c
Create Date: 2026-11-16
"""
from alembic import op
import sqlalchemy as sa

from pii_crypto import decrypt_if_needed, encrypt_if_needed


revision = "5c8f1a2b9d4e"
down_revision = "4d1e2f3a5b6c"
branch_labels = None
depends_on = None


def _update_user_payment_fields(connection, *, encrypt: bool) -> None:
    rows = connection.execute(
        sa.text("SELECT id, mbank_phone, elkart_number FROM users")
    ).mappings().all()
    transform = encrypt_if_needed if encrypt else decrypt_if_needed
    for row in rows:
        new_mbank = transform(row["mbank_phone"])
        new_elkart = transform(row["elkart_number"])
        if new_mbank == row["mbank_phone"] and new_elkart == row["elkart_number"]:
            continue
        connection.execute(
            sa.text(
                "UPDATE users SET mbank_phone = :mbank_phone, "
                "elkart_number = :elkart_number WHERE id = :user_id"
            ),
            {
                "mbank_phone": new_mbank,
                "elkart_number": new_elkart,
                "user_id": row["id"],
            },
        )


def upgrade() -> None:
    connection = op.get_bind()
    _update_user_payment_fields(connection, encrypt=True)
    # Codes written before OTP hashing cannot be verified safely. Force every
    # outstanding login code to be requested again instead of leaving plaintext.
    connection.execute(sa.text("UPDATE sms_codes SET code = ''"))


def downgrade() -> None:
    connection = op.get_bind()
    _update_user_payment_fields(connection, encrypt=False)
    connection.execute(sa.text("UPDATE sms_codes SET code = ''"))
