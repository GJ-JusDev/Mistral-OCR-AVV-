import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

async function run() {
  console.log("=== AVV System Landing Page Chrome Visual Review Suite ===");

  const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  const userDataDir = path.resolve("./chrome-profile");
  if (!fs.existsSync(userDataDir)) {
    fs.mkdirSync(userDataDir, { recursive: true });
  }

  const screenshotsDir = path.resolve("./screenshots");
  if (!fs.existsSync(screenshotsDir)) {
    fs.mkdirSync(screenshotsDir, { recursive: true });
  }

  console.log("Spawning Chrome headless with remote debugging port 9222...");
  const chromeProc = spawn(chromePath, [
    "--headless=new",
    "--remote-debugging-port=9222",
    `--user-data-dir=${userDataDir}`,
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "about:blank",
  ], { stdio: "ignore" });

  chromeProc.on("error", (err) => {
    console.error("Chrome process error:", err);
  });

  // Wait for port 9222 to respond
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
    throw new Error("Could not connect to Chrome on port 9222 within 9s");
  }

  console.log("Chrome CDP is ready on http://127.0.0.1:9222");

  // Get active tab or create new target
  const tabsRes = await fetch("http://127.0.0.1:9222/json/list");
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

  // 1. Navigate to http://localhost:3000/
  console.log("\nNavigating to http://localhost:3000/ ...");
  await sendCommand("Page.navigate", { url: "http://localhost:3000/" });
  await new Promise((r) => setTimeout(r, 2500));

  // 2. Desktop Capture (1920x1080)
  console.log("\n--- REVIEW 1: Desktop Viewport (1920x1080) ---");
  await sendCommand("Emulation.setDeviceMetricsOverride", {
    width: 1920,
    height: 1080,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await new Promise((r) => setTimeout(r, 1200));

  const desktopHero = await sendCommand("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
  });
  const desktopHeroPath = path.join(screenshotsDir, "desktop-hero-1920x1080.png");
  fs.writeFileSync(desktopHeroPath, Buffer.from(desktopHero.data, "base64"));
  console.log("✓ Saved desktop hero screenshot:", desktopHeroPath);

  // Full-page scroll capture
  const desktopFull = await sendCommand("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: true,
  });
  const desktopFullPath = path.join(screenshotsDir, "desktop-fullpage-1920x1080.png");
  fs.writeFileSync(desktopFullPath, Buffer.from(desktopFull.data, "base64"));
  console.log("✓ Saved desktop fullpage screenshot:", desktopFullPath);

  // 3. Tablet Capture (768x1024)
  console.log("\n--- REVIEW 2: Tablet Viewport (768x1024) ---");
  await sendCommand("Emulation.setDeviceMetricsOverride", {
    width: 768,
    height: 1024,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await new Promise((r) => setTimeout(r, 1200));

  const tabletScreen = await sendCommand("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
  });
  const tabletPath = path.join(screenshotsDir, "tablet-landing-768x1024.png");
  fs.writeFileSync(tabletPath, Buffer.from(tabletScreen.data, "base64"));
  console.log("✓ Saved tablet screenshot:", tabletPath);

  // 4. Mobile Capture (390x844 - iPhone 14 style)
  console.log("\n--- REVIEW 3: Mobile Viewport (390x844) ---");
  await sendCommand("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    mobile: true,
  });
  await new Promise((r) => setTimeout(r, 1200));

  const mobileScreen = await sendCommand("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
  });
  const mobilePath = path.join(screenshotsDir, "mobile-landing-390x844.png");
  fs.writeFileSync(mobilePath, Buffer.from(mobileScreen.data, "base64"));
  console.log("✓ Saved mobile screenshot:", mobilePath);

  // 5. Mobile Hamburger Menu Interaction & Screenshot
  console.log("\n--- REVIEW 4: Mobile Hamburger Menu Interaction ---");
  const menuBtnClick = await evaluate(`(() => {
    const btn = document.querySelector('button[aria-label="Open menu"]');
    if (!btn) return false;
    btn.click();
    return true;
  })()`);
  console.log("-> Clicked hamburger button:", menuBtnClick);
  await new Promise((r) => setTimeout(r, 600));

  const mobileMenuScreen = await sendCommand("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
  });
  const mobileMenuPath = path.join(screenshotsDir, "mobile-menu-opened-390x844.png");
  fs.writeFileSync(mobileMenuPath, Buffer.from(mobileMenuScreen.data, "base64"));
  console.log("✓ Saved mobile menu opened screenshot:", mobileMenuPath);

  // 6. Inspect TRIS Logo Display Quality & Distortion
  console.log("\n--- REVIEW 5: TRIS School Logo Analysis ---");
  const logoAudit = await evaluate(`(() => {
    const images = Array.from(document.querySelectorAll('img[alt*="Taysan"]')).map((img, idx) => {
      const rect = img.getBoundingClientRect();
      const style = window.getComputedStyle(img);
      return {
        index: idx + 1,
        alt: img.alt,
        src: img.currentSrc || img.src,
        renderedWidth: rect.width,
        renderedHeight: rect.height,
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight,
        aspectRatio: (rect.width / rect.height).toFixed(3),
        naturalAspectRatio: (img.naturalWidth / img.naturalHeight).toFixed(3),
        objectFit: style.objectFit,
        isDistorted: Math.abs((rect.width / rect.height) - (img.naturalWidth / img.naturalHeight)) > 0.05
      };
    });
    return images;
  })()`);
  console.log("Logo Audit Results:\n", JSON.stringify(logoAudit, null, 2));

  // 7. Inspect Mayon Volcano Background
  console.log("\n--- REVIEW 6: Mayon Volcano Background Inspection ---");
  const mayonAudit = await evaluate(`(() => {
    const heroImg = document.querySelector('img[alt*="Mayon"]');
    if (!heroImg) return { found: false };
    const rect = heroImg.getBoundingClientRect();
    const style = window.getComputedStyle(heroImg);
    return {
      found: true,
      src: heroImg.currentSrc || heroImg.src,
      alt: heroImg.alt,
      naturalWidth: heroImg.naturalWidth,
      naturalHeight: heroImg.naturalHeight,
      renderedWidth: rect.width,
      renderedHeight: rect.height,
      objectFit: style.objectFit,
      complete: heroImg.complete
    };
  })()`);
  console.log("Mayon Background Audit:\n", JSON.stringify(mayonAudit, null, 2));

  // 8. Functional Navigation Links Check
  console.log("\n--- REVIEW 7: Functional Navigation Links Check ---");
  const linksAudit = await evaluate(`(() => {
    const links = Array.from(document.querySelectorAll('a')).map(a => ({
      text: a.innerText.trim().replace(/\\s+/g, ' '),
      href: a.getAttribute('href')
    })).filter(l => l.text && l.href);

    const sectionElements = {
      home: !!document.getElementById('home'),
      features: !!document.getElementById('features'),
      howItWorks: !!document.getElementById('how-it-works'),
      about: !!document.getElementById('about')
    };

    return { totalLinks: links.length, sampleLinks: links.slice(0, 12), sectionElements };
  })()`);
  console.log("Navigation Audit:\n", JSON.stringify(linksAudit, null, 2));

  // Cleanup
  ws.close();
  chromeProc.kill();
  console.log("\n=== Visual & Functional Browser Review Complete ===");
}

run().catch((err) => {
  console.error("FATAL ERROR in capture review:", err);
  process.exit(1);
});
