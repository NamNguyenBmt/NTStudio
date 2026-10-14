import { existsSync, statSync } from "node:fs";
import { extname, isAbsolute, join } from "node:path";
import { open } from "node:fs/promises";
import { mediaDir } from "../media/paths";
import { GRAPH_VERSION, graphVideoBase, ruploadBase, PublishError, graph, fileForm, ruploadFile, tiktok, tiktokPutChunk, sleep } from "./http";

const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const VIDEO_EXT = new Set([".mp4", ".mov", ".m4v"]);

const mimeOf = (f) => {
  const e = extname(f).toLowerCase();
  return e === ".png" ? "image/png" : e === ".webp" ? "image/webp" : e === ".mov" ? "video/quicktime" : VIDEO_EXT.has(e) ? "video/mp4" : "image/jpeg";
};

export function mediaFiles(content) {
  const files = content.mediaPaths.map((p) => isAbsolute(p) ? p : join(mediaDir(), p));
  const missing = files.filter((f) => !existsSync(f));
  if (missing.length) throw new PublishError("permanent", `Không tìm thấy file media: ${missing.map((f) => f.split(/[\\/]/).pop()).join(", ")}`);
  return {
    images: files.filter((f) => IMAGE_EXT.has(extname(f).toLowerCase())),
    videos: files.filter((f) => VIDEO_EXT.has(extname(f).toLowerCase()))
  };
}

export function composeCaption(content, max = 63206) {
  const tags = [
    ...new Set(
      content.hashtags.map((t) => t.trim()).filter(Boolean).map((t) => t.startsWith("#") ? t : `#${t}`)
    )
  ];
  const base = (content.caption ?? content.title).trim();
  const text = tags.length ? `${base}

${tags.join(" ")}` : base;
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}

const needPageId = (cred) => {
  if (!cred.pageId) throw new PublishError("auth", "Thiếu ID Fanpage trong thông tin kết nối – kết nối lại token cho kênh");
  return cred.pageId;
};

const CHUNKED_FROM_BYTES = 40 * 1024 * 1024;

async function facebookChunkedVideo(pageId, token, file, fields, signal, stage) {
  const size = statSync(file).size;
  const base = graphVideoBase();
  stage("Khởi tạo upload video");
  const start = await graph("POST", `${pageId}/videos`, {
    token,
    signal,
    base,
    form: { upload_phase: "start", file_size: String(size) }
  });
  let from = Number(start.start_offset);
  let to = Number(start.end_offset);
  const fh = await open(file, "r");
  try {
    let retries = 0;
    while (from < size) {
      const len = Math.max(0, Math.min(to, size) - from);
      const buf = Buffer.alloc(len);
      await fh.read(buf, 0, len, from);
      const fd = new FormData();
      fd.append("upload_phase", "transfer");
      fd.append("upload_session_id", start.upload_session_id);
      fd.append("start_offset", String(from));
      fd.append("video_file_chunk", new Blob([buf]), "video.mp4");
      try {
        const r = await graph("POST", `${pageId}/videos`, { token, signal, base, multipart: fd, timeoutMs: 5 * 6e4 });
        from = Number(r.start_offset);
        to = Number(r.end_offset);
        retries = 0;
        stage(`Đang upload video ${Math.min(100, Math.round(from / size * 100))}%`);
      } catch (err) {
        if (signal.aborted || !(err instanceof PublishError) || err.kind !== "transient" || retries >= 3) throw err;
        retries++;
        stage(`Upload lỗi mạng – gửi lại đoạn (lần ${retries}/3)`);
        await sleep(2e3 * retries, signal);
      }
    }
  } finally {
    await fh.close();
  }
  stage("Xuất bản video");
  const finish = (f) => graph("POST", `${pageId}/videos`, { token, signal, base, form: { upload_phase: "finish", upload_session_id: start.upload_session_id, ...f } });
  await finish({ description: fields.description, title: fields.title || void 0 }).catch((err) => {
    if (!nameTooLong(err)) throw err;
    stage("Facebook từ chối tiêu đề – xuất bản lại không kèm tiêu đề");
    return finish({ description: fields.description });
  });
  return start.video_id;
}

function fbVideoTitle(title) {
  const t = title.replace(/\s+/g, " ").trim();
  if (t.length <= 80) return t;
  const cut = t.slice(0, 80);
  return (cut.lastIndexOf(" ") > 40 ? cut.slice(0, cut.lastIndexOf(" ")) : cut).replace(/[\s,.;:–-]+$/, "");
}

const nameTooLong = (err) => err instanceof PublishError && err.kind === "permanent" && /tên (file|tệp)|file ?name|name .*too long|quá dài/i.test(err.message);

