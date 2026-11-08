import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

async function run() {
  console.log("=== AVV Admin Audit Logs & Activity Monitoring Visual Inspection Suite ===");

  const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  const userDataDir = path.resolve("./chrome-profile-audit");
  if (!fs.existsSync(userDataDir)) {
    fs.mkdirSync(userDataDir, { recursive: true });
  }

  const screenshotsDir = path.resolve("./screenshots");
  if (!fs.existsSync(screenshotsDir)) {
    fs.mkdirSync(screenshotsDir, { recursive: true });
  }

  const artifactDir = "C:\\Users\\windows-11\\.gemini\\antigravity\\brain\\3941de3d-d0e2-41d1-b8d7-2031ae9f7f4e";

  console.log("Launching headless Chrome on port 9225...");
  const chromeProc = spawn(chromePath, [
    "--headless=new",
    "--remote-debugging-port=9225",
    "--disable-extensions",
    `--user-data-dir=${userDataDir}`,
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "about:blank",
  ], { stdio: "ignore" });

  chromeProc.on("error", (err) => console.error("Chrome process error:", err));

  // Wait for port 9225
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
    throw new Error("Could not connect to Chrome port 9225");
  }

  const tabsRes = await fetch("http://127.0.0.1:9225/json/list");
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
    const localFilePath = path.join(screenshotsDir, filename);
    fs.writeFileSync(localFilePath, Buffer.from(capture.data, "base64"));
    console.log(`  ✓ Saved locally: ${localFilePath}`);

    if (fs.existsSync(artifactDir)) {
      const artifactFilePath = path.join(artifactDir, filename);
      fs.writeFileSync(artifactFilePath, Buffer.from(capture.data, "base64"));
      console.log(`  ✓ Copied to artifacts: ${artifactFilePath}`);
    }
    return localFilePath;
  }

  async function evaluate(expression) {
    const res = await sendCommand("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    return res.result?.value;
  }

  // 1. Authenticate as Administrator
  console.log("\n[1/4] Signing in as Administrator...");
  await setViewport(1920, 1080, false);
  await sendCommand("Page.navigate", { url: "http://localhost:3000/login" });
  await new Promise((r) => setTimeout(r, 2000));

  await evaluate(`(() => {
    const email = document.querySelector('input[name="email"]');
    const pass = document.querySelector('input[name="password"]');
    email.value = 'admin@example.com';
    email.dispatchEvent(new Event('input', { bubbles: true }));
    email.dispatchEvent(new Event('change', { bubbles: true }));
    pass.value = 'Password123!';
    pass.dispatchEvent(new Event('input', { bubbles: true }));
    pass.dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector('form button[type="submit"]').click();
  })()`);
  await new Promise((r) => setTimeout(r, 4000));

  // 2. Navigate to Admin Audit Logs page
  console.log("\n[2/4] Navigating to /admin/audit-logs (Desktop 1920x1080)...");
  await sendCommand("Page.navigate", { url: "http://localhost:3000/admin/audit-logs" });
  await new Promise((r) => setTimeout(r, 3500));

  await saveScreenshot("audit-logs-desktop-1920x1080.png");

  // 3. Open Detail Modal for an event
  console.log("\n[3/4] Opening event detail inspection modal...");
  const modalOpened = await evaluate(`(() => {
    const inspectButtons = Array.from(document.querySelectorAll('button')).filter(b => b.textContent && b.textContent.includes('Inspect'));
    if (inspectButtons.length > 0) {
      inspectButtons[0].click();
      return true;
    }
    return false;
  })()`);

  if (modalOpened) {
    console.log("  ✓ Inspect button clicked, waiting for modal...");
    await new Promise((r) => setTimeout(r, 1200));
    await saveScreenshot("audit-logs-modal-desktop.png");

    // Close modal
    await evaluate(`(() => {
      const closeBtn = document.querySelector('button[title="Close Modal"]') || Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('Close'));
      if (closeBtn) closeBtn.click();
    })()`);
    await new Promise((r) => setTimeout(r, 600));
  } else {
    console.log("  ⚠️ Inspect button not found");
  }

  // 4. Capture Mobile view (390x844)
  console.log("\n[4/4] Capturing Mobile View (390x844)...");
  await setViewport(390, 844, true);
  await new Promise((r) => setTimeout(r, 1500));
  await saveScreenshot("audit-logs-mobile-390x844.png");

  console.log("\n✓ All audit logs screenshots captured and saved to brain artifacts directory!");

  ws.close();
  chromeProc.kill();
}

run().catch((err) => {
  console.error("Capture Suite Failed:", err);
  process.exit(1);
});
