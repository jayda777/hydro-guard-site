"use strict";

/*
 * Hydro Guard BLE configuration
 * Replace these UUIDs with the values used by your ESP32 firmware.
 * The data characteristic should send UTF-8 JSON, for example:
 * {"pressure":4.2,"flow_rate":1.5,"total_usage":12.5,"leak_detected":false,"status":"normal"}
 */
const CONFIG = {
  serviceUUID: "7e400001-b5a3-f393-e0a9-e50e24dcca9e",
  dataCharacteristicUUID: "7e400002-b5a3-f393-e0a9-e50e24dcca9e",

  // Use 1 when pressure arrives in kPa; use 100 when it arrives in bar.
  pressureToKpaMultiplier: 1,

  thresholds: {
    pressureWarningKpa: 550,
    unusualFlowLitresPerMinute: 25
  },

  reconnect: {
    maxAttempts: 5,
    initialDelayMs: 1200
  },

  maxHistoryItems: 30,
  storageKey: "hydro-guard-alert-history-v1"
};

const els = {
  connectButton: document.getElementById("connect-button"),
  demoButton: document.getElementById("demo-button"),
  connectionLabel: document.getElementById("connection-label"),
  bluetoothStatus: document.getElementById("bluetooth-status"),
  connectionNote: document.getElementById("connection-note"),
  pressureValue: document.getElementById("pressure-value"),
  flowValue: document.getElementById("flow-value"),
  usageValue: document.getElementById("usage-value"),
  leakValue: document.getElementById("leak-value"),
  systemStatus: document.getElementById("system-status"),
  systemStatusDot: document.getElementById("system-status-dot"),
  lastUpdate: document.getElementById("last-update"),
  currentAlerts: document.getElementById("current-alerts"),
  alertHistory: document.getElementById("alert-history"),
  alertCount: document.getElementById("alert-count"),
  clearHistoryButton: document.getElementById("clear-history-button"),
  modeBadge: document.getElementById("mode-badge")
};

let device = null;
let characteristic = null;
let isManualDisconnect = false;
let reconnectTimer = null;
let reconnectAttempts = 0;
let readTimer = null;
let demoTimer = null;
let demoMode = false;
let latestData = null;
const activeEvents = new Set();
let liveAlerts = [];
let alertHistory = loadHistory();

document.getElementById("current-year").textContent = String(new Date().getFullYear());

function setConnectionStatus(connected, message) {
  els.connectionLabel.textContent = connected ? "Bluetooth connected" : "Bluetooth disconnected";
  els.bluetoothStatus.textContent = connected ? "Connected" : "Disconnected";
  if (message) setNote(message, connected ? "success" : "");
  els.connectButton.innerHTML = connected
    ? '<span class="bluetooth-symbol" aria-hidden="true">ᛒ</span> Disconnect'
    : '<span class="bluetooth-symbol" aria-hidden="true">ᛒ</span> Connect Hydro Guard';
}

function setNote(message, kind = "") {
  els.connectionNote.textContent = message;
  els.connectionNote.className = `connection-note${kind ? ` ${kind}` : ""}`;
}

function formatNumber(value, digits = 1) {
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: digits }).format(value);
}

function asFiniteNumber(value) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatTimestamp(timestamp) {
  return new Date(timestamp).toLocaleString([], {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit"
  });
}

function updateDashboard(data, source) {
  latestData = data;
  const pressureRaw = asFiniteNumber(data.pressure);
  const pressureKpa = pressureRaw === null
    ? null
    : pressureRaw * CONFIG.pressureToKpaMultiplier;
  const flow = asFiniteNumber(data.flow_rate);
  const usage = asFiniteNumber(data.total_usage);

  els.pressureValue.textContent = pressureKpa === null ? "—" : formatNumber(pressureKpa);
  els.flowValue.textContent = flow === null ? "—" : formatNumber(flow);
  els.usageValue.textContent = usage === null ? "—" : formatNumber(usage);
  els.leakValue.textContent = typeof data.leak_detected === "boolean"
    ? (data.leak_detected ? "Detected" : "Not detected")
    : "Unknown";

  const status = deriveStatus(data, pressureKpa, flow);
  els.systemStatus.textContent = demoMode ? "Demo" : status.label;
  els.systemStatusDot.className = `status-indicator ${status.className}`;
  els.lastUpdate.textContent = `${formatTimestamp(Date.now())}${source === "demo" ? " · demo" : ""}`;

  evaluateAlerts({ ...data, pressureKpa, flow });
}

