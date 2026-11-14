import { spawn } from "node:child_process";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import fs from "node:fs";

const env = dotenv.parse(fs.readFileSync(".env.local"));
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  const { data: stagedDoc } = await supabase.from("documents").insert({
    school_id: "a0000000-0000-0000-0000-000000000001",
    document_type: "sf9",
    image_url: "doc.png",
    school_year: "2024-2025",
    grade_level: "Grade 11",
    semester: "1st Semester",
    extracted_fields: {
      lrn: "123456789012",
      first_name: "JUAN",
      last_name: "DELA CRUZ",
      school_year: "2024-2025",
      semester: "1st Semester",
      grades: [
        { subject: "Oral Communication", q1: 78, q2: 80, final: 79, status: "Passed", semester: "1st Semester" }
      ]
    },
    status: "needs_review",
    uploaded_by: "135baa53-7e1e-4c1f-b76a-f32a915b5f21"
  }).select().single();

  const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  const userDataDir = path.resolve("./chrome-profile-e2e-ui");
  const chromeProc = spawn(chromePath, [
    "--headless=new",
    "--remote-debugging-port=9229",
    `--user-data-dir=${userDataDir}`,
    "--disable-gpu",
    "about:blank",
  ], { stdio: "ignore" });

  await new Promise(r => setTimeout(r, 1200));

  const tabsRes = await fetch("http://127.0.0.1:9229/json/list");
  const tabs = await tabsRes.json();
  const ws = new WebSocket(tabs[0].webSocketDebuggerUrl);

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

  // Sign in
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

  await send("Page.navigate", { url: "http://localhost:3000/documents/" + stagedDoc.id });
  await new Promise(r => setTimeout(r, 4000));

  const res = await send("Runtime.evaluate", {
    expression: "({ url: window.location.href, text: document.body.innerText })",
    returnByValue: true
  });

  console.log("NAVIGATED URL:", res.result?.value?.url);
  console.log("PAGE TEXT HEAD (800 chars):", res.result?.value?.text?.slice(0, 800));

  await supabase.from("documents").delete().eq("id", stagedDoc.id);

  ws.close();
  chromeProc.kill();
}
run();
