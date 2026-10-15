import { BookOpenText, CalendarDays, ChartColumn, Clapperboard, CreditCard, Film, FolderOpen, Inbox, Layers, LayoutDashboard, Lightbulb, PlugZap, Repeat2, Settings, UsersRound } from "lucide-react";

export const navItems = [
  { path: "/", label: "Tổng quan", icon: LayoutDashboard, shortcut: "Ctrl+1" },
  { path: "/workspaces", label: "Không gian làm việc", icon: Layers, shortcut: "Ctrl+2" },
  { path: "/accounts", label: "Quản lý Tài khoản & Trang", icon: UsersRound, shortcut: "Ctrl+3" },
  { path: "/plan", label: "Kế hoạch nội dung", icon: Lightbulb },
  { path: "/content", label: "Kho nội dung", icon: FolderOpen, shortcut: "Ctrl+4" },
  { path: "/series", label: "Series AI", icon: BookOpenText, feature: "SERIES" },
  { path: "/studio", label: "Xưởng Video AI", icon: Clapperboard, shortcut: "Ctrl+5", feature: "STUDIO" },
  { path: "/film", label: "Xưởng Phim", icon: Film, feature: "FILM" },
  { path: "/reup", label: "Reup", icon: Repeat2 },
  { path: "/calendar", label: "Lịch đăng bài", icon: CalendarDays, shortcut: "Ctrl+6", feature: "CALENDAR" },
  { path: "/inbox", label: "Hộp thư hợp nhất", icon: Inbox, shortcut: "Ctrl+7", feature: "INBOX" },
  { path: "/analytics", label: "Phân tích", icon: ChartColumn, feature: "ANALYTICS" },
  { path: "/billing", label: "Gói & thanh toán", icon: CreditCard },
  { path: "/settings", label: "Cài đặt", icon: Settings, shortcut: "Ctrl+8" },
  { path: "/guide", label: "Hướng dẫn kết nối", icon: PlugZap }
];
