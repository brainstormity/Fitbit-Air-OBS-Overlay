"""
Direct Bluetooth Low Energy (BLE) Heart Rate Listener for Fitbit Air.
Connects directly to the wearable via GATT Heart Rate Service (0x180D) and
receives 1 Hz live Heart Rate Measurement notifications (0x2A37) with zero cloud latency.
"""

from __future__ import annotations

import argparse
import asyncio
import datetime
import struct
from typing import Callable, Optional
import httpx

try:
    from bleak import BleakClient, BleakScanner
    from bleak.backends.characteristic import BleakGATTCharacteristic
    from bleak.backends.device import BLEDevice
except ImportError:
    print("Warning: 'bleak' is not installed. Run 'pip install bleak' to enable direct BLE scanning.")

from config import current_config

HEART_RATE_SERVICE_UUID = "0000180d-0000-1000-8000-00805f9b34fb"
HEART_RATE_MEASUREMENT_UUID = "00002a37-0000-1000-8000-00805f9b34fb"


def parse_heart_rate_measurement(data: bytearray) -> dict:
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

    rr_intervals = []
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
    }


class FitbitBleListener:
    def __init__(
        self,
        device_address_or_name: Optional[str] = None,
        callback: Optional[Callable[[dict], None]] = None,
        forward_to_server_url: Optional[str] = "http://127.0.0.1:8000/api/ble/measurement",
    ):
        self.target = device_address_or_name or current_config.fitbit_ble_address
        self.callback = callback
        self.forward_url = forward_to_server_url
        self.client: Optional[BleakClient] = None
        self.is_running = False
        self._http_client: Optional[httpx.AsyncClient] = None

    async def scan_for_heart_rate_devices(self, timeout: float = 6.0) -> list[BLEDevice]:
        """Scan for devices advertising the Heart Rate Service or Fitbit names."""
        print(f"\n[BLE] Scanning for Fitbit and Heart Rate devices ({timeout}s)...")
        devices = await BleakScanner.discover(timeout=timeout, return_adv=True)
        hr_devices = []

        for d, adv in devices.values():
            name = d.name or adv.local_name or "Unknown"
            uuids = [str(u).lower() for u in (adv.service_uuids or [])]
            is_hr_service = HEART_RATE_SERVICE_UUID in uuids or "180d" in "".join(uuids)
            is_fitbit_name = any(k in name.lower() for k in ["fitbit", "air", "charge", "pixel watch", "heart"])

            if is_hr_service or is_fitbit_name:
                hr_devices.append(d)
                print(f" -> Found Candidate: '{name}' | Address: {d.address} | RSSI: {adv.rssi} dBm")

        if not hr_devices:
            print(" -> No specific heart rate devices matched filter. All discovered devices:")
            for d, adv in devices.values():
                if d.name:
                    print(f"    - {d.name} ({d.address})")

        return hr_devices

    def _notification_handler(self, sender: BleakGATTCharacteristic, data: bytearray):
        """Called when a 0x2A37 Heart Rate Measurement notification arrives."""
        parsed = parse_heart_rate_measurement(data)
        bpm = parsed["bpm"]
        rr = f" | RR: {parsed['rr_intervals_ms']} ms" if parsed["rr_intervals_ms"] else ""
        print(f"[BLE LIVE] ❤️  BPM: {bpm:3d}{rr} | Time: {parsed['timestamp']}")

        if self.callback:
            self.callback(parsed)

        if self.forward_url:
            asyncio.create_task(self._forward_measurement(parsed))

    async def _forward_measurement(self, payload: dict):
        """Forward measurement to local FastAPI dashboard server."""
        try:
            if self._http_client is None:
                self._http_client = httpx.AsyncClient(timeout=3.0)
            await self._http_client.post(self.forward_url, json=payload)
        except Exception:
            pass  # Non-blocking

    async def start(self, address: Optional[str] = None):
        """Connect to device and subscribe to 1 Hz live heart rate stream."""
        target_addr = address or self.target

        if not target_addr:
            candidates = await self.scan_for_heart_rate_devices(timeout=5.0)
            if not candidates:
                print("[BLE] No compatible heart rate device found nearby.")
                return
            target_addr = candidates[0].address
            print(f"[BLE] Selecting first candidate: {candidates[0].name or target_addr}")

        self.is_running = True
        print(f"[BLE] Connecting to {target_addr}...")

        while self.is_running:
            try:
                async with BleakClient(target_addr, timeout=12.0) as client:
                    self.client = client
                    print(f"[BLE] Connected successfully to {target_addr}!")
                    print("[BLE] Subscribing to Heart Rate Measurement (0x2A37)...")

                    await client.start_notify(HEART_RATE_MEASUREMENT_UUID, self._notification_handler)
                    print("[BLE] Listening for 1 Hz live heart rate stream (Press Ctrl+C to stop)...")

                    while self.is_running and client.is_connected:
                        await asyncio.sleep(1.0)

            except asyncio.CancelledError:
                break
            except Exception as e:
                print(f"[BLE] Connection error: {e}")
                if self.is_running:
                    print("[BLE] Retrying in 5 seconds...")
                    await asyncio.sleep(5.0)

        print("[BLE] Listener stopped.")

    async def stop(self):
        self.is_running = False
        if self.client and self.client.is_connected:
            await self.client.disconnect()
        if self._http_client:
            await self._http_client.aclose()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Fitbit Air BLE Heart Rate Listener")
    parser.add_argument("--scan", action="store_true", help="Scan for nearby BLE heart rate devices")
    parser.add_argument("--address", type=str, help="BLE Device MAC / UUID address to connect")
    args = parser.parse_args()

    listener = FitbitBleListener(device_address_or_name=args.address)

    if args.scan:
        asyncio.run(listener.scan_for_heart_rate_devices(timeout=6.0))
    else:
        try:
            asyncio.run(listener.start(args.address))
        except KeyboardInterrupt:
            print("\nExiting...")
