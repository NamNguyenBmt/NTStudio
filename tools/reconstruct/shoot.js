// Launch an Electron app dir with an isolated profile, capture screenshot + DOM text + console errors.
// usage: node shoot.js <appDir> <userDataDir> <outPrefix> [hash-route ...]
const { _electron } = require("E:/Omnira Studio Source/node_modules/playwright-core");
const fs = require("fs");
const [appDir, ud, out, ...routes] = process.argv.slice(2);
(async () => {
  const app = await _electron.launch({
    executablePath: "E:/Omnira Studio Source/node_modules/electron/dist/electron.exe",
    args: [appDir, `--user-data-dir=${ud}`],
    cwd: appDir,
  });
  const errors = [];
  const win = await app.firstWindow();
  win.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  win.on("pageerror", (e) => errors.push("PAGEERROR " + e.message));
  await win.setViewportSize({ width: 1440, height: 900 }).catch(() => {});
  await win.waitForTimeout(5000);
  const shots = [["start", null], ...routes.map((r) => [r.replace(/\W+/g, "_"), r])];
  for (const [name, route] of shots) {
    if (route) { await win.evaluate((r) => { location.hash = r; }, route); await win.waitForTimeout(2500); }
    await win.screenshot({ path: `${out}-${name}.png` });
    fs.writeFileSync(`${out}-${name}.txt`, await win.evaluate(() => document.body.innerText));
    fs.writeFileSync(`${out}-${name}.html`, await win.evaluate(() => document.getElementById("root").innerHTML));
  }
  fs.writeFileSync(`${out}-errors.txt`, errors.join("\n"));
  await app.close();
  console.log("done", out, "errors:", errors.length);
})().catch((e) => { console.error(e); process.exit(1); });
