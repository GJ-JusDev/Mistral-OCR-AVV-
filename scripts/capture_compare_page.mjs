import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

async function run() {
  console.log("=== Capturing Enhanced /compare Visual Previews ===");

  const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  const userDataDir = path.resolve("./chrome-profile-compare");
  if (!fs.existsSync(userDataDir)) {
    fs.mkdirSync(userDataDir, { recursive: true });
  }

  const screenshotsDir = path.resolve("./screenshots");
  if (!fs.existsSync(screenshotsDir)) {
    fs.mkdirSync(screenshotsDir, { recursive: true });
  }

  const artifactDir = "C:\\Users\\windows-11\\.gemini\\antigravity\\brain\\3941de3d-d0e2-41d1-b8d7-2031ae9f7f4e";

  console.log("Launching headless Chrome on port 9222...");
  const chromeProc = spawn(chromePath, [
    "--headless=new",
    "--remote-debugging-port=9222",
    `--user-data-dir=${userDataDir}`,
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "about:blank",
  ], { stdio: "ignore" });

  chromeProc.on("error", (err) => console.error("Chrome process error:", err));

  let connected = false;
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch("http://127.0.0.1:9222/json/version");
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
    throw new Error("Could not connect to Chrome port 9222");
  }

  const tabsRes = await fetch("http://127.0.0.1:9222/json/list");
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
  await sendCommand("Network.enable");

  async function setViewport(width, height, isMobile = false) {
    await sendCommand("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: isMobile ? 2 : 1,
      mobile: isMobile,
    });
    await new Promise((r) => setTimeout(r, 600));
  }

  async function saveScreenshot(filename, fullPage = false) {
    const capture = await sendCommand("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: fullPage,
    });
    const filePath = path.join(screenshotsDir, filename);
    fs.writeFileSync(filePath, Buffer.from(capture.data, "base64"));
    console.log(`  ✓ Saved: ${filename}`);

    if (fs.existsSync(artifactDir)) {
      const artifactPath = path.join(artifactDir, filename);
      fs.writeFileSync(artifactPath, Buffer.from(capture.data, "base64"));
      console.log(`  ✓ Copied to artifacts: ${artifactPath}`);
    }
    return filePath;
  }

  async function evaluate(expression) {
    const res = await sendCommand("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    return res.result?.value;
  }

  try {
    // 1. Log in as Teacher
    console.log("\nLogging in as Teacher...");
    await setViewport(1920, 1080, false);
    await sendCommand("Page.navigate", { url: "http://localhost:3000/login" });
    await new Promise((r) => setTimeout(r, 1500));

    await evaluate(`(() => {
      const emailInput = document.querySelector('input[name="email"]');
      const passInput = document.querySelector('input[name="password"]');
      if (emailInput && passInput) {
        emailInput.value = 'teacher@example.com';
        passInput.value = 'Password123!';
        document.querySelector('button[type="submit"]')?.click();
      }
    })()`);
    await new Promise((r) => setTimeout(r, 3000));

    // 2. Navigate to /compare
    console.log("\nNavigating to /compare...");
    await sendCommand("Page.navigate", { url: "http://localhost:3000/compare" });
    await new Promise((r) => setTimeout(r, 2000));

    // Desktop Screenshot (1920x1080)
    console.log("\nCapturing /compare desktop view (1920x1080)...");
    await setViewport(1920, 1080, false);
    await saveScreenshot("compare-desktop-1920x1080.png");

    // Mobile Screenshot (390x844)
    console.log("\nCapturing /compare mobile view (390x844)...");
    await setViewport(390, 844, true);
    await saveScreenshot("compare-mobile-390x844.png");

    console.log("\nScreenshots captured successfully!");
  } finally {
    ws.close();
    chromeProc.kill();
  }
}

run().catch((err) => {
  console.error("Error capturing /compare screenshots:", err);
  process.exit(1);
});
