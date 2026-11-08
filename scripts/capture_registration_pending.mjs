import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

async function run() {
  console.log("=== Capturing Registration Pending Confirmation Screen ===");

  const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  const userDataDir = path.resolve("./chrome-profile-pending");
  if (!fs.existsSync(userDataDir)) {
    fs.mkdirSync(userDataDir, { recursive: true });
  }

  const screenshotsDir = path.resolve("./screenshots");
  if (!fs.existsSync(screenshotsDir)) {
    fs.mkdirSync(screenshotsDir, { recursive: true });
  }

  console.log("Launching headless Chrome on port 9223...");
  const chromeProc = spawn(chromePath, [
    "--headless=new",
    "--remote-debugging-port=9223",
    `--user-data-dir=${userDataDir}`,
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "about:blank",
  ], { stdio: "ignore" });

  chromeProc.on("error", (err) => console.error("Chrome error:", err));

  let connected = false;
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch("http://127.0.0.1:9223/json/version");
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
    throw new Error("Could not connect to Chrome port 9223");
  }

  const tabsRes = await fetch("http://127.0.0.1:9223/json/list");
  const tabs = await tabsRes.json();
  const pageTab = tabs.find((t) => t.type === "page") || tabs[0];
  const ws = new WebSocket(pageTab.webSocketDebuggerUrl);

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

  async function setViewport(width, height, isMobile = false) {
    await sendCommand("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: isMobile ? 2 : 1,
      mobile: isMobile,
    });
    await new Promise((r) => setTimeout(r, 500));
  }

  async function capture(url, width, height, isMobile, filename) {
    await setViewport(width, height, isMobile);
    await sendCommand("Page.navigate", { url });
    await new Promise((r) => setTimeout(r, 2000));

    const { data } = await sendCommand("Page.captureScreenshot", {
      format: "png",
    });

    const outPath = path.join(screenshotsDir, filename);
    fs.writeFileSync(outPath, Buffer.from(data, "base64"));
    console.log(`Saved screenshot: ${outPath} (${width}x${height})`);

    // Copy to artifact directory if brain dir is present
    const brainDir = "C:\\Users\\windows-11\\.gemini\\antigravity\\brain\\3941de3d-d0e2-41d1-b8d7-2031ae9f7f4e";
    if (fs.existsSync(brainDir)) {
      const brainPath = path.join(brainDir, filename);
      fs.writeFileSync(brainPath, Buffer.from(data, "base64"));
      console.log(`Copied artifact: ${brainPath}`);
    }
  }

  // 1. Desktop: /login?registered=pending
  await capture("http://localhost:3000/login?registered=pending", 1920, 1080, false, "login-registered-pending-desktop-1920x1080.png");

  // 2. Mobile: /login?registered=pending
  await capture("http://localhost:3000/login?registered=pending", 390, 844, true, "login-registered-pending-mobile-390x844.png");

  ws.close();
  chromeProc.kill();
  console.log("All pending registration screenshots captured successfully!");
}

run().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
