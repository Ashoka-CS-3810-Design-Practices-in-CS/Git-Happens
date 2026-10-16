//  Black-box checks of the real page in a browser.
// Opens index.html straight from the folder (file://, no server), loads the demo calendar and fails on any page error.
//
//   npm install --no-save playwright && npx playwright install chromium
//   npm run test:ui
//
import { chromium } from "playwright";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";
 
const root = process.env.APP_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const page_url = pathToFileURL(path.join(root, "index.html")).href;
const executablePath = process.argv[2];
 
const browser = await chromium.launch(executablePath ? { executablePath } : {});
const errors = [];
let failed = 0;
 
async function check(name, fn) {
  try {
    await fn();
    console.log("ok   " + name);
  } catch (e) {
    failed++;
    console.log("FAIL " + name + "\n     " + e.message.split("\n")[0]);
  }
}
 
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error" && !/fonts\.g/.test(m.text())) errors.push(m.text()); });
page.on("dialog", (d) => d.accept());
await page.goto(page_url);
await page.click("#demo");
await page.waitForTimeout(300);
 
await check("the week shows the demo events", async () => {
  assert.ok(await page.locator(".cl-event").count() > 10);
});
 
await check("ER2: the clash on Wed 14 is outlined and labelled, and both events stay", async () => {
  assert.ok(await page.locator(".cl-event.is-conflict").count() >= 2);
  assert.ok(await page.locator(".cl-overlap__label").count() >= 1);
});
 
await check("clicking the overlap label opens the clash pop-up", async () => {
  await page.locator(".cl-overlap__label").first().click();
  await page.locator(".cl-popover", { hasText: "Overlap" }).waitFor();
  await page.keyboard.press("Escape");
});
 
await check("ER1: an end before the start is marked on the End field and Save is disabled", async () => {
  await page.locator(".cl-event").first().click();
  await page.fill("#ed-end", "08:00");
  await page.locator("#ed-end-err").waitFor();
  assert.equal(await page.locator("#ed-end").getAttribute("aria-invalid"), "true");
  assert.equal(await page.locator(".panel__foot .cl-btn--primary").isDisabled(), true);
  await page.keyboard.press("Escape");
});
 
await check("Find a time shows up to three ranked cards with four score bars", async () => {
  await page.locator(".task .link", { hasText: "Find a time" }).first().click();
  await page.locator(".panel button[type=submit]", { hasText: "Find times" }).click();
  await page.locator(".cl-rec").first().waitFor();
  const cards = await page.locator(".cl-rec").count();
  assert.ok(cards >= 1 && cards <= 3);
  assert.equal(await page.locator(".cl-rec").first().locator(".cl-bar").count(), 4);
});
 
await check("Add to calendar places the task and takes it off Unplaced", async () => {
  const before = await page.locator(".task").count();
  await page.locator(".cl-rec.is-chosen button", { hasText: "Add to calendar" }).click();
  await page.waitForTimeout(200);
  assert.equal(await page.locator(".task").count(), before - 1);
});
 
await check("ER4: a full day shows the no-slot message with one-tap fixes", async () => {
  await page.locator("#new-task").click();
  await page.fill("#tk-name", "Long read");
  await page.locator(".panel button[type=submit]").click();
  await page.locator(".task .link", { hasText: "Find a time" }).last().click();
  await page.fill("#ft-day", "2026-10-19");
  await page.locator(".panel button[type=submit]", { hasText: "Find times" }).click();
  await page.locator(".cl-empty").waitFor();
  assert.match(await page.locator(".cl-empty__title").textContent(), /^No free 1h on Mon 19 Oct/);
  assert.ok(await page.locator(".cl-empty__actions button").count() >= 1);
});
 
await check("ER3: a window shorter than the task offers the fixes", async () => {
  await page.fill("#ft-day", "2026-10-15");
  await page.fill("#ft-start", "14:00");
  await page.fill("#ft-end", "14:30");
  await page.locator(".panel button[type=submit]", { hasText: "Find times" }).click();
  await page.locator(".cl-callout--danger", { hasText: "Window too short" }).waitFor();
  await page.keyboard.press("Escape");
});
 
let dragged = null;
await check("dragging an event moves it and the change is saved", async () => {
  const block = page.locator(".cl-event").first();
  const id = await block.getAttribute("data-id");
  const before = await page.evaluate((i) => window.app.store.getEvent(i).start, id);
  await page.evaluate((m) => { document.getElementById("main").scrollTop = m - 120; }, before); 
  const box = await block.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + 8);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + 38, { steps: 5 });
  await page.mouse.move(box.x + box.width / 2, box.y + 68, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  const after = await page.evaluate((i) => window.app.store.getEvent(i).start, id);
  assert.equal(after, before + 60, "start moved from " + before + " to " + after);
  dragged = { id, before };
  assert.ok(await page.evaluate(() => localStorage.getItem("smartScheduler.data").length > 100));
});
 
await check("undo puts the event back", async () => {
  await page.locator(".cl-toast button", { hasText: "Undo" }).last().click();
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate((i) => window.app.store.getEvent(i).start, dragged.id), dragged.before);
});
 
await check("reloading the page keeps the calendar", async () => {
  const count = await page.evaluate(() => window.app.store.size);
  await page.reload();
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => window.app.store.size), count);
});
 
await check("phone width shows one day and the bottom tabs, with no sideways scroll", async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.waitForTimeout(300);
  assert.equal(await page.locator(".cl-col").count(), 1);
  assert.ok(await page.locator(".tabs").isVisible());
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
});
 
await check("no page errors", async () => {
  assert.deepEqual(errors, []);
});
 
await browser.close();
console.log(failed ? failed + " check(s) failed" : "all checks passed");
process.exit(failed ? 1 : 0);