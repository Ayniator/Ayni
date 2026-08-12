import { chromium } from "playwright";
const base = "https://aha.a13z.org:8443";
const b = await chromium.launch();
const langs = ["en","fr","th","ar","qu"];
const routes = ["/","/twelve-steps","/reflections","/me"];
for (const lang of langs) {
  const ctx = await b.newContext({ ignoreHTTPSErrors: true });
  await ctx.addInitScript(l => localStorage.setItem("aha:lang", l), lang);
  for (const r of routes) {
    const page = await ctx.newPage();
    await page.goto(base + r, { waitUntil: "networkidle", timeout: 45000 });
    await page.waitForTimeout(600);
    const info = await page.evaluate(() => ({
      h1: document.querySelector("h1")?.innerText.trim(),
      nav: document.querySelector("header.nav nav")?.innerText.replace(/\s+/g," ").trim(),
      mainLen: document.querySelector("main")?.innerText.length,
      firstP: document.querySelector("main p")?.innerText.slice(0,60),
    }));
    console.log(`${lang} ${r}\n   h1=${JSON.stringify(info.h1)}\n   nav=${JSON.stringify(info.nav)}\n   p=${JSON.stringify(info.firstP)}`);
    await page.close();
  }
  await ctx.close();
}
// reflections variance in same lang
console.log("\n=== /reflections determinism (en, 2 loads) ===");
{
  const ctx = await b.newContext({ ignoreHTTPSErrors: true });
  for (let i=0;i<2;i++){
    const p = await ctx.newPage();
    await p.goto(base+"/reflections",{waitUntil:"networkidle"});
    await p.waitForTimeout(1500);
    const t = await p.evaluate(()=>document.querySelector("main").innerText);
    console.log(`load${i} len=${t.length} :: ${JSON.stringify(t.slice(0,180))}`);
    await p.close();
  }
  await ctx.close();
}
await b.close();
