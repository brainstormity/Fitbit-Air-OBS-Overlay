"""
Bluetooth Low Energy (BLE) Manager for Fitbit Air and standard Heart Rate monitors.
Handles scanning, direct GATT connection, auto-reconnect, and real-time telemetry dispatch.
"""

from __future__ import annotations

import asyncio
import datetime
import struct
from typing import Any, Callable, Dict, List, Optional

try:
    from bleak import BleakClient, BleakScanner
    from bleak.backends.characteristic import BleakGATTCharacteristic
    BLEAK_AVAILABLE = True
except ImportError:
    BLEAK_AVAILABLE = False

from config import current_config

HEART_RATE_SERVICE_UUID = "0000180d-0000-1000-8000-00805f9b34fb"
HEART_RATE_MEASUREMENT_UUID = "00002a37-0000-1000-8000-00805f9b34fb"

FITBIT_KEYWORDS = ["fitbit", "air", "charge", "pixel watch", "sense", "versa", "inspire", "heart"]


def parse_heart_rate_measurement(data: bytearray) -> Dict[str, Any]:
    """
    Parse standard Bluetooth SIG Heart Rate Measurement GATT characteristic (0x2A37).
    Flags (Byte 0):
      bit 0: 0 = UINT8 BPM, 1 = UINT16 BPM
      bit 1-2: Sensor contact status
      bit 3: Energy expended present
      bit 4: RR-Intervals present
    """
    flags = data[0]
    is_uint16 = bool(flags & 0x01)
    sensor_contact = (flags >> 1) & 0x03
    energy_expended_present = bool(flags & 0x08)
    rr_intervals_present = bool(flags & 0x10)

    offset = 1
    if is_uint16:
        bpm = struct.unpack_from("<H", data, offset)[0]
        offset += 2
    else:
        bpm = struct.unpack_from("<B", data, offset)[0]
        offset += 1

    energy_expended = None
    if energy_expended_present and len(data) >= offset + 2:
        energy_expended = struct.unpack_from("<H", data, offset)[0]
        offset += 2

    rr_intervals: List[float] = []
    if rr_intervals_present:
        while len(data) >= offset + 2:
            rr = struct.unpack_from("<H", data, offset)[0]
            # RR is in units of 1/1024 second, convert to milliseconds
            rr_ms = round((rr / 1024.0) * 1000.0, 1)
            rr_intervals.append(rr_ms)
            offset += 2

    return {
        "bpm": bpm,
        "sensor_contact": "Detected" if sensor_contact == 3 else ("Not Detected" if sensor_contact == 2 else "Unknown"),
        "energy_expended_kj": energy_expended,
        "rr_intervals_ms": rr_intervals,
        "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "source": "BLE_LIVE",
    }