function deriveStatus(data, pressureKpa, flow) {
  const incoming = String(data.status || "").toLowerCase();
  if (data.leak_detected === true || incoming === "alert" || incoming === "critical") {
    return { label: "Alert", className: "alert" };
  }
  if (
    incoming === "warning" || incoming === "warn" ||
    (pressureKpa !== null && pressureKpa >= CONFIG.thresholds.pressureWarningKpa) ||
    (flow !== null && flow >= CONFIG.thresholds.unusualFlowLitresPerMinute)
  ) {
    return { label: "Warning", className: "warning" };
  }
  if (incoming === "normal" || incoming === "ok") {
    return { label: "Normal", className: "normal" };
  }
  return { label: "Data received", className: "" };
}

function evaluateAlerts(data) {
  const pressureHigh = data.pressureKpa !== null &&
    data.pressureKpa >= CONFIG.thresholds.pressureWarningKpa;
  const leak = data.leak_detected === true;
  const usageHigh = data.flow !== null &&
    data.flow >= CONFIG.thresholds.unusualFlowLitresPerMinute;

  toggleEvent("pressure", pressureHigh, "warning",
    "WARNING: Water pressure is rising. Please check your plumbing system.");
  toggleEvent("leak", leak, "urgent",
    "URGENT: Water leakage detected. Please inspect your water system.");
  toggleEvent("usage", usageHigh, "warning",
    "WARNING: Unusual water usage detected.");
}

function toggleEvent(key, active, level, message) {
  if (active && !activeEvents.has(key)) {
    activeEvents.add(key);
    createAlert(level, message);
  } else if (!active) {
    activeEvents.delete(key);
  }
}

function createAlert(level, message) {
  const item = { id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, level, message, timestamp: Date.now() };
  liveAlerts.unshift(item);
  alertHistory.unshift(item);
  alertHistory = alertHistory.slice(0, CONFIG.maxHistoryItems);
  saveHistory();
  renderAlerts();
}

function dismissAlert(id) {
  liveAlerts = liveAlerts.filter(alert => alert.id !== id);
  renderAlerts();
}

function renderAlerts() {
  els.currentAlerts.replaceChildren();
  if (liveAlerts.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-alert";
    empty.innerHTML = '<span class="empty-alert-icon">✓</span><span><strong>All quiet</strong><small>Alerts will appear here when incoming readings cross your configured thresholds.</small></span>';
    els.currentAlerts.append(empty);
  } else {
    liveAlerts.forEach(alert => {
      const row = document.createElement("div");
      row.className = `live-alert ${alert.level}`;
      const label = alert.level === "urgent" ? "URGENT" : "WARNING";
      row.innerHTML = `<span class="alert-level">${label}</span>
        <span class="alert-copy"><strong></strong><small>${formatTimestamp(alert.timestamp)}</small></span>
        <button type="button" class="dismiss-alert" aria-label="Dismiss alert">×</button>`;
      row.querySelector(".alert-copy strong").textContent = alert.message;
      row.querySelector(".dismiss-alert").addEventListener("click", () => dismissAlert(alert.id));
      els.currentAlerts.append(row);
    });
  }

  els.alertHistory.replaceChildren();
  if (alertHistory.length === 0) {
    const empty = document.createElement("li");
    empty.className = "history-empty";
    empty.textContent = "No alerts recorded.";
    els.alertHistory.append(empty);
  } else {
    alertHistory.forEach(alert => {
      const row = document.createElement("li");
      const message = document.createElement("span");
      message.className = "history-message";
      message.textContent = alert.message;
      const time = document.createElement("time");
      time.className = "history-time";
      time.dateTime = new Date(alert.timestamp).toISOString();
      time.textContent = formatTimestamp(alert.timestamp);
      row.append(message, time);
      els.alertHistory.append(row);
    });
  }
  els.alertCount.textContent = `${alertHistory.length} alert${alertHistory.length === 1 ? "" : "s"}`;
}

