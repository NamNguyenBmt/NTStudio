import { mkdirSync, readdirSync, statSync, statfsSync } from "node:fs";
import { join } from "node:path";
import { userDir } from "../paths";

export function mediaDir() {
  const dir = join(userDir(), "media");
  mkdirSync(dir, { recursive: true });
  return dir;
}

function dirSize(dir) {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) total += dirSize(p);
    else if (entry.isFile()) total += statSync(p).size;
  }
  return total;
}

export function storageInfo() {
  const dir = mediaDir();
  let diskFreeBytes = null;
  let diskTotalBytes = null;
  try {
    const fs = statfsSync(dir);
    diskFreeBytes = fs.bavail * fs.bsize;
    diskTotalBytes = fs.blocks * fs.bsize;
  } catch {
  }
  return { mediaDir: dir, usedBytes: dirSize(dir), diskFreeBytes, diskTotalBytes };
}
