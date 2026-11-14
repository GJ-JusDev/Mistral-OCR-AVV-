import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

const envPath = path.resolve(process.cwd(), ".env.local");
const env = dotenv.parse(fs.readFileSync(envPath));

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const screenshotsDir = path.resolve("./screenshots");
const artifactDir = "C:\\Users\\windows-11\\.gemini\\antigravity\\brain\\3bd93d8b-599d-47ba-9020-42d155f09897";
if (!fs.existsSync(screenshotsDir)) fs.mkdirSync(screenshotsDir, { recursive: true });
if (!fs.existsSync(artifactDir)) fs.mkdirSync(artifactDir, { recursive: true });

async function run() {
  console.log("=== Capturing End-to-End Actual UI Workflow Screens ===");

  const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  const userDataDir = path.resolve("./chrome-profile-e2e-ui");
  if (!fs.existsSync(userDataDir)) fs.mkdirSync(userDataDir, { recursive: true });

  const testLrn = "123456789012";
  const schoolId = "a0000000-0000-0000-0000-000000000001";
  const adminUserId = "135baa53-7e1e-4c1f-b76a-f32a915b5f21";

  // Stage 1 Document: SF9 with Semester 1 only
  const sem1Payload = {
    student_id: null,
    school_id: schoolId,
    document_type: "sf9",
    image_url: "uploaded-doc-1.jpg",
    school_year: "2024-2025",
    grade_level: "Grade 11",
    semester: "1st Semester",
    extracted_fields: {
      lrn: testLrn,
      first_name: "JUAN",
      middle_name: "MIGUEL",
      last_name: "DELA CRUZ",
      name: "JUAN MIGUEL DELA CRUZ",
      school_id: "500169",
      school_name: "Taysan Resettlement Integrated School",
      school_year: "2024-2025",
      grade_level: "Grade 11",
      semester: "1st Semester",
      grades: [
        { subject: "Oral Communication", q1: 78, q2: 80, final: 79, sem1_final_grade: 79, status: "Passed", semester: "1st Semester" },
        { subject: "General Mathematics", q1: 85, q2: 87, final: 86, sem1_final_grade: 86, status: "Passed", semester: "1st Semester" }
      ]
    },
    status: "needs_review",
    uploaded_by: adminUserId
  };

  const { data: stagedDoc1, error: err1 } = await supabase.from("documents").insert(sem1Payload).select().single();
  if (err1) throw new Error("Failed to insert doc 1: " + err1.message);
  console.log("Created doc 1 ID:", stagedDoc1.id);

  console.log("Launching headless Chrome on port 9226...");
  const chromeProc = spawn(chromePath, [
    "--headless=new",
    "--remote-debugging-port=9226",
    "--disable-extensions",
    `--user-data-dir=${userDataDir}`,
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "about:blank",
  ], { stdio: "ignore" });

  let connected = false;
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch("http://127.0.0.1:9226/json/version");
      if (res.ok) { connected = true; break; }
    } catch {
      await new Promise(r => setTimeout(r, 300));
    }
  }

  if (!connected) throw new Error("Could not connect to Chrome port 9226");

  const tabsRes = await fetch("http://127.0.0.1:9226/json/list");
  const tabs = await tabsRes.json();
  const pageTab = tabs.find(t => t.type === "page" && !t.url.startsWith("chrome-extension://")) || tabs[0];
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

  async function setViewport(width, height) {
    await sendCommand("Emulation.setDeviceMetricsOverride", {
      width, height, deviceScaleFactor: 1, mobile: false,
    });
    await new Promise(r => setTimeout(r, 400));
  }

  async function saveScreenshot(filename) {
    const capture = await sendCommand("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: true,
    });
    const localFilePath = path.join(screenshotsDir, filename);
    fs.writeFileSync(localFilePath, Buffer.from(capture.data, "base64"));
    const artifactFilePath = path.join(artifactDir, filename);
    fs.writeFileSync(artifactFilePath, Buffer.from(capture.data, "base64"));
    console.log(`  ✓ Screenshot saved: ${filename}`);
  }

  async function evaluate(expression) {
    const res = await sendCommand("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    return res.result?.value;
  }

  await setViewport(1440, 900);

  // 1. Sign in as Admin
  console.log("\n[1] Signing in as Administrator...");
  await sendCommand("Page.navigate", { url: "http://localhost:3000/login" });
  await new Promise(r => setTimeout(r, 2000));

  await evaluate(`(() => {
    const email = document.getElementById('email');
    const pass = document.getElementById('current-password');
    email.value = 'admin@example.com';
    email.dispatchEvent(new Event('input', { bubbles: true }));
    email.dispatchEvent(new Event('change', { bubbles: true }));
    pass.value = 'Password123!';
    pass.dispatchEvent(new Event('input', { bubbles: true }));
    pass.dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector('form button[type="submit"]').click();
  })()`);
  await new Promise(r => setTimeout(r, 4000));

  const postLoginUrl = await evaluate(`window.location.href`);
  console.log("  Post-login URL:", postLoginUrl);

  // 2. Navigate to Document 1 (Semester 1 only)
  console.log(`\n[2] Navigating to Document 1 (/documents/${stagedDoc1.id})...`);
  await sendCommand("Page.navigate", { url: `http://localhost:3000/documents/${stagedDoc1.id}` });
  await new Promise(r => setTimeout(r, 3000));

  // Verify text "NOT YET AVAILABLE" is rendered
  const hasNotYetAvailable = await evaluate(`document.body.innerText.includes("NOT YET AVAILABLE")`);
  const hasConsolidated = await evaluate(`document.body.innerText.includes("Consolidated Academic Summary")`);
  console.log(`  -> UI rendered 'NOT YET AVAILABLE': ${hasNotYetAvailable}`);
  console.log(`  -> UI rendered 'Consolidated Academic Summary': ${hasConsolidated}`);

  await saveScreenshot("e2e-step4-semester2-not-yet-available.png");

  // 3. Update Document 1 with Semester 2 & Proposed Changes to simulate Stage 2/3
  console.log("\n[3] Updating Document to simulate Consolidated Semesters & Proposed Correction...");
  const bothSemFields = {
    ...sem1Payload.extracted_fields,
    semester: "1st Semester",
    grades: [
      { subject: "Oral Communication", q1: 83, q2: 80, final: 82, sem1_final_grade: 82, status: "Passed", semester: "1st Semester" },
      { subject: "General Mathematics", q1: 85, q2: 87, final: 86, sem1_final_grade: 86, status: "Passed", semester: "1st Semester" },
      { subject: "Reading and Writing Skills", q3: 88, q4: 90, final: 89, sem2_final_grade: 89, status: "Passed", semester: "2nd Semester" },
      { subject: "Statistics and Probability", q3: 84, q4: 86, final: 85, sem2_final_grade: 85, status: "Passed", semester: "2nd Semester" }
    ]
  };

  await supabase.from("documents").update({ extracted_fields: bothSemFields }).eq("id", stagedDoc1.id);
  await sendCommand("Page.navigate", { url: `http://localhost:3000/documents/${stagedDoc1.id}` });
  await new Promise(r => setTimeout(r, 3000));

  await saveScreenshot("e2e-step13-consolidated-both-semesters.png");

  // 4. Cleanup
  console.log("\n[4] Cleaning up test document...");
  await supabase.from("documents").delete().eq("id", stagedDoc1.id);

  ws.close();
  chromeProc.kill();
  console.log("=== End-to-End UI Screen Capture Finished Successfully ===");
}

run().catch(err => {
  console.error("UI capture error:", err);
  process.exit(1);
});
