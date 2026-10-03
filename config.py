"""
Configuration for Fitbit Air OBS Heart Rate Overlay.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Optional
from pydantic import BaseModel

BASE_DIR = Path(__file__).resolve().parent

HOST = "0.0.0.0"
PORT = 8000


class AppConfig(BaseModel):
    host: str = os.getenv("HOST", HOST)
    port: int = int(os.getenv("PORT", str(PORT)))
    fitbit_ble_address: Optional[str] = os.getenv("FITBIT_BLE_ADDRESS", None)


current_config = AppConfig()
