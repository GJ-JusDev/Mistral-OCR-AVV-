import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

async function run() {
  console.log("=== AVV System Auth Pages (Login & Register) Chrome Visual Review Suite ===");

  const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  const userDataDir = path.resolve("./chrome-profile-auth");
  if (!fs.existsSync(userDataDir)) {
    fs.mkdirSync(userDataDir, { recursive: true });
  }

  const screenshotsDir = path.resolve("./screenshots");
  if (!fs.existsSync(screenshotsDir)) {
    fs.mkdirSync(screenshotsDir, { recursive: true });
  }

  const artifactDir = "C:\\Users\\windows-11\\.gemini\\antigravity\\brain\\8412e4a2-a574-49b2-aaf5-801fe7906415";

  console.log("Spawning Chrome headless on port 9223...");
  const chromeProc = spawn(chromePath, [
    "--headless=new",
    "--remote-debugging-port=9223",
    `--user-data-dir=${userDataDir}`,
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "about:blank",
  ], { stdio: "ignore" });

  chromeProc.on("error", (err) => {
    console.error("Chrome process error:", err);
  });

  // Wait for port 9223 to respond
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
    throw new Error("Could not connect to Chrome on port 9223 within 9s");
  }

  console.log("Chrome CDP is ready on http://127.0.0.1:9223");

  const tabsRes = await fetch("http://127.0.0.1:9223/json/list");
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

  async function evaluate(expression) {
    const res = await sendCommand("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    return res.result?.value;
  }

  function saveImage(filename, base64Data) {
    const targetFile = path.join(screenshotsDir, filename);
    fs.writeFileSync(targetFile, Buffer.from(base64Data, "base64"));
    console.log("✓ Saved screenshot:", targetFile);

    // Also copy to artifact directory if exists
    if (fs.existsSync(artifactDir)) {
      const artifactTarget = path.join(artifactDir, filename);
      fs.writeFileSync(artifactTarget, Buffer.from(base64Data, "base64"));
      console.log("  -> Copied to artifact dir:", artifactTarget);
    }
  }

  // ==========================================
  // PART 1: LOGIN PAGE (/login)
  // ==========================================
  console.log("\n==========================================");
  console.log("--- CAPTURING LOGIN PAGE (/login) ---");
  console.log("==========================================");

  await sendCommand("Page.navigate", { url: "http://localhost:3000/login" });
  await new Promise((r) => setTimeout(r, 2000));

  // 1. Desktop 1920x1080
  console.log("Capturing Login Desktop (1920x1080)...");
  await sendCommand("Emulation.setDeviceMetricsOverride", {
    width: 1920,
    height: 1080,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await new Promise((r) => setTimeout(r, 1000));
  const loginDesktop = await sendCommand("Page.captureScreenshot", { format: "png" });
  saveImage("login-desktop-1920x1080.png", loginDesktop.data);

  // 2. Tablet 768x1024
  console.log("Capturing Login Tablet (768x1024)...");
  await sendCommand("Emulation.setDeviceMetricsOverride", {
    width: 768,
    height: 1024,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await new Promise((r) => setTimeout(r, 1000));
  const loginTablet = await sendCommand("Page.captureScreenshot", { format: "png" });
  saveImage("login-tablet-768x1024.png", loginTablet.data);

  // 3. Mobile 390x844
  console.log("Capturing Login Mobile (390x844)...");
  await sendCommand("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    mobile: true,
  });
  await new Promise((r) => setTimeout(r, 1000));
  const loginMobile = await sendCommand("Page.captureScreenshot", { format: "png" });
  saveImage("login-mobile-390x844.png", loginMobile.data);

  // ==========================================
  // PART 2: REGISTRATION PAGE (/register)
  // ==========================================
  console.log("\n==========================================");
  console.log("--- CAPTURING REGISTRATION PAGE (/register) ---");
  console.log("==========================================");

  await sendCommand("Page.navigate", { url: "http://localhost:3000/register" });
  await new Promise((r) => setTimeout(r, 2000));

  // 1. Desktop 1920x1080
  console.log("Capturing Register Desktop (1920x1080)...");
  await sendCommand("Emulation.setDeviceMetricsOverride", {
    width: 1920,
    height: 1080,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await new Promise((r) => setTimeout(r, 1000));
  const registerDesktop = await sendCommand("Page.captureScreenshot", { format: "png" });
  saveImage("register-desktop-1920x1080.png", registerDesktop.data);

  // Full page scroll capture for register desktop
  const registerDesktopFull = await sendCommand("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: true,
  });
  saveImage("register-desktop-fullpage.png", registerDesktopFull.data);

  // 2. Tablet 768x1024
  console.log("Capturing Register Tablet (768x1024)...");
  await sendCommand("Emulation.setDeviceMetricsOverride", {
    width: 768,
    height: 1024,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await new Promise((r) => setTimeout(r, 1000));
  const registerTablet = await sendCommand("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: true,
  });
  saveImage("register-tablet-768x1024.png", registerTablet.data);

  // 3. Mobile 390x844
  console.log("Capturing Register Mobile (390x844)...");
  await sendCommand("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    mobile: true,
  });
  await new Promise((r) => setTimeout(r, 1000));
  const registerMobile = await sendCommand("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: true,
  });
  saveImage("register-mobile-390x844.png", registerMobile.data);

  // 4. Terms Modal on Desktop
  console.log("\nCapturing Terms and Conditions Modal interaction on Desktop...");
  await sendCommand("Emulation.setDeviceMetricsOverride", {
    width: 1920,
    height: 1080,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await new Promise((r) => setTimeout(r, 600));

  const openedTerms = await evaluate(`(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Terms and Conditions'));
    if (btn) {
      btn.click();
      return true;
    }
    return false;
  })()`);
  console.log("-> Terms modal opened:", openedTerms);
  await new Promise((r) => setTimeout(r, 600));

  const termsModalScreen = await sendCommand("Page.captureScreenshot", { format: "png" });
  saveImage("register-terms-modal-1920x1080.png", termsModalScreen.data);

  console.log("\nAll visual captures finished successfully!");

  try {
    ws.close();
    chromeProc.kill();
  } catch (e) {
    // ignore
  }
}

run().catch((err) => {
  console.error("Execution failed:", err);
  process.exit(1);
});
