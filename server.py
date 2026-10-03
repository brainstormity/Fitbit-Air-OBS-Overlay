"""
Lightweight FastAPI Server for Fitbit Air OBS Heart Rate Overlay.
Features integrated Web UI Control Dashboard at /, live OBS overlay at /overlay,
and direct Bluetooth Low Energy (BLE) scanning and connection manager.
"""

from __future__ import annotations

from contextlib import asynccontextmanager
import datetime
import socket
from typing import Any, Dict, List, Optional, Set

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from config import BASE_DIR, current_config
from ble_manager import BleManager, ScanCancelled

STATIC_DIR = BASE_DIR / "static"
OVERLAY_HTML = STATIC_DIR / "overlay.html"
DASHBOARD_HTML = STATIC_DIR / "dashboard.html"


def get_local_ip() -> str:
    """Detect LAN IP address for multi-PC streaming setups."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            # UDP connect sends no packets; it just picks the outbound interface.
            s.connect(("8.8.8.8", 80))
            return s.getsockname()[0]
    except Exception:
        return "127.0.0.1"


class ConnectionManager:
    def __init__(self):
        self.active_connections: Set[WebSocket] = set()

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.add(websocket)

    def disconnect(self, websocket: WebSocket):
        self.active_connections.discard(websocket)

    async def broadcast(self, message: Dict[str, Any]):
        for conn in list(self.active_connections):
            try:
                await conn.send_json(message)
            except Exception:
                self.disconnect(conn)


manager = ConnectionManager()
latest_measurement: Optional[Dict[str, Any]] = None


async def handle_ble_measurement(record: Dict[str, Any]):
    """Callback triggered whenever a new heart rate measurement arrives from BLE or simulation."""
    global latest_measurement
    latest_measurement = record
    await manager.broadcast({
        "type": "measurement",
        "data": record,
    })


async def handle_ble_status_change(status_info: Dict[str, Any]):
    """Callback triggered whenever BLE connection state changes."""
    global latest_measurement
    if status_info.get("status") != "connected":
        latest_measurement = None
    await manager.broadcast({
        "type": "ble_status",
        "data": status_info,
    })


ble_manager = BleManager(
    on_measurement=handle_ble_measurement,
    on_status_change=handle_ble_status_change,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    port = current_config.port
    local_ip = get_local_ip()
    print("\n" + "=" * 55)
    print(" ❤️  Fitbit Air OBS Heart Rate Overlay Server Ready!")
    print(f" • Control Dashboard: http://localhost:{port}/")
    print(f" • OBS Overlay URL:   http://localhost:{port}/overlay")
    if local_ip not in ("127.0.0.1", "localhost"):
        print(f" • 2nd PC / Network:  http://{local_ip}:{port}/overlay")
    print("=" * 55 + "\n")
    yield
    print("[Server] Shutting down BLE client...")
    await ble_manager.disconnect()


app = FastAPI(title="Fitbit Air OBS Overlay", lifespan=lifespan)


@app.websocket("/ws/live")
async def websocket_live_endpoint(websocket: WebSocket):
    """Real-time WebSocket endpoint for both OBS Browser Sources and Web Dashboard."""
    await manager.connect(websocket)
    try:
        await websocket.send_json({
            "type": "init",
            "latest": latest_measurement,
            "ble_status": ble_manager.get_status(),
            "active_sources": len(manager.active_connections),
        })
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception:
        manager.disconnect(websocket)


# -----------------------------------------------------------------------------
# REST API Endpoints for BLE Control & Telemetry
# -----------------------------------------------------------------------------

class BleMeasurementRequest(BaseModel):
    bpm: int = Field(ge=0, le=300)
    sensor_contact: Optional[str] = "Detected"
    energy_expended_kj: Optional[int] = None
    rr_intervals_ms: Optional[List[float]] = None
    timestamp: Optional[str] = None


@app.post("/api/ble/measurement")
async def receive_ble_measurement(payload: BleMeasurementRequest):
    """Ingest live heart rate from external scripts (backward compatibility)."""
    global latest_measurement
    ts = payload.timestamp or datetime.datetime.now(datetime.timezone.utc).isoformat()
    record = {
        "bpm": payload.bpm,
        "source": "BLE_LIVE",
        "timestamp": ts,
        "sensor_contact": payload.sensor_contact,
        "rr_intervals_ms": payload.rr_intervals_ms or [],
    }
    await handle_ble_measurement(record)
    return {"status": "ok"}


class BleScanRequest(BaseModel):
    timeout: Optional[float] = 5.0


@app.post("/api/ble/scan")
async def ble_scan_endpoint(req: BleScanRequest = BleScanRequest()):
    """Scan for nearby Bluetooth devices advertising Heart Rate Service or Fitbit."""
    try:
        devices = await ble_manager.scan(timeout=req.timeout or 5.0)
        return {"status": "ok", "devices": devices}
    except ScanCancelled:
        return {"status": "cancelled"}
    except Exception as e:
        return {"status": "error", "message": str(e)}


@app.post("/api/ble/stop-scan")
async def ble_stop_scan_endpoint():
    """Cancel active scan if currently running."""
    await ble_manager.stop_scan()
    return {"status": "ok"}


class BleConnectRequest(BaseModel):
    address: Optional[str] = None


@app.post("/api/ble/connect")
async def ble_connect_endpoint(req: BleConnectRequest = BleConnectRequest()):
    """Connect to a specific BLE address or auto-connect to the best candidate."""
    try:
        device = await ble_manager.connect(address=req.address)
        return {"status": "ok", "device": device}
    except ScanCancelled:
        return {"status": "cancelled"}
    except Exception as e:
        return {"status": "error", "message": str(e)}


@app.post("/api/ble/disconnect")
async def ble_disconnect_endpoint():
    """Disconnect active BLE connection."""
    global latest_measurement
    latest_measurement = None
    await ble_manager.disconnect()
    return {"status": "ok"}


@app.get("/api/ble/status")
async def ble_status_endpoint():
    """Get current BLE connection state and latest reading."""
    return ble_manager.get_status()


@app.get("/api/status")
async def get_status():
    """Health and status endpoint with host network info."""
    return {
        "status": "online",
        "latest_measurement": latest_measurement,
        "active_obs_sources": len(manager.active_connections),
        "ble": ble_manager.get_status(),
        "local_ip": get_local_ip(),
        "port": current_config.port,
    }


# -----------------------------------------------------------------------------
# Static and HTML Routes
# -----------------------------------------------------------------------------

app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


@app.get("/")
@app.get("/dashboard")
async def get_dashboard():
    """Serve the Web UI Control Dashboard."""
    if not DASHBOARD_HTML.exists():
        # Fallback to overlay if dashboard not yet created
        if OVERLAY_HTML.exists():
            with open(OVERLAY_HTML, "r", encoding="utf-8") as f:
                return HTMLResponse(content=f.read())
        return HTMLResponse("<h1>dashboard.html not found</h1>", status_code=404)
    with open(DASHBOARD_HTML, "r", encoding="utf-8") as f:
        html = f.read()
    return HTMLResponse(content=html)


@app.get("/overlay")
@app.get("/overlay.html")
async def get_overlay():
    """Serve the transparent OBS overlay."""
    if not OVERLAY_HTML.exists():
        return HTMLResponse("<h1>overlay.html not found</h1>", status_code=404)
    with open(OVERLAY_HTML, "r", encoding="utf-8") as f:
        html = f.read()
    return HTMLResponse(content=html)


if __name__ == "__main__":
    import uvicorn
    # No auto-reload: a reload restarts the process and drops the live BLE connection.
    uvicorn.run(app, host=current_config.host, port=current_config.port)
