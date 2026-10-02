# 💓 Fitbit Air OBS Heart Rate Overlay

[![Python 3.10+](https://img.shields.io/badge/python-3.10+-blue.svg)](https://www.python.org/downloads/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115+-009688.svg)](https://fastapi.tiangolo.com)
[![OBS Studio](https://img.shields.io/badge/OBS-Browser%20Source-purple.svg)](https://obsproject.com)

A lightweight, zero-cloud real-time heart rate overlay for **OBS Studio** that streams live 1 Hz heart rate telemetry directly from your **Google Fitbit Air** (and other BLE wearables) over Bluetooth Low Energy.

No Google Cloud API keys, no OAuth consent screens, no cloud lag. Pure local Bluetooth.

![Fitbit Air OBS Overlay](static/bpm-tracker.png)

---

## ✨ Features

- **⚡ Real-Time 1 Hz Telemetry**: Updates every 1 second straight from your wrist sensor.
- **🎨 Streamer-Ready Transparent Overlay**: Glassmorphism pill, animated beating heart synchronized to your actual BPM, real-time mini ECG waveform, and auto-colored training zones.
- **🎛️ Zero Config / Highly Customizable**: Switch between minimalist, pill, card, or custom sizes via simple URL parameters.

---

## 🚀 Quick Start (One Command)

### 1. Enable Heart Rate Sharing on Phone
In the **Google Health / Fitbit app** on your phone:
- Go to your **Fitbit Air Settings**
- Turn ON **"Share Heart Rate"**
- Wear your watch snugly on your wrist (or start a workout on watch).

### 2. Start the Server
```bash
# Install dependencies
pip install -r requirements.txt

# Start the application
python3 server.py
```

### 3. Connect via Web Control Dashboard
Open your web browser and go to:
👉 **[http://127.0.0.1:8000/](http://127.0.0.1:8000/)**

Click **"⚡ Auto-Connect to Fitbit"** to pair automatically, or click **"🔍 Scan Devices"** to select your wearable.

### 4. Add to OBS Studio
1. In OBS Studio, add a new **Browser Source** under your Sources list.
2. Enter your chosen overlay URL:
   ```
   http://127.0.0.1:8000/overlay
   ```
3. Set **Width: 400**, **Height: 120**.
4. Click **OK** and position the transparent widget anywhere on your stream!

---

## 🎨 Visual Customizations (URL Parameters)

You can select style presets directly in the Web Control Center or customize the URL in OBS:

| Style | OBS Browser Source URL | Preview |
|---|---|---|
| **Default Pill** | `http://127.0.0.1:8000/overlay` | Frosted pill with pulsing heart, live BPM, zone badge, and mini ECG wave. |
| **Minimalist** | `http://127.0.0.1:8000/overlay?layout=minimal` | **No background box** — just the glowing beating heart and bold BPM numbers. |
| **No ECG Wave** | `http://127.0.0.1:8000/overlay?wave=0` | Hides the mini ECG wave to save horizontal space. |
| **No Zone Pill** | `http://127.0.0.1:8000/overlay?zone=0` | Hides the heart rate zone badge. |
| **Transparent** | `http://127.0.0.1:8000/overlay?bg=transparent` | 100% transparent borderless container. |
| **Large Size** | `http://127.0.0.1:8000/overlay?size=lg` | Larger widget (set OBS Width to `480`, Height to `150`). |

Combine parameters freely! (e.g., `http://127.0.0.1:8000/overlay?layout=minimal&size=lg`)

---

## 💻 Optional CLI Commands (Headless / Advanced)

If you prefer headless terminal automation instead of the Web UI, `ble_listener.py` is still available:

```bash
# Scan for nearby BLE heart rate devices and print their addresses
python3 ble_listener.py --scan

# Auto-connect to the first discovered Fitbit
python3 ble_listener.py

# Connect to a specific device address
python3 ble_listener.py --address "YOUR-DEVICE-UUID-OR-MAC"
```

---

## ❓ Troubleshooting

- **Device not found during scan?**
  Make sure "Share Heart Rate" is enabled in your Fitbit app. If needed, start any exercise session (e.g., "Workout") on the Fitbit, which forces active Bluetooth advertising.
- **Mac asks for Bluetooth permission?**
  Ensure Terminal / your IDE has Bluetooth permission under **macOS System Settings > Privacy & Security > Bluetooth**.
- **Can other wearables work?**
  Yes! Any wearable or chest strap that supports standard Bluetooth Low Energy GATT Heart Rate Service (`0x180D`, such as Pixel Watch, Polar H10, Garmin, etc.) will work out of the box.

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
