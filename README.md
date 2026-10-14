# Omnira Studio – mã nguồn dựng lại (v1.0.2)

Mã nguồn được dựng lại từ bản phát hành **Omnira Studio 1.0.2** (`app.asar` trong `Omnira Studio Setup 1.0.2.exe`, build bằng electron-vite).
`npm run build` từ thư mục này cho ra thư mục `out/` **trùng từng byte** với `out/` trong bản phát hành 1.0.2
(main, preload, renderer JS, CSS, `index.html`, font – kể cả tên file có hash), và `node tools/dist-exact.js` cho ra
`Omnira Studio Setup 1.0.2.exe` **trùng từng byte** với bộ cài phát hành (SHA-256 `5feb2a21…58d66e6`).

Lịch sử git: tag `v1.0.1` (dựng từ bản 1.0.1), `v1.0.2` (thay đổi của 1.0.2: thử lại Google Flow khi lỗi tạm thời,
thẻ "Nguồn tạo ảnh & video" trong Cài đặt), các commit sau đó tinh chỉnh để bản build trùng byte.

## Đổi tên thành NT Studio

Bản 1.0.3 (tag `v1.0.3`): đổi tên hiển thị "Omnira Studio" → "NT Studio" (cửa sổ, khay hệ thống,
màn hình đăng nhập/license, tên exe, bộ cài `NT Studio Setup 1.0.3.exe`, shortcut), mọi chữ "Omnira" hiển thị
(tài khoản, Cloud, AI, hỗ trợ, copyright) → "NT", và đổi icon/logo sang hình quả dâu
(`resources/icon.png` 1024px, `src/renderer/src/assets/logo.png` qua `components/shell/AppLogo.jsx`).
Từ đây bản build không còn trùng byte với 1.0.2 – muốn tái tạo bản gốc thì checkout tag `v1.0.2-exact-installer`.
Giữ nguyên có chủ đích (không hiển thị cho người dùng): `appId` (`com.omnipage.studio`, để bộ cài mới nâng cấp đè lên
bản cũ), tên gói npm `omnira-studio`, audience license `omnira-studio` (server kiểm tra), địa chỉ `api.omnira.io.vn`,
khoá API `ai.omnira`, tên hàm/component nội bộ (`omniraChat`, `OmniraAiCard`…), tiền tố file tạm `omnira-`.
`src/main/legacy-data.js`: máy đã có `%APPDATA%\Omnira Studio` thì tiếp tục dùng thư mục dữ liệu đó (trừ khi chạy với
`--user-data-dir`).

## Chạy & đóng gói

```bash
npm ci                 # cài đúng theo package-lock.json; postinstall tự build better-sqlite3 cho Electron
npm run dev            # chạy dev (electron-vite, hot reload renderer)
npm run build          # build ra out/
npm run dist           # build + tạo bộ cài NSIS: dist/Omnira Studio Setup 1.0.2.exe
node tools/dist-exact.js   # (sau npm run build) tạo bộ cài trùng từng byte với bản phát hành 1.0.2
npm run verify         # build + harness so giao diện bản gốc / bản dựng lại (tools/verify)
npm run db:generate    # drizzle-kit: sinh migration từ src/main/db/schema.js
```

Nếu `npm ci` chạy với `--ignore-scripts` thì cần chạy thêm:
`node node_modules/electron/install.js`, `node node_modules/ffmpeg-static/install.js`, `npx electron-builder install-app-deps`.

Trên Windows chưa bật Developer Mode, electron-builder có thể lỗi khi giải nén `winCodeSign` (không tạo được symlink macOS).
Cách xử lý: bật Developer Mode, hoặc giải nén `winCodeSign-2.6.0.7z` vào
`%LOCALAPPDATA%\electron-builder\Cache\winCodeSign\winCodeSign-2.6.0` (bỏ qua lỗi symlink).

### Vì sao phải giữ đúng phiên bản / định dạng

Để bản build trùng byte, các điểm sau là có chủ đích, đừng "dọn dẹp":
- Phiên bản công cụ ghim đúng như lúc build bản gốc (đầu tháng 10/2026) qua `package-lock.json` (cài bằng `npm ci`):
  vite 5.4.21, rollup 4.63.6, postcss 8.5.28, autoprefixer 10.6.1, tailwindcss 3.4.19, electron-builder 25.1.8,
  motion-dom 13.4.5. Rollup ≥ 4.64 tự bỏ tham số thừa → bundle khác; electron-builder 26 tự sắp lại `node_modules`
  trong asar. Bố cục `node_modules` trong lockfile được chỉnh cho trùng với `app.asar` gốc – dùng `npm ci`, đừng
  `npm update` hay xoá lockfile.
- Mã nguồn giữ nguyên bố cục dòng như bản gốc (esbuild giữ chỗ xuống dòng của object/mảng/lời gọi; JSX: thuộc tính viết
  trên nhiều dòng ⇔ `jsx(` tách dòng). Không chạy prettier trên `src/`.
