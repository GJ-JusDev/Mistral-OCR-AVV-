import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

const envPath = path.resolve(process.cwd(), ".env.local");
const envConfig = dotenv.parse(fs.readFileSync(envPath));

async function run() {
  console.log("=== AVV Unified UI/UX Redesign Visual Inspection Suite ===");

  const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  const userDataDir = path.resolve("./chrome-profile-redesign");
  if (!fs.existsSync(userDataDir)) {
    fs.mkdirSync(userDataDir, { recursive: true });
  }

  const screenshotsDir = path.resolve("./screenshots");
  if (!fs.existsSync(screenshotsDir)) {
    fs.mkdirSync(screenshotsDir, { recursive: true });
  }

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

  // Wait for port 9222
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

  // ==========================================
  // 1. LOGIN PAGE TESTS
  // ==========================================
  console.log("\n[1/5] Capturing Login Page across viewports...");
  await sendCommand("Page.navigate", { url: "http://localhost:3000/login" });
  await new Promise((r) => setTimeout(r, 2000));

  // Desktop (1920x1080)
  await setViewport(1920, 1080, false);
  await saveScreenshot("login-desktop-1920x1080.png");

  // Laptop (1366x768)
  await setViewport(1366, 768, false);
  await saveScreenshot("login-laptop-1366x768.png");

  // Tablet (768x1024)
  await setViewport(768, 1024, false);
  await saveScreenshot("login-tablet-768x1024.png");

  // Mobile (390x844)
  await setViewport(390, 844, true);
  await saveScreenshot("login-mobile-390x844.png");

  // ==========================================
  // 2. REGISTRATION PAGE TESTS
  // ==========================================
  console.log("\n[2/5] Capturing Registration Page across viewports...");
  await sendCommand("Page.navigate", { url: "http://localhost:3000/register" });
  await new Promise((r) => setTimeout(r, 2000));

  // Desktop (1920x1080)
  await setViewport(1920, 1080, false);
  await saveScreenshot("register-desktop-1920x1080.png");

  // Mobile (390x844)
  await setViewport(390, 844, true);
  await saveScreenshot("register-mobile-390x844.png");

  // Open Terms & Conditions modal
  await setViewport(1366, 768, false);
  await evaluate(`(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const termsBtn = btns.find(b => b.textContent && b.textContent.includes('Terms and Conditions'));
    if (termsBtn) termsBtn.click();
  })()`);
  await new Promise((r) => setTimeout(r, 600));
  await saveScreenshot("register-terms-modal-desktop.png");

  // Close modal
  await evaluate(`(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const closeBtn = btns.find(b => b.textContent && b.textContent.includes('Understand'));
    if (closeBtn) closeBtn.click();
  })()`);
  await new Promise((r) => setTimeout(r, 500));

  // ==========================================
  // 3. TEACHER DASHBOARD TESTS
  // ==========================================
  console.log("\n[3/5] Logging in as Teacher and capturing Teacher Dashboard...");
  await setViewport(1920, 1080, false);
  await sendCommand("Page.navigate", { url: "http://localhost:3000/login" });
  await new Promise((r) => setTimeout(r, 1500));

  // Fill in login form
  await evaluate(`(() => {
    document.querySelector('input[name="email"]').value = 'teacher@example.com';
    document.querySelector('input[name="password"]').value = 'Password123!';
    document.querySelector('button[type="submit"]').click();
  })()`);
  await new Promise((r) => setTimeout(r, 3500));

  // Capture Teacher Dashboard
  await saveScreenshot("teacher-dashboard-desktop-1920x1080.png");

  // Mobile drawer for Teacher
  await setViewport(390, 844, true);
  await saveScreenshot("teacher-dashboard-mobile-390x844.png");

  // Click hamburger to show mobile drawer
  await evaluate(`(() => {
    const btn = document.querySelector('button[aria-label="Toggle navigation drawer"]');
    if (btn) btn.click();
  })()`);
  await new Promise((r) => setTimeout(r, 600));
  await saveScreenshot("teacher-mobile-drawer-390x844.png");

  // ==========================================
  // 4. PRINCIPAL DASHBOARD TESTS
  // ==========================================
  console.log("\n[4/5] Logging in as Principal and capturing Principal Dashboard...");
  await setViewport(1920, 1080, false);

  // Click Sign Out
  await evaluate(`(() => {
    const form = document.querySelector('form button[type="submit"]');
    if (form) form.click();
  })()`);
  await new Promise((r) => setTimeout(r, 2000));

  await sendCommand("Page.navigate", { url: "http://localhost:3000/login" });
  await new Promise((r) => setTimeout(r, 1500));

  // Sign in as Principal
  await evaluate(`(() => {
    document.querySelector('input[name="email"]').value = 'principal@example.com';
    document.querySelector('input[name="password"]').value = 'Password123!';
    document.querySelector('button[type="submit"]').click();
  })()`);
  await new Promise((r) => setTimeout(r, 3500));

  // Capture Principal Dashboard
  await saveScreenshot("principal-dashboard-desktop-1920x1080.png");

  // Capture Principal Student Directory
  await sendCommand("Page.navigate", { url: "http://localhost:3000/principal/students" });
  await new Promise((r) => setTimeout(r, 2500));
  await saveScreenshot("principal-students-desktop-1920x1080.png");

  // ==========================================
  // 5. ADMIN DASHBOARD TESTS
  // ==========================================
  console.log("\n[5/5] Logging in as Administrator and capturing Admin Dashboard...");
  // Sign Out
  await sendCommand("Page.navigate", { url: "http://localhost:3000/login" });
  await new Promise((r) => setTimeout(r, 1500));

  await evaluate(`(() => {
    document.querySelector('input[name="email"]').value = 'admin@example.com';
    document.querySelector('input[name="password"]').value = 'Password123!';
    document.querySelector('button[type="submit"]').click();
  })()`);
  await new Promise((r) => setTimeout(r, 3500));

  // Navigate to Admin Users page
  await sendCommand("Page.navigate", { url: "http://localhost:3000/admin/users" });
  await new Promise((r) => setTimeout(r, 2500));
  await saveScreenshot("admin-users-dashboard-desktop-1920x1080.png");

  // Mobile Admin view
  await setViewport(390, 844, true);
  await saveScreenshot("admin-users-mobile-390x844.png");

  console.log("\n✓ All visual regression screenshots captured successfully!");

  ws.close();
  chromeProc.kill();
}

run().catch((err) => {
  console.error("Capture Suite Failed:", err);
  process.exit(1);
});
