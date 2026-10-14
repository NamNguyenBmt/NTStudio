# Omnira Studio – mã nguồn dựng lại (v1.0.2)

Mã nguồn được dựng lại từ bản phát hành **Omnira Studio 1.0.2** (`app.asar` trong `Omnira Studio Setup 1.0.2.exe`, build bằng electron-vite).
Lịch sử git: tag `v1.0.1` là bản dựng lại từ 1.0.1, commit kế tiếp (tag `v1.0.2`) là thay đổi của 1.0.2
(`git diff v1.0.1 v1.0.2` để xem 1.0.2 đổi gì: cơ chế thử lại Google Flow khi lỗi tạm thời, thẻ "Nguồn tạo ảnh & video" trong Cài đặt).
Bản build lại từ thư mục này cho ra ứng dụng chạy giống bản gốc (chi tiết kiểm chứng ở cuối file).

## Chạy & đóng gói

```bash
npm install            # postinstall tự build better-sqlite3 cho Electron
npm run dev            # chạy dev (electron-vite, hot reload renderer)
npm run build          # build ra out/
npm run dist           # build + tạo bộ cài NSIS: dist/Omnira Studio Setup 1.0.2.exe
```

Nếu `npm install` chạy với `--ignore-scripts` thì cần chạy thêm:
`node node_modules/electron/install.js`, `node node_modules/ffmpeg-static/install.js`, `npx electron-builder install-app-deps`.

Trên Windows chưa bật Developer Mode, electron-builder có thể lỗi khi giải nén `winCodeSign` (không tạo được symlink macOS).
Cách xử lý: bật Developer Mode, hoặc giải nén `winCodeSign-2.6.0.7z` vào
`%LOCALAPPDATA%\electron-builder\Cache\winCodeSign\winCodeSign-2.6.0` (bỏ qua lỗi symlink).

## Cấu trúc

```
src/
  main/        tiến trình chính (116 module): db (drizzle + better-sqlite3), ai (router + adapter Anthropic/Gemini/OpenAI…),
               flow (Google Flow qua playwright), tts, media (ffmpeg, render), publish (Facebook/Instagram/TikTok/YouTube),
               inbox, analytics, film, license, auth, api/* (các handler IPC "api:<nhóm>.<hàm>"), tray, window
  preload/     cầu nối window.omni (contextBridge)
  shared/      mã dùng chung main ↔ renderer: ipc, api, contract (zod), providers, pricing, features, video, film,
               content-formats, upscale, hook, goals
  renderer/    React 18 + react-router (HashRouter) + TanStack Query + zustand + framer-motion + Tailwind 3
    src/app, components (ui, shell, billing, film, icons), lib, stores, pages/* (mỗi màn hình một thư mục)
drizzle/       migration SQL + snapshot (đóng gói vào resources/drizzle)
resources/     icon.png, fonts/Montserrat-Black.ttf (dùng cho phụ đề ffmpeg)
tools/reconstruct/  công cụ đã dùng để tách bundle → mã nguồn (không thuộc bản build), xem bên dưới
```

## Những gì khôi phục được / không khôi phục được

- **Giữ nguyên:** toàn bộ logic, chuỗi tiếng Việt, comment trong main process (bản build không nén mã),
  tên hàm/biến/component gốc, cấu trúc JSX, CSS (biến theme + comment), cấu hình Tailwind suy ra từ CSS đã biên dịch.
- **Đã khôi phục tự động:** chia file module, `import`/`export`, JSX từ các lời gọi `jsx()`, tên biến bị rollup thêm hậu tố
  (`id$1` → `id`, `token2` → `token`), module dùng chung `src/shared` (main và renderer mỗi bên chỉ giữ một phần sau tree-shaking,
  đã gộp lại), đúng phiên bản thư viện (kể cả `motion-dom` 13.4.5 của framer-motion).
- **Không thể khôi phục** vì không còn trong bản build:
  - kiểu TypeScript (mã gốc là TS, bị esbuild xoá kiểu) → mã nguồn ở dạng `.js`/`.jsx`;
  - comment trong renderer (đã bị loại khi biên dịch JSX) và mọi đoạn code chết đã bị tree-shake;
  - tên file/thư mục gốc: tên file ở đây được đặt theo nội dung (component/chức năng chính của file).

## Kiểm chứng

- Build lại bằng `electron-vite build` rồi so từng câu lệnh cấp cao nhất với bundle gốc (bỏ qua khác biệt tên biến):
  1.0.2: main 1293/1294, preload 6/6, renderer 2665/2666 (1.0.1: 1283/1284, 6/6, 2658/2659). Câu lệnh lệch ở main là do rollup bản mới tự bỏ một tham số không dùng tới;
  câu lệch ở renderer chỉ khác tên biến trong template string.
- Thứ tự module trong bundle không trùng hoàn toàn: source gốc còn có các `import` mà phần code dùng chúng đã bị tree-shake,
  nên không còn dấu vết trong bản build. Việc này không đổi hành vi.
- CSS: trùng khớp từng rule với CSS gốc của cả hai bản (chỉ khác chỗ xuống dòng). Tên file font băm trùng với bản gốc.
- Chạy thật bằng Electron 33.4.11 (thư mục dữ liệu riêng): DOM màn hình khởi động của bản dựng lại **giống hệt** bản gốc (đã thử cả 1.0.1 và 1.0.2),
  không có lỗi console.
- Các màn hình sau đăng nhập chưa được kiểm thử bằng chạy thật (cần tài khoản Omnira và license).

## tools/reconstruct

`run.js` (tách 3 bundle theo `main-manifest.txt` / `r-manifest.txt`) → `merge.js` (gộp `src/shared`) → `fmt.mjs` (prettier) →
`finalize.js` (chép vào project). `classify.js` + `vendormap.js` tách code app khỏi thư viện trong bundle renderer;
`compare.js` so bundle build lại với bundle gốc; `shoot.js` chạy app bằng playwright và chụp màn hình/DOM để so sánh.
`input/` + `main-manifest.txt`/`r-manifest.txt` là dữ liệu của 1.0.1; `1.0.2/` + `run-1.0.2.js` là của 1.0.2.
Với bản mới: giải nén `app.asar` từ bộ cài (7-Zip mở được file NSIS), `remap.js` chuyển manifest cũ sang vị trí mới và liệt kê
các khai báo mới cần xếp file, `depver.js` so phiên bản thư viện đóng gói. Một số script còn đường dẫn tuyệt đối của máy dựng.
