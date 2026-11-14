import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

async function run() {
  const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  const userDataDir = path.resolve("./mistral-ocr/chrome-profile-e2e-ui");

  const chromeProc = spawn(chromePath, [
    "--headless=new",
    "--remote-debugging-port=9227",
    `--user-data-dir=${userDataDir}`,
    "--disable-gpu",
    "about:blank",
  ], { stdio: "ignore" });

  await new Promise(r => setTimeout(r, 1500));

  const tabsRes = await fetch("http://127.0.0.1:9227/json/list");
  const tabs = await tabsRes.json();
  const pageTab = tabs.find(t => t.type === "page") || tabs[0];
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

  await new Promise(r => ws.onopen = r);
  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = messageId++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  await send("Runtime.enable");
  const evalRes = await send("Runtime.evaluate", {
    expression: "({ url: window.location.href, title: document.title, bodyText: document.body.innerText.slice(0, 500) })",
    returnByValue: true
  });

  console.log("Current state:", evalRes.result?.value);

  ws.close();
  chromeProc.kill();
}
run();
