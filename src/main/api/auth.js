import { toAuthUser, activeUser, hasLegacyData, adoptLegacyData, openSession, closeSession } from "../auth/session";
import { ApiError } from "../errors";
import { vaultAvailable, writePortableKey, recoverVaultOnThisMachine } from "../vault";
import { CLOUD_URL, CloudError, cloud, readCloudSession, writeCloudSession, clearCloudSession } from "../cloud/client";
import { verifyLicenseToken, licenseView, activateLicense, refreshLicense, deactivateLicense } from "../license/index";
import { readStore, writeStore, findUser, updateUser, hashPassword, verifyPassword, createUser, rememberSession, forgetSession, lockRemainingSec, recordFailure, clearFailures } from "../auth/store";

const hasUsers = () => readStore().users.length > 0;
let dummyHash = null;
let pendingRegister = null;
const PENDING_TTL_MS = 24 * 36e5;
const toPending = (r) => ({ email: r.email, expiresInSeconds: r.expiresInSeconds, resendInSeconds: r.resendInSeconds });

function saveLastEmail(email) {
  const s = readStore();
  s.lastEmail = email;
  writeStore(s);
}

function toApiError(e) {
  if (e instanceof ApiError) return e;
  if (!(e instanceof CloudError)) return new ApiError("INTERNAL", e instanceof Error ? e.message : String(e));
  if (e.offline) return new ApiError("INTERNAL", e.message);
  if (e.status === 401) return new ApiError("AUTH", "Email hoặc mật khẩu không đúng");
  if (e.code === "EMAIL_EXISTS") return new ApiError("CONFLICT", "Email này đã có tài khoản Omnira – hãy đăng nhập");
  if (e.code === "ACCOUNT_LOCKED") return new ApiError("AUTH", e.message);
  if (e.code === "WRONG_PASSWORD") return new ApiError("VALIDATION", "Mật khẩu hiện tại không đúng");
  return new ApiError(e.status === 409 ? "CONFLICT" : "VALIDATION", e.message);
}

async function linkLocal(customer, password) {
  const users = readStore().users;
  const byCloud = users.find((u) => u.cloudId === customer.id);
  const byEmail = findUser(customer.email);
  let user = byCloud ?? byEmail;
  if (user && !byCloud) {
    if (user.cloudId && user.cloudId !== customer.id) throw new ApiError("CONFLICT", "Email này trên máy đang gắn với tài khoản Omnira khác");
    if (!await verifyPassword(password, user.passwordHash))
      throw new ApiError(
        "AUTH",
        "Máy này đã có dữ liệu của tài khoản cùng email nhưng mật khẩu khác. Để liên kết và giữ dữ liệu: đổi mật khẩu tài khoản Omnira cho giống mật khẩu cũ trên máy, đăng nhập, rồi đổi lại sau."
      );
  }
  if (!user) return createUser({ email: customer.email, displayName: customer.fullName, password, provider: "cloud", cloudId: customer.id });
  return updateUser(user.id, { provider: "cloud", cloudId: customer.id, displayName: customer.fullName, passwordHash: await hashPassword(password) });
}

function start(user, remember, password) {
  try {
    recoverVaultOnThisMachine(user.id, password);
  } catch (err) {
    console.error("[vault] không mở được khóa di chuyển", err);
    throw new ApiError("INTERNAL", "Không mở được két bảo mật của dữ liệu này trên máy mới (khóa di chuyển không khớp). API key / token cần nhập lại.");
  }
  try {
    openSession(user);
  } catch (err) {
    throw new ApiError("INTERNAL", `Không mở được dữ liệu của tài khoản: ${err instanceof Error ? err.message : String(err)}`);
  }
  try {
    writePortableKey(user.id, password);
  } catch (err) {
    console.error("[vault] không ghi được khóa di chuyển", err);
  }
  if (remember) rememberSession(user.id);
  else forgetSession(user.id);
  saveLastEmail(user.email);
}