- `src/renderer/index.html`, `src/renderer/src/index.css` dùng CRLF (giống máy dựng gốc); `.gitattributes` tắt chuyển đổi
  xuống dòng của git.
- Các dòng `import "./x";` (side-effect) trong một số file giữ đúng **thứ tự khởi tạo module** như bản gốc: source gốc
  có import tới những đoạn code đã bị tree-shake (không còn trong bản build), nên thứ tự được khôi phục bằng các import này.
- `tailwind.config.js` giữ `safelist: ["ease-out"]` và giá trị viết đúng như bản gốc (chữ hoa trong mã màu, `rgba(` không dấu cách).
- `electron-builder.yml` **không** đặt `uninstallDisplayName`: bản gốc dùng mặc định "Omnira Studio 1.0.2" (tên hiện trong
  Apps & features).
- `npm run dist` cho bộ cài chạy được nhưng không trùng byte. `tools/dist-exact.js` chạy electron-builder với hai chỉnh sửa
  lúc chạy (không sửa `node_modules`):
  - electron-builder 25.1.8 ghi `messages.yml` và `assistedMessages.yml` song song rồi include file nào xong trước →
    thứ tự bảng ngôn ngữ trong bộ cài (header, dialog của stub, uninstaller) thay đổi giữa các lần build. Bản gốc là
    `assistedMessages.yml` trước; script ép đúng thứ tự đó.
  - NSIS ghi mtime của từng file vào header. Hai file sinh ra lúc build (`app-64.7z`, uninstaller) được đặt mtime về
    thời điểm build gốc: 2026-10-14 05:39:40 và 05:39:44 UTC. Khi phát hành bản mới, bỏ/cập nhật `ORIGINAL_MTIMES`.

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
tools/verify/       harness so giao diện bản gốc ↔ bản dựng lại (không đóng gói)
tools/reconstruct/  công cụ đã dùng để tách bundle → mã nguồn (không đóng gói)
```

## Những gì khôi phục được / không khôi phục được

- **Giữ nguyên:** toàn bộ logic, chuỗi tiếng Việt, comment (cả main lẫn renderer), tên hàm/biến/component gốc, bố cục dòng,
  CSS (biến theme + comment), cấu hình Tailwind suy ra từ CSS đã biên dịch, schema DB (drizzle-kit xác nhận khớp migration).
- **Không thể khôi phục** vì không còn trong bản build:
  - kiểu TypeScript (mã gốc là TS, bị esbuild xoá kiểu) → mã nguồn ở dạng `.js`/`.jsx`;
  - các đoạn code chết đã bị tree-shake (chỉ còn dấu vết là thứ tự module – xem phần import side-effect ở trên);
  - tên file/thư mục gốc: tên file ở đây được đặt theo nội dung (component/chức năng chính của file).

## Kiểm chứng

- `out/` build từ nguồn so với `out/` trong `app.asar` 1.0.2: **trùng 100% từng byte** (`diff -r`).
- `app.asar` và toàn bộ file cài ra máy trùng bản gốc; `tools/dist-exact.js` cho `Omnira Studio Setup 1.0.2.exe` trùng
  từng byte (`cmp`), kể cả khi clone sạch → `npm ci` → `npm run build` → `node tools/dist-exact.js`.
- Harness `tools/verify` (backend thật của bản dựng lại + dữ liệu mẫu, renderer gốc và renderer dựng lại chạy song song):
  21/21 màn hình và 34/34 thao tác (mở hộp thoại, đổi tab, bộ lọc) có DOM giống hệt, không lỗi console.
- Chạy thật bằng Electron 33.4.11 (thư mục dữ liệu riêng): màn hình khởi động giống hệt bản gốc; chế độ dev chạy bình thường.

## tools/reconstruct

Quy trình cho 1.0.2: `run-1.0.2.js` (tách 3 bundle theo `1.0.2/main-manifest.txt`, `1.0.2/r-manifest.txt`; giữ nguyên văn bản
gốc, dựng JSX, suy thứ tự import) → `merge.js` (gộp `src/shared`) → `finalize.js` (chép vào project) → `mkindexcss.py`
(dựng `index.css` từ CSS gốc). `compare.js` / `textdiff.js` so bundle theo câu lệnh / nguyên văn; `classify.js` +
`vendormap.js` tách code app khỏi thư viện trong bundle renderer.
Với bản mới: giải nén `app.asar` từ bộ cài (7-Zip mở được file NSIS), `remap.js` chuyển manifest cũ sang vị trí mới và liệt kê
các khai báo mới cần xếp file, `depver.js` so phiên bản thư viện đóng gói, `verat.js` tra phiên bản công cụ tại ngày build.
Một số script còn đường dẫn tuyệt đối của máy dựng. (`run.js` + `input/` là dữ liệu bản 1.0.1, theo quy trình cũ.)
