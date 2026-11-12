# Hydro Guard

A responsive, static website for a smart water-monitoring product concept. It includes a marketing homepage, an investor-friendly product overview, a live dashboard, configurable BLE connectivity, alerts, and a clearly separated demonstration mode.

## Files

- `index.html` — page structure and content
- `style.css` — responsive visual design
- `script.js` — BLE connection, dashboard updates, alerts and demo mode

## Publish with GitHub Pages

1. Add these four files to the root of a GitHub repository.
2. Open **Settings → Pages** for that repository.
3. Under **Build and deployment**, choose **Deploy from a branch**.
4. Choose the branch containing the files and the `/ (root)` folder, then save.
5. Open the published HTTPS URL.

GitHub Pages hosting is free for public repositories. No API keys, backend, or paid service is required. BLE access requires a secure context, so use the HTTPS Pages URL rather than opening the page as a local `file://` URL.

## Configure the ESP32 BLE service

Edit the `CONFIG` object near the top of `script.js`:

```js
const CONFIG = {
  serviceUUID: "7e400001-b5a3-f393-e0a9-e50e24dcca9e",
  dataCharacteristicUUID: "7e400002-b5a3-f393-e0a9-e50e24dcca9e",
  pressureToKpaMultiplier: 1,
  // ...
};
```

Replace `serviceUUID` and `dataCharacteristicUUID` with the UUIDs defined in your ESP32 firmware. The example UUIDs are placeholders, not firmware defaults.

The data characteristic should support **notifications or indications** for live updates. A readable characteristic is also supported; if it does not support notifications, the page polls it while connected. The device should send UTF-8 JSON, for example:

```json
{"pressure":4.2,"flow_rate":1.5,"total_usage":12.5,"leak_detected":false,"status":"normal"}
```

Supported fields:

- `pressure` — numeric pressure measurement
- `flow_rate` — numeric litres per minute
- `total_usage` — numeric total litres
- `leak_detected` — boolean
- `status` — e.g. `"normal"`, `"warning"` or `"alert"`

The example pressure value `4.2` might represent bar rather than kPa. The dashboard displays kPa. If the ESP32 sends bar, set `pressureToKpaMultiplier` to `100`; if it sends kPa, leave it at `1`. Confirm the unit and conversion for your sensor before relying on alerts.

The payload must fit in the characteristic update supported by your BLE stack, or your firmware must provide suitable framing/reassembly. This page parses one complete JSON object per update. It tolerates a trailing newline and null padding, but it does not reassemble arbitrary fragmented JSON messages.

## Set alert thresholds

In `script.js`, edit:

```js
thresholds: {
  pressureWarningKpa: 550,
  unusualFlowLitresPerMinute: 25
}
```

A leak alert is triggered when `leak_detected` is `true`. Pressure and high-flow alerts are generated once while the condition remains active; they can trigger again after the reading returns below the threshold and rises again. Alerts include timestamps, remain in the history after dismissal, and are saved in the browser's local storage.

Choose thresholds appropriate to your plumbing and sensor calibration. The defaults are example configuration values, not professional or regulatory recommendations.

## Connect from an iPad

1. Open the published HTTPS site in a browser that supports Web Bluetooth.
2. Turn on the ESP32 and make sure its GATT service is advertising.
3. Tap **Connect Hydro Guard** and choose the ESP32 from the browser's Bluetooth picker.
4. When connected, the dashboard updates when the characteristic sends valid JSON.

Web Bluetooth support depends on browser, iPadOS version, device configuration and permissions. Bluefy may support BLE website access, but its capabilities can vary; test the actual UUIDs and notification/read behavior on the target iPad. If the browser does not expose `navigator.bluetooth`, the site explains that BLE is unavailable there. The site cannot bypass browser security restrictions or pair with devices in the background.

If the BLE connection drops unexpectedly, the page attempts a limited automatic reconnection to the already-selected device. Browser support and device availability affect whether this succeeds. If it does not, reconnect with the button.

## Demo mode

**Start demo** displays explicitly simulated readings for presentations. The dashboard shows a `DEMO MODE` badge and the connection label says `DEMO · simulated data`. These values are not hardware readings. Stop the demo before connecting to hardware; real readings are never substituted when the device is disconnected.

## Notes

- The dashboard does not invent sensor readings in hardware mode.
- Alerts are informational and do not replace a plumbing professional or an emergency response.
- The Google Fonts import in `style.css` is optional; the site falls back to system fonts if unavailable.