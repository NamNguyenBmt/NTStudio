import { app } from "electron";
import { existsSync } from "node:fs";
import { join } from "node:path";

// Đổi tên app từ "Omnira Studio" sang "NT Studio" làm thư mục userData mặc định đổi theo (%APPDATA%\NT Studio).
// Máy đã cài bản cũ thì tiếp tục dùng thư mục cũ để không mất đăng nhập, kênh, video, lịch đăng.
// Phải chạy trước requestSingleInstanceLock và mọi chỗ đọc userData → import đầu tiên trong index.js.
const legacy = join(app.getPath("appData"), "Omnira Studio");
if (!app.commandLine.hasSwitch("user-data-dir") && existsSync(legacy)) app.setPath("userData", legacy);
