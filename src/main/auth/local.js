import { randomBytes } from "node:crypto";
import { readStore, createUser } from "./store";
import { hasLegacyData, adoptLegacyData } from "./session";

// Bản dùng một mình, không server: không có màn đăng nhập – tự mở dữ liệu của tài khoản trên máy.
// Máy đã có tài khoản → mở tài khoản dùng gần nhất (giữ nguyên dữ liệu cũ); chưa có → tạo một tài khoản nội bộ.
export async function localUser() {
  const users = readStore().users;
  if (users.length) return [...users].sort((a, b) => (b.lastLoginAt ?? 0) - (a.lastLoginAt ?? 0))[0];
  const user = await createUser({
    email: "local@ntstudio.app",
    displayName: "NT Studio",
    // Không ai đăng nhập bằng mật khẩu này – chỉ để bản ghi tài khoản hợp lệ
    password: randomBytes(24).toString("base64url"),
    provider: "local"
  });
  if (hasLegacyData()) {
    try {
      adoptLegacyData(user.id);
    } catch (err) {
      console.error("[auth] chuyển dữ liệu cũ lỗi", err);
    }
  }
  return user;
}
