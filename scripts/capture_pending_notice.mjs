import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

async function run() {
  console.log("=== Capturing /login?registered=pending Confirmation Banner ===");

  const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  const userDataDir = path.resolve("./chrome-profile-pending");
  if (!fs.existsSync(userDataDir)) {
    fs.mkdirSync(userDataDir, { recursive: true });
  }

  const screenshotsDir = path.resolve("./screenshots");
  const artifactDir = "C:\\Users\\windows-11\\.gemini\antigravity\\brain\\8412e4a2-a574-49b2-aaf5-801fe7906415";

  const chromeProc = spawn(chromePath, [
    "--headless=new",
    "--remote-debugging-port=9225",
    `--user-data-dir=${userDataDir}`,
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "about:blank",
  ], { stdio: "ignore" });

  let connected = false;
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch("http://127.0.0.1:9225/json/version");
      if (res.ok) {
        connected = true;
        break;
      }
    } catch {
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  if (!connected) {
    chromeProc.kill();
    throw new Error("Could not connect to Chrome on port 9225");
  }

  const tabsRes = await fetch("http://127.0.0.1:9225/json/list");
  const tabs = await tabsRes.json();
  const pageTab = tabs.find((t) => t.type === "page") || tabs[0];
  const wsUrl = pageTab.webSocketDebuggerUrl;

  const ws = new WebSocket(wsUrl);
  let messageId = 1;
  const pending = new Map();

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.id && pending.has(data.id)) {
      const { resolve, reject } = pending.get(data.id);
      pending.delete(data.id);
      if (data.error) reject(data.error);
      else resolve(data.result);
    }
  };

  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });

  function sendCommand(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = messageId++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  await sendCommand("Page.enable");
  await sendCommand("DOM.enable");
  await sendCommand("Runtime.enable");

  function saveImage(filename, base64Data) {
    const targetFile = path.join(screenshotsDir, filename);
    fs.writeFileSync(targetFile, Buffer.from(base64Data, "base64"));
    console.log("✓ Saved screenshot:", targetFile);

    if (fs.existsSync(artifactDir)) {
      const artifactTarget = path.join(artifactDir, filename);
      fs.writeFileSync(artifactTarget, Buffer.from(base64Data, "base64"));
      console.log("  -> Copied to artifact dir:", artifactTarget);
    }
  }

  console.log("Navigating to http://localhost:3000/login?registered=pending ...");
  await sendCommand("Page.navigate", { url: "http://localhost:3000/login?registered=pending" });
  await new Promise((r) => setTimeout(r, 2000));

  // 1. Desktop 1920x1080
  console.log("Capturing Desktop Viewport (1920x1080)...");
  await sendCommand("Emulation.setDeviceMetricsOverride", {
    width: 1920,
    height: 1080,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await new Promise((r) => setTimeout(r, 1000));
  const desktopScreen = await sendCommand("Page.captureScreenshot", { format: "png" });
  saveImage("login-registered-pending-1920x1080.png", desktopScreen.data);

  // 2. Mobile 390x844
  console.log("Capturing Mobile Viewport (390x844)...");
  await sendCommand("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    mobile: true,
  });
  await new Promise((r) => setTimeout(r, 1000));
  const mobileScreen = await sendCommand("Page.captureScreenshot", { format: "png" });
  saveImage("login-registered-pending-390x844.png", mobileScreen.data);

  console.log("Capture completed successfully!");

  try {
    ws.close();
    chromeProc.kill();
  } catch (e) {
    // ignore
  }
}

run().catch((err) => {
  console.error("Capture failed:", err);
  process.exit(1);
});
