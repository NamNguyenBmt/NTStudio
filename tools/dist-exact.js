// Đóng gói bộ cài NSIS cho ra Setup.exe trùng từng byte với bản phát hành 1.0.2.
// Dùng: npm run build && node tools/dist-exact.js
//
// electron-builder 25.1.8 ghi messages.yml và assistedMessages.yml song song rồi !include
// file nào ghi xong trước. Thứ tự include quyết định thứ tự bảng ngôn ngữ trong bộ cài
// (header NSIS, dialog trong stub, uninstaller). Bản gốc rơi vào thứ tự assistedMessages trước,
// nên ở đây ép messages.yml chờ assistedMessages.yml xong rồi mới include.
const nsisLang = require("app-builder-lib/out/targets/nsis/nsisLang");

const original = nsisLang.addCustomMessageFileInclude;
const pending = new Map();

function deferredFor(scriptGenerator) {
  let entry = pending.get(scriptGenerator);
  if (entry == null) {
    let resolve;
    const promise = new Promise((r) => (resolve = r));
    entry = { promise, resolve };
    pending.set(scriptGenerator, entry);
  }
  return entry;
}

nsisLang.addCustomMessageFileInclude = async (input, packager, scriptGenerator, langConfigurator) => {
  const entry = deferredFor(scriptGenerator);
  if (input === "messages.yml") {
    await entry.promise;
    return original(input, packager, scriptGenerator, langConfigurator);
  }
  try {
    return await original(input, packager, scriptGenerator, langConfigurator);
  } finally {
    entry.resolve();
  }
};

// NSIS ghi kèm thời điểm sửa (mtime) của từng file được đóng vào bộ cài. Hai file do electron-builder
// tạo lúc build là gói app-64.7z và uninstaller; đặt mtime của chúng về đúng lúc build bản gốc
// (đọc từ header NSIS của Omnira Studio Setup 1.0.2.exe).
const fs = require("fs");
require("app-builder-lib"); // nạp index trước, tránh lỗi import vòng khi require thẳng NsisTarget
const { NsisTarget } = require("app-builder-lib/out/targets/nsis/NsisTarget");

const ORIGINAL_MTIMES = {
  APP_64: new Date("2026-10-14T05:39:40Z"),
  UNINSTALLER_OUT_FILE: new Date("2026-10-14T05:39:44Z"),
};

const executeMakensis = NsisTarget.prototype.executeMakensis;
NsisTarget.prototype.executeMakensis = function (defines, commands, script) {
  for (const [key, time] of Object.entries(ORIGINAL_MTIMES)) {
    const file = defines[key];
    if (file != null && fs.existsSync(file)) fs.utimesSync(file, time, time);
  }
  return executeMakensis.call(this, defines, commands, script);
};

process.argv =[process.argv[0], "electron-builder", "--win", "--x64"];
require("electron-builder/out/cli/cli");