function loadHistory() {
  try {
    const saved = JSON.parse(localStorage.getItem(CONFIG.storageKey) || "[]");
    return Array.isArray(saved) ? saved.slice(0, CONFIG.maxHistoryItems) : [];
  } catch {
    return [];
  }
}

function saveHistory() {
  try {
    localStorage.setItem(CONFIG.storageKey, JSON.stringify(alertHistory));
  } catch {
    // The dashboard continues to work if browser storage is unavailable.
  }
}

function parsePayload(dataView) {
  const bytes = new Uint8Array(dataView.buffer, dataView.byteOffset, dataView.byteLength);
  const text = new TextDecoder("utf-8").decode(bytes).replace(/\0/g, "").trim();
  if (!text) return null;

  // Allow a firmware stream to append a newline or send a single JSON object per update.
  const candidate = text.split(/\r?\n/).filter(Boolean).at(-1);
  try {
    const parsed = JSON.parse(candidate);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (error) {
    console.warn("Hydro Guard received data that was not valid JSON.", error);
    setNote("Connected, but the latest BLE payload was not valid JSON. Check your ESP32 data format.", "error");
    return null;
  }
}

function handleCharacteristicValue(event) {
  const data = parsePayload(event.target.value);
  if (!data) return;
  setNote("Receiving live sensor data from your Hydro Guard device.", "success");
  updateDashboard(data, "hardware");
}

async function connectToSelectedDevice() {
  if (!("bluetooth" in navigator)) {
    setNote("Web Bluetooth is not available in this browser. Try a supported Chromium browser or Bluefy on iPad, using HTTPS.", "error");
    return;
  }
  if (!window.isSecureContext) {
    setNote("Bluetooth requires a secure context. Open this site using HTTPS or localhost.", "error");
    return;
  }

  try {
    stopDemo();
    isManualDisconnect = false;
    setNote("Choose your Hydro Guard ESP32 in the browser’s Bluetooth device picker.");
    device = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: [CONFIG.serviceUUID]
    });
    device.addEventListener("gattserverdisconnected", handleUnexpectedDisconnect);
    reconnectAttempts = 0;
    await connectGatt();
  } catch (error) {
    if (error.name === "NotFoundError") {
      setNote("No device was selected. Choose Connect Hydro Guard to try again.");
    } else {
      console.error("Bluetooth connection failed:", error);
      setNote(`Could not connect: ${error.message || "Bluetooth connection failed."}`, "error");
      setConnectionStatus(false);
    }
  }
}

async function connectGatt() {
  if (!device || !device.gatt) throw new Error("The selected device does not provide a GATT server.");
  setNote("Connecting to Hydro Guard over Bluetooth Low Energy…");
  const server = await device.gatt.connect();
  const service = await server.getPrimaryService(CONFIG.serviceUUID);
  characteristic = await service.getCharacteristic(CONFIG.dataCharacteristicUUID);

  characteristic.removeEventListener("characteristicvaluechanged", handleCharacteristicValue);
  if (characteristic.properties.notify || characteristic.properties.indicate) {
    await characteristic.startNotifications();
    characteristic.addEventListener("characteristicvaluechanged", handleCharacteristicValue);
    clearInterval(readTimer);
    readTimer = null;
  }

  if (characteristic.properties.read) {
    try {
      const initialValue = await characteristic.readValue();
      handleCharacteristicValue({ target: { value: initialValue } });
    } catch (error) {
      console.warn("Could not read the initial BLE value:", error);
    }
  }

  if (!(characteristic.properties.notify || characteristic.properties.indicate) && characteristic.properties.read) {
    clearInterval(readTimer);
    readTimer = setInterval(async () => {
      if (!device?.gatt?.connected || !characteristic) return;
      try {
        handleCharacteristicValue({ target: { value: await characteristic.readValue() } });
      } catch (error) {
        console.warn("BLE polling read failed:", error);
      }
    }, 1500);
  }

  reconnectAttempts = 0;
  setConnectionStatus(true, "Connected to the selected Hydro Guard device. Waiting for sensor data…");
  if (!latestData) {
    els.systemStatus.textContent = "Awaiting data";
    els.systemStatusDot.className = "status-indicator";
  }
}

