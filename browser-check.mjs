import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on("pageerror", e => errors.push(e.message));
page.on("console", m => { if (m.type() === "error") errors.push("[console] " + m.text()); });

// Start on Profile, like the user
await page.goto("http://localhost:5173/#profile", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(9000); // allow Supabase data load

// Fill the modelled rank + category on the Profile tab
const rankInput = page.locator("input[placeholder='e.g. 12847']");
await rankInput.fill("");
await rankInput.fill("85000");
// the Category select on profile (options UR/EWS/OBC-NCL/SC/ST)
const catSelect = page.locator("select").filter({ hasText: "OBC-NCL" }).first();
await catSelect.selectOption("EWS");
await page.waitForTimeout(800);
console.log("Filled Profile: rank 85000 / EWS");

// Go to Predictions tab
await page.goto("http://localhost:5173/#predictions", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1500);
const predRows = await page.locator("table.table tbody tr").count();
const emptyBox = (await page.locator(".empty .big").innerText().catch(() => "")) || "(none)";
console.log(`PREDICTIONS tab: table-rows=${predRows}  emptyBox="${emptyBox}"`);

// Go to Home tab
await page.goto("http://localhost:5173/#home", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1500);
const cards = await page.locator(".home-card").count();
const meta = await page.locator(".hero-meta .right").innerText().catch(() => "?");
const rankShown = await page.locator(".home-inputs input[type='number']").inputValue().catch(() => "?");
console.log(`HOME tab: cards=${cards}  meta="${meta}"  rankInInput="${rankShown}"`);

console.log("\nerrors:", errors.join("\n") || "(none)");
await browser.close();