export async function publishFacebook({ cred, content, signal, stage }) {
  const pageId = needPageId(cred);
  const token = cred.token;
  const message = composeCaption(content);
  const { images, videos } = content.kind === "text" ? { images: [], videos: [] } : mediaFiles(content);
  const permalinkOf = async (id) => {
    try {
      return (await graph("GET", id, { token, signal, query: { fields: "permalink_url" } })).permalink_url ?? null;
    } catch {
      return null;
    }
  };
  if (videos.length) {
    const file = videos[0];
    const vertical = content.kind === "reel" || content.aspect === "9:16" && (content.durationSec ?? 0) <= 90;
    if (vertical) {
      stage("Khởi tạo Reel");
      const start = await graph("POST", `${pageId}/video_reels`, { token, signal, form: { upload_phase: "start" } });
      stage("Đang upload video");
      await ruploadFile(start.upload_url ?? `${ruploadBase()}/video-upload/${GRAPH_VERSION}/${start.video_id}`, token, file, signal);
      stage("Xuất bản Reel");
      await graph("POST", `${pageId}/video_reels`, { token, signal, form: { upload_phase: "finish", video_id: start.video_id, video_state: "PUBLISHED", description: message } });
      return { externalId: start.video_id, permalink: `https://www.facebook.com/reel/${start.video_id}` };
    }
    if (statSync(file).size > CHUNKED_FROM_BYTES) {
      const id = await facebookChunkedVideo(pageId, token, file, { description: message, title: fbVideoTitle(content.title) }, signal, stage);
      return { externalId: id, permalink: `https://www.facebook.com/${pageId}/videos/${id}` };
    }
    stage("Đang upload video");
    const upload = async (title) => graph("POST", `${pageId}/videos`, {
      token,
      signal,
      multipart: await fileForm({ description: message, title }, "source", file, mimeOf(file), "video.mp4"),
      base: graphVideoBase(),
      timeoutMs: 10 * 6e4
    });
    const r2 = await upload(fbVideoTitle(content.title) || void 0).catch((err) => {
      if (!nameTooLong(err)) throw err;
      stage("Facebook từ chối tiêu đề – upload lại không kèm tiêu đề");
      return upload(void 0);
    });
    return { externalId: r2.id, permalink: `https://www.facebook.com/${pageId}/videos/${r2.id}` };
  }
  if (images.length === 1) {
    stage("Đang upload ảnh");
    const fd = await fileForm({ caption: message }, "source", images[0], mimeOf(images[0]));
    const r2 = await graph("POST", `${pageId}/photos`, { token, signal, multipart: fd, timeoutMs: 3 * 6e4 });
    const id = r2.post_id ?? r2.id;
    return { externalId: id, permalink: await permalinkOf(id) };
  }
  if (images.length > 1) {
    const ids = [];
    for (const [i, img] of images.slice(0, 10).entries()) {
      stage(`Đang upload ảnh ${i + 1}/${Math.min(images.length, 10)}`);
      const fd = await fileForm({ published: false }, "source", img, mimeOf(img));
      ids.push((await graph("POST", `${pageId}/photos`, { token, signal, multipart: fd, timeoutMs: 3 * 6e4 })).id);
    }
    const form = { message };
    ids.forEach((id, i) => form[`attached_media[${i}]`] = JSON.stringify({ media_fbid: id }));
    const r2 = await graph("POST", `${pageId}/feed`, { token, signal, form });
    return { externalId: r2.id, permalink: await permalinkOf(r2.id) };
  }
  if (content.kind !== "text") throw new PublishError("permanent", "Nội dung chưa có file ảnh/video để đăng");
  const r = await graph("POST", `${pageId}/feed`, { token, signal, form: { message } });
  return { externalId: r.id, permalink: await permalinkOf(r.id) };
}

export async function publishInstagram({ cred, content, signal, stage }) {
  if (!cred.igUserId) throw new PublishError("auth", "Thiếu ID tài khoản Instagram Business – kết nối lại token cho kênh");
  const token = cred.token;
  if (content.kind === "text") throw new PublishError("permanent", "Instagram không hỗ trợ bài chỉ có chữ");
  const { videos } = mediaFiles(content);
  if (!videos.length) {
    throw new PublishError("permanent", "Instagram API chỉ nhận ảnh qua URL công khai – hiện chỉ đăng được Reels/video từ máy. Hãy đăng ảnh lên Fanpage hoặc chuyển thành video");
  }
  const caption = composeCaption(content, 2200);
  stage("Tạo container Reels");
  const container = await graph("POST", `${cred.igUserId}/media`, {
    token,
    signal,
    form: { media_type: "REELS", upload_type: "resumable", caption, share_to_feed: true }
  });
  stage("Đang upload video");
  await ruploadFile(container.uri ?? `${ruploadBase()}/ig-api-upload/${GRAPH_VERSION}/${container.id}`, token, videos[0], signal);
  const started = Date.now();
  for (; ; ) {
    const st = await graph("GET", container.id, { token, signal, query: { fields: "status_code,status" } });
    if (st.status_code === "FINISHED") break;
    if (st.status_code === "ERROR" || st.status_code === "EXPIRED") throw new PublishError("permanent", `Instagram không xử lý được video: ${st.status ?? st.status_code}`);
    if (Date.now() - started > 10 * 6e4) throw new PublishError("transient", "Instagram xử lý video quá 10 phút");
    stage(`Instagram đang xử lý video (${Math.round((Date.now() - started) / 1e3)}s)`);
    await sleep(5e3, signal);
  }
  stage("Xuất bản");
  const r = await graph("POST", `${cred.igUserId}/media_publish`, { token, signal, form: { creation_id: container.id } });
  let permalink = null;
  try {
    permalink = (await graph("GET", r.id, { token, signal, query: { fields: "permalink" } })).permalink ?? null;
  } catch {
  }
  return { externalId: r.id, permalink };
}

