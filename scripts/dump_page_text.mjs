import { spawn } from "node:child_process";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import fs from "node:fs";

const env = dotenv.parse(fs.readFileSync(".env.local"));
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  const docRes = await supabase.from("documents").select("id").limit(1);
  const docId = docRes.data[0]?.id;
  console.log("Doc ID:", docId);

  const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  const userDataDir = path.resolve("./chrome-profile-e2e-ui");
  const chromeProc = spawn(chromePath, [
    "--headless=new",
    "--remote-debugging-port=9228",
    `--user-data-dir=${userDataDir}`,
    "--disable-gpu",
    "about:blank",
  ], { stdio: "ignore" });

  await new Promise(r => setTimeout(r, 1200));

  const tabsRes = await fetch("http://127.0.0.1:9228/json/list");
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
  await send("Page.navigate", { url: "http://localhost:3000/documents/" + docId });
  await new Promise(r => setTimeout(r, 3000));

  const res = await send("Runtime.evaluate", {
    expression: "document.body.innerText",
    returnByValue: true
  });

  console.log("PAGE TEXT DUMP:\n" + res.result?.value?.slice(0, 1500));
  ws.close();
  chromeProc.kill();
}
run();
