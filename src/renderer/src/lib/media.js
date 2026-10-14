export function normalize(s) {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d");
}

export const mediaUrl = (path) =>
  /^([a-zA-Z]:[\\/]|\\\\|\/)/.test(path)
    ? `omni-media://ext/${encodeURIComponent(path)}`
    : `omni-media://local/${path.split("/").map(encodeURIComponent).join("/")}`;

export const encoderShort = { h264_nvenc: "NVENC", h264_amf: "AMF", h264_qsv: "QuickSync", libx264: "CPU x264" };
