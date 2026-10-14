export const IpcChannel = {
  WindowMinimize: "window:minimize",
  WindowToggleMaximize: "window:toggle-maximize",
  WindowClose: "window:close",
  WindowStateChanged: "window:state-changed",
  AppInfo: "app:info",
  AppSetTheme: "app:set-theme",
  SystemStats: "system:stats",
  /** Tiến trình chính → giao diện: hộp thư có tin mới */
  InboxChanged: "inbox:changed",
  /** Tiến trình chính → giao diện: mở một trang (vd bấm thông báo hệ thống) */
  AppNavigate: "app:navigate",
  /** Tiến trình chính → giao diện: trạng thái license đổi (hết gói, kích hoạt lại, ngoại tuyến…) */
  LicenseChanged: "license:changed"
};
