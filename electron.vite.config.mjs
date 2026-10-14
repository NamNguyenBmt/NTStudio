import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";

// Bản phát hành không nén mã (minify: false) để log lỗi trong production còn đọc được tên hàm/biến.
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: { minify: false },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: { minify: false },
  },
  renderer: {
    plugins: [react()],
    build: { minify: false },
  },
});
