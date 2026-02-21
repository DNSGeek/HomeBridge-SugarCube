# homebridge-sugarcube

A [HomeBridge](https://homebridge.io) plugin for [SweetVinyl SugarCube](https://sweetvinyl.com/sugarcube/) vinyl restoration devices. Control click repair, noise reduction, and recording from the Home app, Siri, and Shortcuts.

## HomeKit Accessories

Each SugarCube device exposes six accessories in HomeKit:

| Accessory | Type | Description |
|-----------|------|-------------|
| **Click Repair** | Switch | Turn click repair on or off |
| **Repair Sensitivity** | Light | Brightness slider controls sensitivity level 1–10 |
| **Noise Reduction** | Switch | Turn noise reduction on or off |
| **Denoise Level** | Light | Brightness slider controls denoise level 1–10 |
| **Recording** | Switch | Start or stop recording |
| **Clipping** | Motion Sensor | Triggers when clipping is detected |

> **Why lights for the sliders?** HomeKit does not have a generic 1–10 slider accessory type. The Lightbulb's Brightness characteristic is the standard workaround — you'll see a slider in the Home app. The light's on/off state mirrors the corresponding switch, so they stay in sync.

---

## Requirements

- HomeBridge 1.6.0 or later
- Node.js 18 or later
- SugarCube device on the same local network

---

## Installation

### Via HomeBridge UI (recommended)

Search for `homebridge-sugarcube` in the HomeBridge plugin search and click **Install**.

### Manual

```bash
npm install -g homebridge-sugarcube
```

---

## Configuration

Add the platform to your HomeBridge `config.json`, or use the **Settings** UI in the HomeBridge web interface.

```json
{
  "platforms": [
    {
      "platform": "SugarCube",
      "name": "SugarCube",
      "devices": [
        {
          "name": "Living Room SugarCube",
          "url": "http://10.10.0.168",
          "pin": "1111",
          "pollInterval": 10,
          "timeout": 10
        },
        {
          "name": "Studio SugarCube",
          "url": "http://10.10.0.169",
          "pin": "2222"
        }
      ]
    }
  ]
}
```

### Device options

| Option | Required | Default | Description |
|--------|----------|---------|-------------|
| `name` | Yes | — | Display name shown in the Home app |
| `url` | Yes | — | Device IP address, e.g. `http://10.10.0.168`. Port 5123 is added automatically if omitted. |
| `pin` | First run only | — | 4-digit PIN shown on the device display. After the first successful pairing the session cookie is saved automatically and the PIN is no longer needed. |
| `pollInterval` | No | `10` | How often (in seconds) to poll the device for status updates. Minimum 5. |
| `timeout` | No | `10` | HTTP request timeout in seconds. |

---

## Authentication

On first run the plugin authenticates using the first method that succeeds:

1. **Saved cookie** — a session cookie stored from a previous pairing (in the accessory's persistent context). This is the normal path on all runs after the first.
2. **Auto-pair** — attempted first, works if the device is configured to allow it.
3. **PIN pairing** — uses the `pin` field from the device config.

Once paired, the session cookie is stored in HomeBridge's accessory context and survives restarts. You can remove the `pin` from the config after the first successful pairing if you prefer not to store it.

---

## Siri Examples

Once accessories are added to a room in the Home app, you can use Siri:

- *"Hey Siri, turn on Click Repair"*
- *"Hey Siri, set Repair Sensitivity to 50%"* (= level 5)
- *"Hey Siri, turn on Recording"*
- *"Hey Siri, turn off Noise Reduction in the living room"*

---

## Shortcuts & Automations

The accessories work with the Shortcuts app and HomeKit automations. Some useful ideas:

**Start a recording session with one tap:**
1. Turn on Click Repair
2. Turn on Noise Reduction
3. Turn on Recording

**Alert when clipping is detected:**
- Trigger: Clipping motion sensor detects motion
- Action: Send a notification / flash a light

**Timed recording:**
- Trigger: Turn on Recording switch
- Action: Wait 45 minutes → Turn off Recording switch

---

## Building from Source

```bash
git clone https://github.com/your-repo/homebridge-sugarcube
cd homebridge-sugarcube
npm install
npm run build
```

To test locally with HomeBridge:

```bash
npm run build
npm link
# In your HomeBridge directory:
npm link homebridge-sugarcube
```

---

## Clipping Sensor Notes

The clipping sensor uses HomeKit's Motion Sensor accessory type — it fires when clipping is detected and clears when the device reports clean. Because HomeKit treats motion sensors as momentary triggers, you may want to add a short "motion cleared" delay in your automation to avoid repeated triggers during a session with intermittent clipping.

---

## Related

- [`sugarcube_client.py`](https://github.com/DNSGeek/Python-SugarCube/blob/main/sugarcube_client.py) — Python CLI and library for the same API
- [`sugarcube_menubar.py`](https://github.com/DNSGeek/Python-SugarCube/blob/main/sugarcube_menubar.py) — macOS menu bar app
