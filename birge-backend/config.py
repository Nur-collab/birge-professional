"""Shared runtime configuration flags.

Environment values are loaded here first so every module sees the same
production flag regardless of import order.
"""
import os

from dotenv import load_dotenv

load_dotenv()

IS_PRODUCTION = bool(os.environ.get("RENDER")) or os.environ.get("ENVIRONMENT", "").lower() == "production"
