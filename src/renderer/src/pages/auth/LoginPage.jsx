import { useState } from "react";
import { call } from "../../lib/api";
import { BadgeCheck, Check, Cloud, HardDrive, LoaderCircle, LogIn, Network, ShieldCheck, UserPlus } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Field } from "../../components/ui/Field";
import { SegmentedControl } from "../../components/ui/SegmentedControl";
import { ThemeToggle } from "../../components/shell/ThemeToggle";
import { isMac, WindowControls } from "../../components/shell/WindowControls";
import { PasswordInput } from "./PasswordInput";
import { ForgotPasswordStep } from "./ForgotPasswordStep";
import { VerifyEmailStep } from "./VerifyEmailStep";
import { DataFolderLink } from "./DataFolderLink";

export function LoginPage({ state, onAuthed }) {
  const [mode, setMode] = useState(state.hasUsers ? "login" : "register");
  const [email, setEmail] = useState(state.lastEmail ?? "");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [phone, setPhone] = useState("");
  const [referral, setReferral] = useState("");
  const [referrer, setReferrer] = useState(null);
  const [remember, setRemember] = useState(true);
  const [adoptLegacy, setAdoptLegacy] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const [verify, setVerify] = useState(null);
  const [forgot, setForgot] = useState(false);
  const register = mode === "register";
  const mismatch = register && confirm.length > 0 && confirm !== password;
  const canSubmit =
    email.trim() &&
    password &&
    (!register ||
      (displayName.trim() && password.length >= 8 && confirm === password && !(referrer && !referrer.valid)));
  const submit = async () => {
    if (!canSubmit || pending) return;
    setPending(true);
    setError(null);
    try {
      if (register) {
        const pending2 = await call("auth.register", {
          email,
          displayName,
          password,
          phone: phone.trim() || void 0,
          referralCode: referral.trim() || void 0,
          remember,
          adoptLegacy: state.legacyData && adoptLegacy,
        });
        setVerify(pending2);
        setPending(false);
        return;
      }
      onAuthed(await call("auth.login", { email, password, remember }));
    } catch (e) {
      setError(e.message);
      setPending(false);
    }
  };
  const checkReferral = async () => {
    const code = referral.trim().toUpperCase();
    if (!code) return setReferrer(null);
    try {
      const r = await call("auth.checkReferral", { code });
      setReferrer({ code, name: r.name, valid: r.valid });
    } catch {
      setReferrer(null);
    }
  };
  return (
    <div className="flex h-screen flex-col bg-background">
      <header className="app-drag flex h-titlebar shrink-0 items-center justify-between">
        <div className={`flex items-center gap-space-xs ${isMac ? "pl-[76px]" : "pl-space-md"}`}>
          <Network size={18} className="text-secondary" />
          <span className="text-label-md font-semibold text-on-surface">Omnira Studio</span>
        </div>
        <div className="flex items-center">
          <ThemeToggle className="mr-space-sm" />
          {!isMac && <WindowControls />}
        </div>
      </header>
      <main className="flex flex-1 items-center justify-center overflow-y-auto p-space-lg">
        <div className="grid w-full max-w-[880px] grid-cols-1 overflow-hidden rounded-2xl border border-outline-variant/30 bg-surface-container-low shadow-flyout md:grid-cols-[1fr_420px]">
          <section className="hidden flex-col justify-between gap-space-xl bg-gradient-to-br from-primary-container/30 via-surface-container to-secondary-container/20 p-space-xl md:flex">
            <div>
              <div className="flex items-center gap-space-sm">
                <Network size={28} className="text-secondary" />
                <span className="text-headline-md text-on-surface">Omnira Studio</span>
              </div>
              <p className="mt-space-sm text-body-md text-on-surface-variant">
                {"Quản lý & tự động hóa đa kênh Facebook · TikTok · Instagram · YouTube trên máy của bạn."}
              </p>
            </div>
            <ul className="flex flex-col gap-space-md text-body-sm text-on-surface-variant">
              <li className="flex gap-space-sm">
                <HardDrive size={16} className="mt-0.5 shrink-0 text-tertiary" />
                Mỗi tài khoản có kho dữ liệu riêng trên máy: kênh, token, video, lịch đăng, hộp thư.
              </li>
              <li className="flex gap-space-sm">
                <ShieldCheck size={16} className="mt-0.5 shrink-0 text-tertiary" />
                {"Token & API key mã hóa AES-256-GCM bằng khóa riêng của từng tài khoản."}
              </li>
              <li className="flex gap-space-sm">
                <Cloud size={16} className="mt-0.5 shrink-0 text-tertiary" />
                Đăng nhập bằng tài khoản Omnira – dùng trên các máy theo gói, mất mạng vẫn chạy được vài ngày.
              </li>
              <li className="flex gap-space-sm">
                <BadgeCheck size={16} className="mt-0.5 shrink-0 text-tertiary" />
                Tài khoản mới được dùng thử miễn phí ngay sau khi đăng ký.
              </li>
            </ul>
          </section>
          {verify ? (
            <VerifyEmailStep pending={verify} onAuthed={onAuthed} onBack={() => setVerify(null)} />
          ) : forgot ? (
            <ForgotPasswordStep
              initialEmail={email}
              remember={remember}
              onAuthed={onAuthed}
              onBack={() => setForgot(false)}
            />
          ) : (
            <section className="flex flex-col gap-space-md p-space-xl">
              <div>
                <h1 className="text-headline-md text-on-surface">
                  {register ? "Tạo tài khoản Omnira" : "Đăng nhập Omnira"}
                </h1>
                <p className="text-body-sm text-on-surface-variant">
                  {register
                    ? "Dùng thử miễn phí ngay – dữ liệu (kênh, video, lịch đăng) lưu trên máy của bạn."
                    : "Đăng nhập bằng tài khoản Omnira của bạn."}
                </p>
              </div>
              <SegmentedControl
                label="Chế độ"
                value={mode}
                onChange={(m) => {
                  setMode(m);
                  setError(null);
                }}
                options={[
                  { value: "login", label: "Đăng nhập" },
                  { value: "register", label: "Tạo tài khoản" },
                ]}
              />
              {register && state.legacyData && (
                <label className="flex items-start gap-space-sm rounded-lg bg-secondary/10 p-space-sm text-body-sm text-on-surface">
                  <input
                    type="checkbox"
                    checked={adoptLegacy}
                    onChange={(e) => setAdoptLegacy(e.target.checked)}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-primary-container"
                  />
                  <span>
                    Chuyển dữ liệu từ phiên bản trước trên máy này (kênh, token, video, lịch đăng…) vào tài khoản mới.
                    <span className="block text-label-sm text-on-surface-variant">
                      Không chọn → tài khoản bắt đầu trống, dữ liệu cũ vẫn được giữ nguyên để chuyển sau.
                    </span>
                  </span>
                </label>
              )}
              {!state.vaultAvailable && (
                <p className="rounded-lg bg-warning/10 p-space-sm text-body-sm text-warning">
                  Hệ điều hành không cung cấp kho khóa an toàn – không thể lưu token và không ghi nhớ đăng nhập được.
                </p>
              )}
              <form
                className="flex flex-col gap-space-md"
                onSubmit={(e) => {
                  e.preventDefault();
                  void submit();
                }}
              >
                {register && (
                  <Field label="Tên hiển thị" required={true}>
                    {(id) => (
                      <Input
                        id={id}
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        maxLength={80}
                        autoComplete="name"
                        autoFocus={true}
                      />
                    )}
                  </Field>
                )}
                <Field label="Email" required={true}>
                  {(id) => (
                    <Input
                      id={id}
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      autoComplete="email"
                      autoFocus={!register}
                    />
                  )}
                </Field>
                <Field label="Mật khẩu" required={true} hint={register ? "Tối thiểu 8 ký tự" : void 0}>
                  {(id) => (
                    <PasswordInput
                      id={id}
                      value={password}
                      onChange={setPassword}
                      autoComplete={register ? "new-password" : "current-password"}
                    />
                  )}
                </Field>
                {!register && (
                  <button
                    type="button"
                    onClick={() => (setForgot(true), setError(null))}
                    className="-mt-space-sm self-end text-label-md text-primary hover:underline"
                  >
                    Quên mật khẩu?
                  </button>
                )}
                {register && (
                  <Field label="Nhập lại mật khẩu" required={true} error={mismatch ? "Mật khẩu không khớp" : null}>
                    {(id) => (
                      <PasswordInput id={id} value={confirm} onChange={setConfirm} autoComplete="new-password" />
                    )}
                  </Field>
                )}
                {register && (
                  <div className="grid grid-cols-2 gap-space-sm">
                    <Field label="Số điện thoại">
                      {(id) => (
                        <Input
                          id={id}
                          value={phone}
                          onChange={(e) => setPhone(e.target.value)}
                          maxLength={30}
                          autoComplete="tel"
                        />
                      )}
                    </Field>
                    <Field
                      label="Mã giới thiệu"
                      error={referrer && !referrer.valid ? "Mã không tồn tại" : null}
                      hint={referrer?.valid ? void 0 : "Nếu có"}
                    >
                      {(id) => (
                        <Input
                          id={id}
                          value={referral}
                          onChange={(e) => (setReferral(e.target.value.toUpperCase()), setReferrer(null))}
                          onBlur={() => void checkReferral()}
                          maxLength={20}
                          className="font-mono uppercase"
                        />
                      )}
                    </Field>
                    {referrer?.valid && (
                      <p className="col-span-2 -mt-space-xs flex items-center gap-1 text-label-sm text-tertiary">
                        <Check size={12} />
                        {" Người giới thiệu: "}
                        {referrer.name}
                      </p>
                    )}
                  </div>
                )}
                <label className="flex items-center gap-space-sm text-body-sm text-on-surface">
                  <input
                    type="checkbox"
                    checked={remember}
                    onChange={(e) => setRemember(e.target.checked)}
                    className="h-4 w-4 accent-primary-container"
                  />
                  Ghi nhớ đăng nhập trên máy này (30 ngày)
                </label>
                {error && <p className="rounded-lg bg-danger/10 p-space-sm text-body-sm text-error">{error}</p>}
                <Button variant="primary" type="submit" disabled={!canSubmit || pending} className="h-10">
                  {pending ? (
                    <LoaderCircle size={15} className="animate-spin" />
                  ) : register ? (
                    <UserPlus size={15} />
                  ) : (
                    <LogIn size={15} />
                  )}
                  {pending
                    ? register
                      ? "Đang gửi mã xác thực…"
                      : "Đang đăng nhập…"
                    : register
                      ? "Tiếp tục – gửi mã xác thực email"
                      : "Đăng nhập"}
                </Button>
              </form>
              {state.hasUsers && (
                <p className="text-label-sm text-on-surface-variant">
                  {"Đã dùng app trên máy này từ trước? Đăng ký / đăng nhập Omnira bằng "}
                  <b>cùng email và mật khẩu cũ</b>
                  {" để giữ nguyên dữ liệu."}
                </p>
              )}
              <DataFolderLink />
            </section>
          )}
        </div>
      </main>
    </div>
  );
}
