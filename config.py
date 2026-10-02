"""
Configuration for Fitbit Air OBS Heart Rate Overlay.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Optional
from dotenv import load_dotenv
from pydantic import BaseModel

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")


class AppConfig(BaseModel):
    host: str = os.getenv("HOST", "0.0.0.0")
    port: int = int(os.getenv("PORT", "8000"))
    fitbit_ble_address: Optional[str] = os.getenv("FITBIT_BLE_ADDRESS", None)


current_config = AppConfig()