const MB = 1024 * 1024;

function tiktokChunks(size) {
  if (size <= 64 * MB) return { chunkSize: size, count: 1 };
  const chunkSize = 10 * MB;
  return { chunkSize, count: Math.floor(size / chunkSize) };
}

export async function publishTikTok({ cred, content, signal, stage }) {
  const token = cred.token;
  if (content.kind !== "video" && content.kind !== "reel") throw new PublishError("permanent", "Kênh TikTok chỉ đăng video từ máy (ảnh TikTok yêu cầu URL công khai)");
  const { videos } = mediaFiles(content);
  if (!videos.length) throw new PublishError("permanent", "Nội dung chưa có file video");
  const file = videos[0];
  stage("Kiểm tra quyền đăng TikTok");
  const info = await tiktok("/v2/post/publish/creator_info/query/", { token, signal, json: {} });
  const max = info.max_video_post_duration_sec;
  if (max && content.durationSec && content.durationSec > max)
    throw new PublishError("permanent", `Video dài ${Math.round(content.durationSec)}s vượt giới hạn ${max}s của tài khoản TikTok`);
  const options = info.privacy_level_options ?? [];
  const privacy = options.includes("PUBLIC_TO_EVERYONE") ? "PUBLIC_TO_EVERYONE" : options[0] ?? "SELF_ONLY";
  const note = privacy === "PUBLIC_TO_EVERYONE" ? void 0 : `TikTok chỉ cho phép chế độ "${privacy}" (ứng dụng chưa được TikTok duyệt hoặc tài khoản riêng tư)`;
  const size = statSync(file).size;
  const { chunkSize, count } = tiktokChunks(size);
  stage("Khởi tạo upload");
  const init = await tiktok("/v2/post/publish/video/init/", {
    token,
    signal,
    json: {
      post_info: {
        title: composeCaption(content, 2200),
        privacy_level: privacy,
        disable_comment: !!info.comment_disabled,
        disable_duet: !!info.duet_disabled,
        disable_stitch: !!info.stitch_disabled
      },
      source_info: { source: "FILE_UPLOAD", video_size: size, chunk_size: chunkSize, total_chunk_count: count }
    }
  });
  const fh = await open(file, "r");
  try {
    for (let i = 0; i < count; i++) {
      const start = i * chunkSize;
      const len = i === count - 1 ? size - start : chunkSize;
      const buf = Buffer.alloc(len);
      await fh.read(buf, 0, len, start);
      stage(`Đang upload video ${Math.round((i + 1) / count * 100)}%`);
      await tiktokPutChunk(init.upload_url, buf, start, size, signal);
    }
  } finally {
    await fh.close();
  }
  const started = Date.now();
  for (; ; ) {
    const st = await tiktok("/v2/post/publish/status/fetch/", {
      token,
      signal,
      json: { publish_id: init.publish_id }
    });
    if (st.status === "PUBLISH_COMPLETE") {
      const postId = st.publicaly_available_post_id?.[0];
      return {
        externalId: postId ? String(postId) : init.publish_id,
        permalink: postId && info.creator_username ? `https://www.tiktok.com/@${info.creator_username}/video/${postId}` : null,
        note
      };
    }
    if (st.status === "FAILED") throw new PublishError("permanent", `TikTok từ chối video: ${st.fail_reason ?? "không rõ lý do"}`);
    if (Date.now() - started > 5 * 6e4) {
      return { externalId: init.publish_id, permalink: null, note: [note, "TikTok vẫn đang xử lý video sau 5 phút – kiểm tra trong ứng dụng TikTok"].filter(Boolean).join(". ") };
    }
    stage(`TikTok đang xử lý (${Math.round((Date.now() - started) / 1e3)}s)`);
    await sleep(5e3, signal);
  }
}
