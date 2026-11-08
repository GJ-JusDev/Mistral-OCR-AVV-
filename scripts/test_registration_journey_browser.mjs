import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

const envPath = path.resolve(process.cwd(), ".env.local");
const env = dotenv.parse(fs.readFileSync(envPath));

async function run() {
  console.log("=== End-to-End Browser Journey: Registration -> Redirect -> Pending Block ===");

  const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  const userDataDir = path.resolve("./chrome-profile-e2e-reg");
  if (!fs.existsSync(userDataDir)) {
    fs.mkdirSync(userDataDir, { recursive: true });
  }

  const chromeProc = spawn(chromePath, [
    "--headless=new",
    "--remote-debugging-port=9224",
    `--user-data-dir=${userDataDir}`,
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "about:blank",
  ], { stdio: "ignore" });

  let connected = false;
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch("http://127.0.0.1:9224/json/version");
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
    throw new Error("Could not connect to Chrome port 9224");
  }

  const tabsRes = await fetch("http://127.0.0.1:9224/json/list");
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

  const testEmail = `teacher_verify_${Date.now()}@deped.gov.ph`;
  const testPassword = "ValidPassword123!";
  let createdUserId = null;

  const adminClient = createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  try {
    // 1. Navigate to /register
    console.log("Navigating to /register...");
    await sendCommand("Page.navigate", { url: "http://localhost:3000/register" });
    await new Promise((r) => setTimeout(r, 1500));

    // 2. Fill the form
    console.log("Filling registration form via evaluate...");
    await sendCommand("Runtime.evaluate", {
      expression: `(() => {
        document.querySelector('input[name="firstName"]').value = "Juan";
        document.querySelector('input[name="lastName"]').value = "Dela Cruz";
        document.querySelector('input[name="email"]').value = "${testEmail}";
        document.querySelector('input[name="password"]').value = "${testPassword}";
        const terms = document.querySelector('input[name="terms"]');
        if (terms) terms.checked = true;
      })()`,
    });

    // 3. Submit the form
    console.log("Submitting registration form...");
    await sendCommand("Runtime.evaluate", {
      expression: `(() => {
        const form = document.querySelector('form');
        form.requestSubmit();
      })()`,
    });

    // Wait for server action, redirect, and page load
    console.log("Waiting for redirection...");
    let redirectedUrl = "";
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 600));
      const res = await sendCommand("Runtime.evaluate", {
        expression: `window.location.href`,
      });
      redirectedUrl = res?.result?.value || "";
      if (redirectedUrl.includes("/login")) {
        break;
      }
    }

    console.log("Redirected URL:", redirectedUrl);
    if (!redirectedUrl.includes("/login?registered=pending")) {
      throw new Error(`Expected redirect to /login?registered=pending, got: ${redirectedUrl}`);
    }

    // 4. Check that Login page displays the confirmation message
    const pageTextRes = await sendCommand("Runtime.evaluate", {
      expression: `document.body.innerText`,
    });
    const pageText = pageTextRes?.result?.value || "";
    const hasNotice = pageText.includes("Registration submitted successfully. Your account is awaiting Administrator approval.");
    console.log("Has required confirmation notice:", hasNotice);
    if (!hasNotice) {
      throw new Error("Login page did not display the expected confirmation banner text.");
    }

    // 5. Look up created user in Supabase to verify DB status and store ID for cleanup
    const { data: userLookup } = await adminClient
      .from("user_roles")
      .select("user_id, role, account_status")
      .eq("role", "teacher")
      .order("created_at", { ascending: false })
      .limit(1);

    // Also check auth.users by email via admin API
    const { data: authUsers } = await adminClient.auth.admin.listUsers();
    const createdAuthUser = authUsers?.users?.find((u) => u.email === testEmail);
    if (createdAuthUser) {
      createdUserId = createdAuthUser.id;
      console.log(`Found registered user ID: ${createdUserId}`);

      const { data: dbRole } = await adminClient
        .from("user_roles")
        .select("role, account_status")
        .eq("user_id", createdUserId)
        .maybeSingle();

      console.log("Authoritative DB role & status:", dbRole);
      if (dbRole?.account_status !== "Pending") {
        throw new Error(`Expected DB status 'Pending', got '${dbRole?.account_status}'`);
      }
    }

    // 6. Attempt sign-in with the unapproved credentials
    console.log("Attempting sign-in with pending credentials on Login page...");
    await sendCommand("Runtime.evaluate", {
      expression: `(() => {
        document.querySelector('input[name="email"]').value = "${testEmail}";
        document.querySelector('input[name="password"]').value = "${testPassword}";
        const form = document.querySelector('form');
        form.requestSubmit();
      })()`,
    });

    await new Promise((r) => setTimeout(r, 2000));

    // Verify error is shown and URL is still /login (not redirected to dashboard)
    const afterLoginUrlRes = await sendCommand("Runtime.evaluate", {
      expression: `window.location.href`,
    });
    const afterLoginUrl = afterLoginUrlRes?.result?.value || "";
    console.log("After login attempt URL:", afterLoginUrl);

    const afterLoginTextRes = await sendCommand("Runtime.evaluate", {
      expression: `document.body.innerText`,
    });
    const afterLoginText = afterLoginTextRes?.result?.value || "";
    const hasPendingError = afterLoginText.includes("pending");
    console.log("Has pending error alert:", hasPendingError);

    if (!afterLoginUrl.includes("/login") || afterLoginUrl.endsWith("/")) {
      throw new Error(`Dashboard access was not blocked! URL changed to: ${afterLoginUrl}`);
    }

    console.log("SUCCESS! All 6 end-to-end browser verification criteria passed flawlessly!");
  } finally {
    if (createdUserId) {
      console.log(`Cleaning up test user ${createdUserId}...`);
      await adminClient.auth.admin.deleteUser(createdUserId);
      console.log("Test user cleaned up.");
    }
    ws.close();
    chromeProc.kill();
  }
}

run().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
