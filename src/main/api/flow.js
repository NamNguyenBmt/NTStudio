import { shell } from "electron";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { ApiError } from "../errors";
import { mediaDir } from "../media/paths";
import {
  setVeoSource,
  setFlowConcurrency,
  setFlowHidden,
  closeFlowChrome,
  openFlowLogin,
  checkFlowLogin,
  resetFlowProfile,
  refreshFlowCredits,
  flowStatus,
} from "../flow/session";
import { flowDiagnosticsDir, setFlowModel, sampleFramePng, flowGenerate } from "../flow/video";
import { setFlowImages } from "../flow/image";

const wrap = async (fn, what) => {
  try {
    return await fn();
  } catch (err) {
    throw new ApiError("VALIDATION", `${what}: ${err instanceof Error ? err.message : String(err)}`);
  }
};

let testAbort = null;

export const flowHandlers = {
  "flow.status": () => flowStatus(),
  "flow.setSource": ({ source }) => {
    setVeoSource(source);
    return flowStatus();
  },
  "flow.setPrefs": async ({ hidden, concurrency, images }) => {
    if (images !== void 0) setFlowImages(images);
    if (hidden !== void 0) await setFlowHidden(hidden);
    if (concurrency !== void 0) setFlowConcurrency(concurrency);
    return flowStatus();
  },
  "flow.setModel": ({ model }) => {
    setFlowModel(model);
    return flowStatus();
  },
  "flow.openLogin": () => wrap(openFlowLogin, "Không mở được Chrome"),
  "flow.check": async () => {
    await wrap(checkFlowLogin, "Không kiểm tra được phiên Google Flow");
    return flowStatus();
  },
  "flow.refreshCredits": async () => {
    await wrap(refreshFlowCredits, "Không đọc được credit Google Flow");
    return flowStatus();
  },
  "flow.close": async () => {
    await closeFlowChrome();
    return flowStatus();
  },
  "flow.reset": async () => {
    await resetFlowProfile();
    return flowStatus();
  },
  /** Tạo thử một video ngắn (kiểm tra tự động hóa trên máy khách) → đường dẫn tương đối thư mục media */
  "flow.test": async ({ prompt, aspect, dryRun }) => {
    if (testAbort) throw new ApiError("CONFLICT", "Đang chạy thử – chờ xong hoặc hủy");
    testAbort = new AbortController();
    const dir = join(mediaDir(), "flow");
    mkdirSync(dir, { recursive: true });
    const rel = `flow/test-${Date.now().toString(36)}.mp4`;
    try {
      const signal = testAbort.signal;
      if (dryRun) {
        const diagnostics = await wrap(
          () => flowGenerate({ prompt, aspect, start: sampleFramePng(), dest: "", signal, dryRun: true }),
          "Kiểm tra giao diện Flow thất bại",
        );
        return { file: null, diagnostics };
      }
      await wrap(() => flowGenerate({ prompt, aspect, dest: join(mediaDir(), rel), signal }), "Tạo thử thất bại");
      return { file: rel, diagnostics: null };
    } finally {
      testAbort = null;
    }
  },
  "flow.cancelTest": () => {
    testAbort?.abort();
  },
  "flow.openDiagnostics": () => {
    const dir = flowDiagnosticsDir();
    mkdirSync(dir, { recursive: true });
    void shell.openPath(dir);
  },
};
