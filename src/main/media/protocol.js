import { pathToFileURL } from "node:url";
import { protocol, net } from "electron";
import { resolve, sep, isAbsolute, extname } from "node:path";
import { currentUser } from "../paths";
import { contentItems } from "../db/schema";
import { getDb } from "../db/index";
import { mediaDir } from "./paths";

const MEDIA_SCHEME = "omni-media";

export function registerMediaScheme() {
  protocol.registerSchemesAsPrivileged([
    { scheme: MEDIA_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
  ]);
}

export function resolveMediaPath(relPath) {
  if (!currentUser()) return null;
  const root = resolve(mediaDir());
  const abs = resolve(root, relPath.replace(/^\/+/, ""));
  return abs === root || abs.startsWith(root + sep) ? abs : null;
}

const EXT_MEDIA = new Set([".jpg", ".jpeg", ".png", ".webp", ".mp4", ".mov", ".m4v", ".webm"]);
const norm = (p) => (process.platform === "win32" ? resolve(p).toLowerCase() : resolve(p));
let attached = null;

export function resolveAttachedPath(absPath) {
  const user = currentUser();
  if (!user || !isAbsolute(absPath) || !EXT_MEDIA.has(extname(absPath).toLowerCase())) return null;
  if (!attached || attached.user !== user || Date.now() - attached.at > 5e3) {
    const set = new Set();
    for (const r of getDb().select({ paths: contentItems.mediaPaths }).from(contentItems).all())
      for (const p of r.paths) if (isAbsolute(p)) set.add(norm(p));
    attached = { at: Date.now(), user, set };
  }
  return attached.set.has(norm(absPath)) ? resolve(absPath) : null;
}

export function handleMediaProtocol() {
  protocol.handle(MEDIA_SCHEME, (req) => {
    const url = new URL(req.url);
    const abs =
      url.hostname === "ext"
        ? resolveAttachedPath(decodeURIComponent(url.pathname.slice(1)))
        : resolveMediaPath(decodeURIComponent(url.pathname));
    if (!abs) return new Response("Forbidden", { status: 403 });
    return net.fetch(pathToFileURL(abs).toString(), { headers: req.headers });
  });
}
