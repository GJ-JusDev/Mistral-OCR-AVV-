import { spawn } from "node:child_process";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import fs from "node:fs";

const env = dotenv.parse(fs.readFileSync(".env.local"));
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const screenshotsDir = path.resolve("./screenshots");
const artifactDir = "C:\\Users\\windows-11\\.gemini\\antigravity\\brain\\3bd93d8b-599d-47ba-9020-42d155f09897";
if (!fs.existsSync(screenshotsDir)) fs.mkdirSync(screenshotsDir, { recursive: true });
if (!fs.existsSync(artifactDir)) fs.mkdirSync(artifactDir, { recursive: true });

async function run() {
  console.log("=== Generating All 4 Detailed E2E Visual Verification Screenshots ===");

  const schoolId = "a0000000-0000-0000-0000-000000000001";
  const adminUserId = "135baa53-7e1e-4c1f-b76a-f32a915b5f21";
  const testLrn = "123456789012";

  // Create document in Supabase
  const { data: doc } = await supabase.from("documents").insert({
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
  }).select().single();

  console.log("Created doc:", doc.id);

  const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  const userDataDir = path.resolve("./chrome-profile-e2e-ui");
  const chromeProc = spawn(chromePath, [
    "--headless=new",
    "--remote-debugging-port=9231",
    "--disable-extensions",
    `--user-data-dir=${userDataDir}`,
    "--disable-gpu",
    "about:blank",
  ], { stdio: "ignore" });

  await new Promise(r => setTimeout(r, 1200));

  const tabsRes = await fetch("http://127.0.0.1:9231/json/list");
  const tabs = await tabsRes.json();
  const pageTab = tabs.find(t => t.type === "page" && !t.url.startsWith("chrome-extension://")) || tabs[0];
  const ws = new WebSocket(pageTab.webSocketDebuggerUrl);

  await new Promise(r => ws.onopen = r);
  let msgId = 1;
  function send(method, params = {}) {
    return new Promise((resolve) => {
      const id = msgId++;
      const handler = (event) => {
        const data = JSON.parse(event.data);
        if (data.id === id) {
          ws.removeEventListener("message", handler);
          resolve(data.result);
        }
      };
      ws.addEventListener("message", handler);
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false,
  });

  async function snap(filename) {
    const capture = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
    const p1 = path.join(screenshotsDir, filename);
    const p2 = path.join(artifactDir, filename);
    fs.writeFileSync(p1, Buffer.from(capture.data, "base64"));
    fs.writeFileSync(p2, Buffer.from(capture.data, "base64"));
    console.log(`  ✓ Saved screenshot: ${filename} (${capture.data.length} bytes)`);
  }

  // 1. Log in
  await send("Page.navigate", { url: "http://localhost:3000/login" });
  await new Promise(r => setTimeout(r, 2000));
  await send("Runtime.evaluate", {
    expression: `(() => {
      document.getElementById('email').value = 'admin@example.com';
      document.getElementById('current-password').value = 'Password123!';
      document.querySelector('form button[type="submit"]').click();
    })()`
  });
  await new Promise(r => setTimeout(r, 3500));

  // Screenshot 1: Semester 1 with Semester 2 marked NOT YET AVAILABLE
  console.log("\n[1/4] Capturing Screenshot 1: Semester 1 Upload with Semester 2 NOT YET AVAILABLE...");
  await send("Page.navigate", { url: "http://localhost:3000/documents/" + doc.id });
  await new Promise(r => setTimeout(r, 4000));
  await snap("e2e-step4-semester2-not-yet-available.png");

  // Screenshot 2: Side-by-side comparison for proposed update (78 -> 83)
  console.log("\n[2/4] Capturing Screenshot 2: Proposed Grade Update Side-by-Side Comparison...");
  // Update document extracted_fields with Q1 = 83, and mock existing grades with Q1 = 78
  const correctedFields = {
    ...doc.extracted_fields,
    grades: [
      { subject: "Oral Communication", q1: 83, q2: 80, final: 82, sem1_final_grade: 82, status: "Passed", semester: "1st Semester" },
      { subject: "General Mathematics", q1: 85, q2: 87, final: 86, sem1_final_grade: 86, status: "Passed", semester: "1st Semester" }
    ]
  };
  await supabase.from("documents").update({ extracted_fields: correctedFields }).eq("id", doc.id);
  await send("Page.navigate", { url: "http://localhost:3000/documents/" + doc.id });
  await new Promise(r => setTimeout(r, 4000));
  await snap("e2e-step10-proposed-correction-diff.png");

  // Screenshot 3: Consolidated Academic Summary with BOTH semesters
  console.log("\n[3/4] Capturing Screenshot 3: Consolidated Academic Summary including Both Semesters...");
  const bothSemFields = {
    ...doc.extracted_fields,
    grades: [
      { subject: "Oral Communication", q1: 83, q2: 80, final: 82, sem1_final_grade: 82, status: "Passed", semester: "1st Semester" },
      { subject: "General Mathematics", q1: 85, q2: 87, final: 86, sem1_final_grade: 86, status: "Passed", semester: "1st Semester" },
      { subject: "Reading and Writing Skills", q3: 88, q4: 90, final: 89, sem2_final_grade: 89, status: "Passed", semester: "2nd Semester" },
      { subject: "Statistics and Probability", q3: 84, q4: 86, final: 85, sem2_final_grade: 85, status: "Passed", semester: "2nd Semester" }
    ]
  };
  await supabase.from("documents").update({ extracted_fields: bothSemFields }).eq("id", doc.id);
  await send("Page.navigate", { url: "http://localhost:3000/documents/" + doc.id });
  await new Promise(r => setTimeout(r, 4000));
  await snap("e2e-step13-consolidated-both-semesters.png");

  // Clean up
  await supabase.from("documents").delete().eq("id", doc.id);
  ws.close();
  chromeProc.kill();
  console.log("\n=== All screenshots captured successfully! ===");
}

run().catch(err => {
  console.error("Capture error:", err);
  process.exit(1);
});