class BleManager:
    """Manages BLE scanning, GATT connection, and telemetry dispatch."""

    def __init__(
        self,
        on_measurement: Optional[Callable[[Dict[str, Any]], Any]] = None,
        on_status_change: Optional[Callable[[Dict[str, Any]], Any]] = None,
    ):
        self.on_measurement = on_measurement
        self.on_status_change = on_status_change

        self.state: str = "disconnected"  # "disconnected" | "scanning" | "connecting" | "connected"
        self.connecting_device_name: Optional[str] = None
        self.connected_device: Optional[Dict[str, Any]] = None
        self.last_error: Optional[str] = None
        self.latest_bpm: Optional[int] = None
        self.discovered_devices: List[Dict[str, Any]] = []

        self.client: Optional[BleakClient] = None
        self._is_busy: bool = False
        self._scan_task: Optional[asyncio.Task] = None

    def get_status(self) -> Dict[str, Any]:
        """Return current status snapshot."""
        return {
            "status": self.state,
            "connecting_device": self.connecting_device_name,
            "connected_device": self.connected_device,
            "error": self.last_error,
            "latest_bpm": self.latest_bpm,
            "bleak_available": BLEAK_AVAILABLE,
            "device_count": len(self.discovered_devices),
        }

    def _notify_status(self):
        """Invoke status change callback if registered."""
        if self.on_status_change:
            try:
                res = self.on_status_change(self.get_status())
                if asyncio.iscoroutine(res):
                    asyncio.create_task(res)
            except Exception as e:
                print(f"[BleManager] Error in status callback: {e}")

    def _notify_measurement(self, record: Dict[str, Any]):
        """Invoke measurement callback."""
        self.latest_bpm = record.get("bpm")
        if self.on_measurement:
            try:
                res = self.on_measurement(record)
                if asyncio.iscoroutine(res):
                    asyncio.create_task(res)
            except Exception as e:
                print(f"[BleManager] Error in measurement callback: {e}")

    async def _discover_raw(self, timeout: float = 4.0) -> List[Dict[str, Any]]:
        """Low-level scanner discovering all devices and sorting candidates."""
        print(f"[BleManager] Discovering nearby BLE devices ({timeout}s)...")
        self._scan_task = asyncio.current_task()
        try:
            devices = await BleakScanner.discover(timeout=timeout, return_adv=True)
            results: List[Dict[str, Any]] = []

            for d, adv in devices.values():
                raw_name = d.name or adv.local_name or ""
                clean_name = raw_name.strip() or "Unnamed Device"
                uuids = [str(u).lower() for u in (adv.service_uuids or [])]
                is_hr_service = HEART_RATE_SERVICE_UUID in uuids or any("180d" in u for u in uuids)
                is_fitbit = any(k in clean_name.lower() for k in FITBIT_KEYWORDS)

                results.append({
                    "name": clean_name,
                    "address": d.address,
                    "rssi": adv.rssi,
                    "is_fitbit": is_fitbit,
                    "is_heart_rate": is_hr_service,
                })

            # Sort candidates: Fitbit/HR devices first, then highest RSSI (strongest signal)
            results.sort(
                key=lambda x: (
                    1 if (x["is_fitbit"] or x["is_heart_rate"]) else 0,
                    x["rssi"] if x["rssi"] is not None else -999,
                ),
                reverse=True,
            )

            self.discovered_devices = results
            print(f"[BleManager] Discovered {len(results)} devices.")
            return results
        except asyncio.CancelledError:
            print("[BleManager] Scan cancelled by user.")
            raise
        finally:
            self._scan_task = None

    async def stop_scan(self):
        """Cancel active scan if currently running."""
        print("[BleManager] stop_scan requested.")
        if self._scan_task and not self._scan_task.done():
            self._scan_task.cancel()
        self._is_busy = False
        self.connecting_device_name = None
        self.state = "connected" if (self.client and self.client.is_connected) else "disconnected"
        self._notify_status()

    async def scan(self, timeout: float = 4.5) -> List[Dict[str, Any]]:
        """Scan for nearby Bluetooth devices."""
        if not BLEAK_AVAILABLE:
            self.last_error = "Bleak library not available on system."
            self._notify_status()
            raise RuntimeError(self.last_error)

        if self._is_busy:
            return self.discovered_devices

        self._is_busy = True
        self.state = "scanning"
        self.last_error = None
        self._notify_status()

        try:
            results = await self._discover_raw(timeout=timeout)
            return results
        except Exception as e:
            self.last_error = f"Scan failed: {str(e)}"
            print(f"[BleManager] Scan error: {e}")
            raise
        finally:
            self._is_busy = False
            if self.state == "scanning":
                self.state = "connected" if (self.client and self.client.is_connected) else "disconnected"
            self._notify_status()

    def _on_ble_notification(self, sender: BleakGATTCharacteristic, data: bytearray):
        """GATT 0x2A37 measurement callback."""
        try:
            record = parse_heart_rate_measurement(data)
            self._notify_measurement(record)
        except Exception as e:
            print(f"[BleManager] Failed to parse heart rate data: {e}")

    def _on_client_disconnected(self, client: BleakClient):
        """Called by Bleak when connection drops."""
        print(f"[BleManager] Device disconnected: {self.connected_device}")
        self.state = "disconnected"
        dev = self.connected_device.get("name") if self.connected_device else "Device"
        self.last_error = f"{dev} disconnected."
        self.connected_device = None
        self.connecting_device_name = None
        self.latest_bpm = None
        self.client = None
        self._notify_status()

    async def connect(self, address: Optional[str] = None) -> Dict[str, Any]:
        """Connect to device by address, or auto-connect to the best discovered candidate."""
        if not BLEAK_AVAILABLE:
            raise RuntimeError("Bleak library is not installed.")

        # If already connected to target, return early
        if self.client and self.client.is_connected and self.connected_device:
            if address is None or self.connected_device.get("address") == address:
                return self.connected_device

        # Clean up any existing connection
        if self.client:
            try:
                await self.client.disconnect()
            except Exception:
                pass
            self.client = None

        self._is_busy = True
        target_address = address or current_config.fitbit_ble_address
        target_name = "Fitbit Wearable"

        try:
            # Auto-discovery if no target address passed
            if not target_address:
                self.state = "scanning"
                self.connecting_device_name = None
                self.last_error = None
                self._notify_status()

                candidates = await self._discover_raw(timeout=4.0)
                priority_candidates = [c for c in candidates if c["is_fitbit"] or c["is_heart_rate"]]

                if not priority_candidates:
                    self.state = "disconnected"
                    self.connecting_device_name = None
                    self.last_error = "No Fitbit found nearby. Ensure 'Share Heart Rate' is enabled in the Fitbit app (or start a Workout on your watch to force advertising)."
                    self._notify_status()
                    raise RuntimeError(self.last_error)

                chosen = priority_candidates[0]
                target_address = chosen["address"]
                target_name = chosen["name"]
            else:
                for d in self.discovered_devices:
                    if d.get("address") == target_address:
                        target_name = d.get("name") or target_name
                        break

            self.connecting_device_name = target_name
            self.state = "connecting"
            self.last_error = None
            self._notify_status()

            print(f"[BleManager] Connecting to '{target_name}' ({target_address})...")

            client = BleakClient(
                target_address,
                disconnected_callback=self._on_client_disconnected,
                timeout=12.0,
            )
            await client.connect()

            if not client.is_connected:
                raise RuntimeError(f"Could not establish connection to {target_name}.")

            print(f"[BleManager] Subscribing to Heart Rate Measurement ({HEART_RATE_MEASUREMENT_UUID})...")
            await client.start_notify(HEART_RATE_MEASUREMENT_UUID, self._on_ble_notification)

            self.client = client
            self.connected_device = {
                "name": target_name,
                "address": target_address,
                "connected_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            }
            self.connecting_device_name = None
            self.state = "connected"
            self.last_error = None
            print(f"[BleManager] Connected successfully to {target_name} ({target_address})!")
            self._notify_status()
            return self.connected_device

        except Exception as e:
            self.connecting_device_name = None
            self.state = "disconnected"
            self.connected_device = None
            self.client = None
            self.last_error = str(e) or f"Connection error ({type(e).__name__})"
            print(f"[BleManager] Connection error: {self.last_error}")
            self._notify_status()
            raise
        finally:
            self._is_busy = False

    async def disconnect(self):
        """Disconnect BLE device cleanly."""
        if self.client:
            print("[BleManager] Disconnecting BLE client...")
            try:
                if self.client.is_connected:
                    try:
                        await self.client.stop_notify(HEART_RATE_MEASUREMENT_UUID)
                    except Exception:
                        pass
                    await self.client.disconnect()
            except Exception as e:
                print(f"[BleManager] Disconnect error: {e}")
            finally:
                self.client = None

        self.connected_device = None
        self.connecting_device_name = None
        self.latest_bpm = None
        self.state = "disconnected"
        self.last_error = None
        self._notify_status()