async function startCloud(auth, password, remember, adoptLegacy = false) {
  const isNew = !readStore().users.some((u) => u.cloudId === auth.customer.id || u.email === auth.customer.email.toLowerCase());
  const user = await linkLocal(auth.customer, password);
  if (isNew && adoptLegacy && hasLegacyData()) {
    try {
      adoptLegacyData(user.id);
    } catch (err) {
      console.error("[auth] chuyển dữ liệu cũ lỗi", err);
      throw new ApiError("INTERNAL", `Đã tạo tài khoản nhưng không chuyển được dữ liệu cũ: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  const prev = readCloudSession(user.id);
  writeCloudSession(user.id, {
    customerId: auth.customer.id,
    email: auth.customer.email,
    customerToken: auth.token,
    // Token license cũ chỉ còn giá trị nếu cùng tài khoản cloud
    licenseToken: prev?.customerId === auth.customer.id ? prev.licenseToken : null,
    updatedAt: Date.now()
  });
  start(user, remember, password);
  if ((await refreshLicense()).status === "revoked") await activateLicense();
  return activeUser();
}

const cloudToken = () => {
  const u = activeUser();
  const t = u ? readCloudSession(u.id)?.customerToken : null;
  if (!t) throw new ApiError("AUTH", "Phiên đăng nhập Omnira đã hết – đăng xuất rồi đăng nhập lại");
  return t;
};

export const authHandlers = {
  "auth.state": () => {
    const u = activeUser();
    return {
      user: u ? toAuthUser(u) : null,
      hasUsers: hasUsers(),
      // Dữ liệu từ bản trước khi có đăng nhập – màn đăng ký cho chọn chuyển vào tài khoản mới
      legacyData: hasLegacyData(),
      lastEmail: readStore().lastEmail ?? null,
      vaultAvailable: vaultAvailable(),
      license: u ? licenseView() : null,
      cloudUrl: CLOUD_URL
    };
  },
  "auth.register": async ({ email, displayName, password, phone, referralCode, remember, adoptLegacy }) => {
    let r;
    try {
      r = await cloud("/api/client/v1/auth/register", {
        method: "POST",
        body: { email, password, fullName: displayName, phone: phone || null, referralCode: referralCode || null }
      });
    } catch (e) {
      throw toApiError(e);
    }
    pendingRegister = { email: r.email, password, remember, adoptLegacy, at: Date.now() };
    return toPending(r);
  },
  "auth.registerResend": async ({ email }) => {
    try {
      return toPending(await cloud("/api/client/v1/auth/register/resend", { method: "POST", body: { email } }));
    } catch (e) {
      throw toApiError(e);
    }
  },
  "auth.registerVerify": async ({ email, code }) => {
    const p = pendingRegister;
    if (!p || p.email !== email || Date.now() - p.at > PENDING_TTL_MS)
      throw new ApiError("VALIDATION", "Phiên đăng ký đã hết – vui lòng điền lại thông tin đăng ký");
    let auth;
    try {
      auth = await cloud("/api/client/v1/auth/register/verify", { method: "POST", body: { email, code } });
    } catch (e) {
      if (e instanceof CloudError && e.code === "REGISTRATION_EXPIRED") pendingRegister = null;
      throw toApiError(e);
    }
    pendingRegister = null;
    return toAuthUser(await startCloud(auth, p.password, p.remember, p.adoptLegacy));
  },
  "auth.forgotPassword": async ({ email }) => {
    try {
      return toPending(await cloud("/api/client/v1/auth/password/forgot", { method: "POST", body: { email } }));
    } catch (e) {
      throw toApiError(e);
    }
  },
  "auth.resetPassword": async ({ email, code, newPassword, remember }) => {
    let auth;
    try {
      auth = await cloud("/api/client/v1/auth/password/reset", { method: "POST", body: { email, code, newPassword } });
    } catch (e) {
      throw toApiError(e);
    }
    clearFailures(email);
    return toAuthUser(await startCloud(auth, newPassword, remember));
  },
  "auth.login": async ({ email, password, remember }) => {
    const wait = lockRemainingSec(email);
    if (wait) throw new ApiError("AUTH", `Sai mật khẩu quá nhiều lần – thử lại sau ${wait} giây`);
    let auth;
    try {
      auth = await cloud("/api/client/v1/auth/login", { method: "POST", body: { email, password } });
    } catch (e) {
      if (e instanceof CloudError && e.offline) {
        const user = findUser(email);
        dummyHash ??= hashPassword("omnipage-dummy-password");
        const ok = user ? await verifyPassword(password, user.passwordHash) : (await verifyPassword(password, await dummyHash), false);
        if (!user || !ok) {
          recordFailure(email);
          throw new ApiError("AUTH", "Không kết nối được Omnira Cloud và mật khẩu không khớp mật khẩu đã lưu trên máy");
        }
        if (user.provider !== "cloud" || !verifyLicenseToken(readCloudSession(user.id)?.licenseToken))
          throw new ApiError("INTERNAL", "Không kết nối được Omnira Cloud – cần có mạng để đăng nhập lần này");
        clearFailures(email);
        start(user, remember, password);
        return toAuthUser(activeUser());
      }
      if (e instanceof CloudError && e.status === 401) recordFailure(email);
      throw toApiError(e);
    }
    clearFailures(email);
    return toAuthUser(await startCloud(auth, password, remember));
  },
  "auth.logout": async () => {
    const u = activeUser();
    if (u) {
      await deactivateLicense(readCloudSession(u.id)?.customerToken ?? null);
      clearCloudSession(u.id);
    }
    forgetSession(u?.id);
    closeSession();
  },
  "auth.changePassword": async ({ currentPassword, newPassword }) => {
    const u = activeUser();
    if (!u) throw new ApiError("AUTH", "Chưa đăng nhập");
    try {
      await cloud("/api/client/v1/me/password", { method: "POST", body: { currentPassword, newPassword }, token: cloudToken() });
    } catch (e) {
      throw toApiError(e);
    }
    const remembered = !!u.rememberTokenHash;
    updateUser(u.id, { passwordHash: await hashPassword(newPassword), rememberTokenHash: null, rememberExpiresAt: null });
    try {
      writePortableKey(u.id, newPassword);
    } catch (err) {
      console.error("[vault] không ghi lại được khóa di chuyển", err);
    }
    if (remembered) rememberSession(u.id);
    else forgetSession();
  },
  "auth.updateProfile": async ({ displayName }) => {
    const u = activeUser();
    if (!u) throw new ApiError("AUTH", "Chưa đăng nhập");
    try {
      const token = cloudToken();
      const me = await cloud("/api/client/v1/me", { token });
      await cloud("/api/client/v1/me", { method: "PUT", body: { fullName: displayName.trim(), phone: me.customer.phone, company: me.customer.company }, token });
    } catch (e) {
      throw toApiError(e);
    }
    updateUser(u.id, { displayName: displayName.trim() });
    return toAuthUser(readStore().users.find((x) => x.id === u.id));
  },
  "auth.checkReferral": async ({ code }) => {
    try {
      const r = await cloud(`/api/public/referral/${encodeURIComponent(code)}`, { timeoutMs: 8e3 });
      return { valid: r.valid, name: r.name ?? null };
    } catch (e) {
      throw toApiError(e);
    }
  }
};