function handleUnexpectedDisconnect() {
  clearInterval(readTimer);
  readTimer = null;
  characteristic = null;
  setConnectionStatus(false, "Bluetooth connection lost. Attempting to reconnect…");
  if (isManualDisconnect || !device) return;
  scheduleReconnect();
}

function scheduleReconnect() {
  clearTimeout(reconnectTimer);
  if (reconnectAttempts >= CONFIG.reconnect.maxAttempts) {
    setNote("Automatic reconnection stopped after several attempts. Use Connect Hydro Guard to reconnect.", "error");
    return;
  }

  const delay = CONFIG.reconnect.initialDelayMs * Math.pow(2, reconnectAttempts);
  reconnectAttempts += 1;
  reconnectTimer = setTimeout(async () => {
    if (isManualDisconnect || !device) return;
    try {
      await connectGatt();
    } catch (error) {
      console.warn("Automatic BLE reconnect attempt failed:", error);
      scheduleReconnect();
    }
  }, delay);
}

function disconnectDevice() {
  isManualDisconnect = true;
  clearTimeout(reconnectTimer);
  clearInterval(readTimer);
  readTimer = null;
  if (characteristic) {
    characteristic.removeEventListener("characteristicvaluechanged", handleCharacteristicValue);
  }
  if (device?.gatt?.connected) device.gatt.disconnect();
  characteristic = null;
  setConnectionStatus(false, "Bluetooth disconnected. Sensor readings are not currently updating.");
}

function startDemo() {
  if (device?.gatt?.connected) disconnectDevice();
  stopDemo();
  demoMode = true;
  els.modeBadge.hidden = false;
  els.demoButton.textContent = "Stop demo";
  els.connectionLabel.textContent = "DEMO · simulated data";
  els.bluetoothStatus.textContent = "Demo only";
  els.systemStatus.textContent = "Demo";
  setNote("DEMO MODE: these simulated readings are for presentation only and are not from physical sensors.", "");
  let step = 0;
  const samples = [
    { pressure: 310, flow_rate: 2.1, total_usage: 86.4, leak_detected: false, status: "normal" },
    { pressure: 322, flow_rate: 2.4, total_usage: 86.8, leak_detected: false, status: "normal" },
    { pressure: 565, flow_rate: 2.7, total_usage: 87.2, leak_detected: false, status: "warning" },
    { pressure: 335, flow_rate: 29.5, total_usage: 87.6, leak_detected: false, status: "warning" },
    { pressure: 328, flow_rate: 1.9, total_usage: 88.1, leak_detected: false, status: "normal" }
  ];
  updateDashboard(samples[0], "demo");
  demoTimer = setInterval(() => {
    step = (step + 1) % samples.length;
    updateDashboard(samples[step], "demo");
  }, 3500);
}

function stopDemo() {
  clearInterval(demoTimer);
  demoTimer = null;
  if (demoMode) {
    demoMode = false;
    els.modeBadge.hidden = true;
    els.demoButton.textContent = "Start demo";
    els.pressureValue.textContent = "—";
    els.flowValue.textContent = "—";
    els.usageValue.textContent = "—";
    els.leakValue.textContent = "—";
    els.lastUpdate.textContent = "No data received";
    els.systemStatus.textContent = "Awaiting data";
    els.systemStatusDot.className = "status-indicator";
    latestData = null;
    activeEvents.clear();
    setConnectionStatus(Boolean(device?.gatt?.connected));
    if (!device?.gatt?.connected) setNote("Demo stopped. Connect your ESP32 to see real sensor readings.");
  }
}

els.connectButton.addEventListener("click", () => {
  if (device?.gatt?.connected) disconnectDevice();
  else connectToSelectedDevice();
});

els.demoButton.addEventListener("click", () => {
  if (demoMode) stopDemo();
  else startDemo();
});

els.clearHistoryButton.addEventListener("click", () => {
  alertHistory = [];
  saveHistory();
  renderAlerts();
});

if (!("bluetooth" in navigator)) {
  setNote("Web Bluetooth is unavailable in this browser. Live BLE requires a compatible browser and HTTPS.", "error");
}
renderAlerts();