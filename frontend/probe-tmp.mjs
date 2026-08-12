import { chromium } from "playwright";
const base = "https://aha.a13z.org:8443";
const routes = ["/","/onboarding","/reflections","/twelve-steps","/twelve-traditions","/board","/documents","/me","/inbox","/wallet","/recovery","/recovery/setup","/settings-security","/create","/foundation"];
const b = await chromium.launch();
const ctx = await b.newContext({ ignoreHTTPSErrors: true });
for (const r of routes) {
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", e => errs.push("PAGEERROR: " + e.message));
  page.on("console", m => { if (m.type() === "error") errs.push("CONSOLE: " + m.text()); });
  let status = "?";
  try {
    const resp = await page.goto(base + r, { waitUntil: "networkidle", timeout: 45000 });
    status = resp && resp.status();
  } catch (e) { status = "NAV_FAIL " + e.message.slice(0,120); }
  const info = await page.evaluate(() => ({
    h1: Array.from(document.querySelectorAll("h1")).map(h=>h.textContent.trim()),
    text: document.body.innerText,
  })).catch(e => ({h1:[],text:"EVAL_FAIL "+e.message}));
  const RE = /\b(nav|home|me|admin|board|create|onboarding|inbox|reflections|documents|notifications|member|msg|recovery|shard|twelve|wallet|foundation|brand|ctl)\.[a-zA-Z][a-zA-Z0-9.]*/g;
  const hits = [...new Set((info.text.match(RE)||[]))];
  console.log(`\n### ${r} -> ${status}`);
  console.log("H1:", JSON.stringify(info.h1));
  console.log("RAWKEY-CANDIDATES:", JSON.stringify(hits));
  console.log("ERRS:", JSON.stringify(errs.slice(0,8)));
  console.log("TEXTLEN:", info.text.length);
  await page.close();
}
await b.close();
