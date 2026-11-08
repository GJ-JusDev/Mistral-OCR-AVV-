import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";

async function run() {
  console.log("=== Testing Login & Registration with Valid and Invalid Inputs ===");

  const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  const userDataDir = path.resolve("./chrome-profile-formtest");
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

  // Wait for port 9224
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
    throw new Error("Could not connect to Chrome on port 9224");
  }

  const tabsRes = await fetch("http://127.0.0.1:9224/json/list");
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

  // 1. Test Login Form Invalid Submission (Browser Validation)
  console.log("\n1. Navigating to /login...");
  await sendCommand("Page.navigate", { url: "http://localhost:3000/login" });
  await new Promise((r) => setTimeout(r, 1500));

  console.log("Checking form attributes on /login...");
  const loginFormCheck = await evaluate(`(() => {
    const emailInput = document.getElementById('email');
    const passwordInput = document.getElementById('current-password');
    const submitBtn = document.querySelector('button[type="submit"]');
    return {
      emailRequired: emailInput?.required,
      emailType: emailInput?.type,
      passwordRequired: passwordInput?.required,
      buttonText: submitBtn?.textContent?.trim()
    };
  })()`);
  console.log("Login form attributes:", loginFormCheck);
  assert.strictEqual(loginFormCheck.emailRequired, true, "Email must be required");
  assert.strictEqual(loginFormCheck.emailType, "email", "Email must be type email");
  assert.strictEqual(loginFormCheck.passwordRequired, true, "Password must be required");
  assert.strictEqual(loginFormCheck.buttonText, "Sign In", "Button must say Sign In");

  // Test submitting invalid credentials to trigger server action error banner
  console.log("Submitting invalid credentials to test server error display...");
  await evaluate(`(() => {
    const emailInput = document.getElementById('email');
    const passwordInput = document.getElementById('current-password');
    emailInput.value = 'invalid.faculty@example.com';
    passwordInput.value = 'WrongPassword123!';
    const submitBtn = document.querySelector('button[type="submit"]');
    submitBtn.click();
  })()`);
  await new Promise((r) => setTimeout(r, 2500));

  const loginErrorMsg = await evaluate(`(() => {
    const alertEl = document.querySelector('[role="alert"]');
    return alertEl ? alertEl.textContent : null;
  })()`);
  console.log("-> Login error returned and rendered:", loginErrorMsg);
  assert.ok(loginErrorMsg && loginErrorMsg.length > 0, "Login must display role=alert on invalid credentials");

  // 2. Test Registration Form Validation
  console.log("\n2. Navigating to /register...");
  await sendCommand("Page.navigate", { url: "http://localhost:3000/register" });
  await new Promise((r) => setTimeout(r, 1500));

  console.log("Checking form attributes and validation pattern on /register...");
  const registerFormCheck = await evaluate(`(() => {
    const firstName = document.getElementById('firstName');
    const lastName = document.getElementById('lastName');
    const email = document.getElementById('reg-email');
    const password = document.getElementById('new-password');
    const terms = document.getElementById('terms');
    const submitBtn = document.querySelector('button[type="submit"]');
    return {
      firstNameRequired: firstName?.required,
      lastNameRequired: lastName?.required,
      emailRequired: email?.required,
      emailType: email?.type,
      passwordRequired: password?.required,
      passwordPattern: password?.pattern,
      passwordMinLength: password?.minLength,
      termsRequired: terms?.required,
      buttonText: submitBtn?.textContent?.trim()
    };
  })()`);
  console.log("Register form attributes:", registerFormCheck);
  assert.strictEqual(registerFormCheck.firstNameRequired, true, "First Name must be required");
  assert.strictEqual(registerFormCheck.lastNameRequired, true, "Last Name must be required");
  assert.strictEqual(registerFormCheck.emailRequired, true, "Email must be required");
  assert.strictEqual(registerFormCheck.passwordRequired, true, "Password must be required");
  assert.strictEqual(registerFormCheck.passwordMinLength, 8, "Password min length must be 8");
  assert.strictEqual(registerFormCheck.termsRequired, true, "Terms must be required");
  assert.strictEqual(registerFormCheck.buttonText, "Create account", "Submit button must say Create account");

  // Test client pattern check: invalid password pattern
  const patternRegex = new RegExp(registerFormCheck.passwordPattern);
  assert.strictEqual(patternRegex.test("short"), false, "Password 'short' must fail complexity regex");
  assert.strictEqual(patternRegex.test("alllowercase123"), false, "Password without uppercase must fail regex");
  assert.strictEqual(patternRegex.test("ALLUPPERCASE123"), false, "Password without lowercase must fail regex");
  assert.strictEqual(patternRegex.test("NoNumbersHere!"), false, "Password without number must fail regex");
  assert.strictEqual(patternRegex.test("ValidPass123!"), true, "Valid password with upper, lower, & number must pass regex");
  console.log("✓ Password complexity regex correctly validates upper, lower, numbers, and 8+ characters");

  // Test Password toggle button with React state cycle
  const typeBefore = await evaluate(`document.getElementById('new-password').type`);
  await evaluate(`document.querySelector('#new-password ~ button').click()`);
  await new Promise((r) => setTimeout(r, 300));
  const typeAfter = await evaluate(`document.getElementById('new-password').type`);
  await evaluate(`document.querySelector('#new-password ~ button').click()`);
  await new Promise((r) => setTimeout(r, 300));
  const typeFinal = await evaluate(`document.getElementById('new-password').type`);
  
  const toggleResult = { typeBefore, typeAfter, typeFinal };
  console.log("Password visibility toggle result:", toggleResult);
  assert.strictEqual(toggleResult.typeBefore, "password", "Initially password type");
  assert.strictEqual(toggleResult.typeAfter, "text", "After click text type");
  assert.strictEqual(toggleResult.typeFinal, "password", "After second click password type");

  console.log("\n✓ All Login & Registration valid and invalid input tests completed successfully!");

  try {
    ws.close();
    chromeProc.kill();
  } catch (e) {
    // ignore
  }
}

run().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
