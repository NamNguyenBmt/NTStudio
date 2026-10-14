import { shell } from "electron";
import { createServer } from "node:http";
import { PublishError } from "./http";

const PAGE = (title, body, ok) => `<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>${title}</title><style>body{font-family:system-ui,Segoe UI,sans-serif;background:#0B0F17;color:#e2e8f0;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}.c{background:#151D2A;border:1px solid #1E293B;border-radius:16px;padding:32px 40px;max-width:460px;text-align:center}h1{font-size:20px;color:${ok ? "#4ade80" : "#f87171"}}p{color:#94a3b8;line-height:1.5}</style></head><body><div class="c"><h1>${title}</h1><p>${body}</p></div></body></html>`;
let active = null;

export function cancelLoopbackAuth() {
  active?.cancel();
}

export async function loopbackAuth(opts) {
  active?.cancel();
  return new Promise((resolve, reject) => {
    let done = false;
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname !== "/oauth/callback") {
        res.writeHead(404).end();
        return;
      }
      const err = url.searchParams.get("error");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(
        err ? PAGE(
          "Chưa kết nối được",
          `${opts.provider} trả về: ${err === "access_denied" ? "bạn đã từ chối cấp quyền" : err}. Bạn có thể đóng tab này và thử lại trong OmniPage Studio.`,
          false
        ) : PAGE(`Đã kết nối ${opts.provider}`, "Bạn có thể đóng tab này và quay lại OmniPage Studio.", true)
      );
      finish(() => resolve(url.searchParams));
    });
    const timer = setTimeout(
      () => finish(() => reject(new PublishError("permanent", `Hết thời gian chờ đăng nhập ${opts.provider} – bấm Kết nối lại`))),
      opts.timeoutMs ?? 5 * 6e4
    );
    const finish = (fn) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      active = null;
      server.close();
      fn();
    };
    active = { server, cancel: () => finish(() => reject(new PublishError("permanent", `Đã hủy kết nối ${opts.provider}`))) };
    server.on("error", (e) => finish(() => reject(new PublishError("permanent", `Không mở được cổng nhận kết quả đăng nhập: ${e.message}`))));
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      const url = opts.buildUrl(`http://127.0.0.1:${port}/oauth/callback`);
      if (process.env.OMNI_OAUTH_FETCH === "1") void fetch(url).catch(() => void 0);
      else void shell.openExternal(url);
    });
  });
}
