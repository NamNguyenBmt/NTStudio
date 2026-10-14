import { useState, useEffect } from "react";
import { call, useApiQuery, useApiMutation } from "../../lib/api";
import { ArrowLeft, BadgeCheck, Check, Cloud, FolderInput, HardDrive, KeyRound, LoaderCircle, LogIn, MailCheck, RotateCw, ShieldCheck, UserPlus } from "lucide-react";
import { AppLogo } from "../../components/shell/AppLogo";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Field } from "../../components/ui/Field";
import { SegmentedControl } from "../../components/ui/SegmentedControl";
import { ThemeToggle } from "../../components/shell/ThemeToggle";
import { isMac, WindowControls } from "../../components/shell/WindowControls";
import { PasswordInput } from "./PasswordInput";

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
  // Bản không server: tài khoản chỉ lưu trên máy, đăng ký không cần mã email, không có quên mật khẩu / mã giới thiệu
  const local = state.cloudEnabled === false;
  const mismatch = register && confirm.length > 0 && confirm !== password;
  const canSubmit = email.trim() && password && (!register || displayName.trim() && password.length >= 8 && confirm === password && !(referrer && !referrer.valid));
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
          adoptLegacy: state.legacyData && adoptLegacy
        });
        if (pending2.user) return onAuthed(pending2.user);
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
  return <div className="flex h-screen flex-col bg-background">
    <header className="app-drag flex h-titlebar shrink-0 items-center justify-between">
      <div className={`flex items-center gap-space-xs ${isMac ? "pl-[76px]" : "pl-space-md"}`}>
        <AppLogo size={18} />
        <span className="text-label-md font-semibold text-on-surface">NT Studio</span>
      </div>
      <div className="flex items-center"><ThemeToggle className="mr-space-sm" />{!isMac && <WindowControls />}</div>
    </header>
    <main className="flex flex-1 items-center justify-center overflow-y-auto p-space-lg">
      <div className="grid w-full max-w-[880px] grid-cols-1 overflow-hidden rounded-2xl border border-outline-variant/30 bg-surface-container-low shadow-flyout md:grid-cols-[1fr_420px]">
        <section className="hidden flex-col justify-between gap-space-xl bg-gradient-to-br from-primary-container/30 via-surface-container to-secondary-container/20 p-space-xl md:flex">
          <div>
            <div className="flex items-center gap-space-sm">
              <AppLogo size={28} />
              <span className="text-headline-md text-on-surface">NT Studio</span>
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
              {local ? "Chạy hoàn toàn trên máy – không cần mạng để đăng nhập." : "Đăng nhập bằng tài khoản NT – dùng trên các máy theo gói, mất mạng vẫn chạy được vài ngày."}
            </li>
            <li className="flex gap-space-sm">
              <BadgeCheck size={16} className="mt-0.5 shrink-0 text-tertiary" />
              {local ? "Mở sẵn đầy đủ tính năng, không giới hạn số kênh." : "Tài khoản mới được dùng thử miễn phí ngay sau khi đăng ký."}
            </li>
          </ul>
        </section>
        {verify ? <VerifyEmailStep pending={verify} onAuthed={onAuthed} onBack={() => setVerify(null)} /> : forgot ? <ForgotPasswordStep initialEmail={email} remember={remember} onAuthed={onAuthed} onBack={() => setForgot(false)} /> : <section className="flex flex-col gap-space-md p-space-xl">
          <div>
            <h1 className="text-headline-md text-on-surface">{register ? "Tạo tài khoản NT" : "Đăng nhập NT"}</h1>
            <p className="text-body-sm text-on-surface-variant">
              {register ? local ? "Tài khoản lưu trên máy này – dữ liệu (kênh, video, lịch đăng) cũng nằm trên máy." : "Dùng thử miễn phí ngay – dữ liệu (kênh, video, lịch đăng) lưu trên máy của bạn." : "Đăng nhập bằng tài khoản NT của bạn."}
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
              { value: "register", label: "Tạo tài khoản" }
            ]}
          />
          {register && state.legacyData && <label className="flex items-start gap-space-sm rounded-lg bg-secondary/10 p-space-sm text-body-sm text-on-surface">
            <input type="checkbox" checked={adoptLegacy} onChange={(e) => setAdoptLegacy(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-primary-container" />
            <span>
              Chuyển dữ liệu từ phiên bản trước trên máy này (kênh, token, video, lịch đăng…) vào tài khoản mới.
              <span className="block text-label-sm text-on-surface-variant">
                Không chọn → tài khoản bắt đầu trống, dữ liệu cũ vẫn được giữ nguyên để chuyển sau.
              </span>
            </span>
          </label>}
          {!state.vaultAvailable && <p className="rounded-lg bg-warning/10 p-space-sm text-body-sm text-warning">
            Hệ điều hành không cung cấp kho khóa an toàn – không thể lưu token và không ghi nhớ đăng nhập được.
          </p>}
          <form
            className="flex flex-col gap-space-md"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            {register && <Field label="Tên hiển thị" required={true}>
              {(id) => <Input id={id} value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={80} autoComplete="name" autoFocus={true} />}
            </Field>}
            <Field label="Email" required={true}>
              {(id) => <Input id={id} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" autoFocus={!register} />}
            </Field>
            <Field label="Mật khẩu" required={true} hint={register ? "Tối thiểu 8 ký tự" : void 0}>
              {(id) => <PasswordInput id={id} value={password} onChange={setPassword} autoComplete={register ? "new-password" : "current-password"} />}
            </Field>
            {!register && !local && <button
              type="button"
              onClick={() => (setForgot(true), setError(null))}
              className="-mt-space-sm self-end text-label-md text-primary hover:underline"
            >
              Quên mật khẩu?
            </button>}
            {register && <Field label="Nhập lại mật khẩu" required={true} error={mismatch ? "Mật khẩu không khớp" : null}>
              {(id) => <PasswordInput id={id} value={confirm} onChange={setConfirm} autoComplete="new-password" />}
            </Field>}
            {register && !local && <div className="grid grid-cols-2 gap-space-sm">
              <Field label="Số điện thoại">
                {(id) => <Input id={id} value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={30} autoComplete="tel" />}
              </Field>
              <Field
                label="Mã giới thiệu"
                error={referrer && !referrer.valid ? "Mã không tồn tại" : null}
                hint={referrer?.valid ? void 0 : "Nếu có"}
              >
                {(id) => <Input
                  id={id}
                  value={referral}
                  onChange={(e) => (setReferral(e.target.value.toUpperCase()), setReferrer(null))}
                  onBlur={() => void checkReferral()}
                  maxLength={20}
                  className="font-mono uppercase"
                />}
              </Field>
              {referrer?.valid && <p className="col-span-2 -mt-space-xs flex items-center gap-1 text-label-sm text-tertiary">
                <Check size={12} />
                {" Người giới thiệu: "}
                {referrer.name}
              </p>}
            </div>}
            <label className="flex items-center gap-space-sm text-body-sm text-on-surface">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="h-4 w-4 accent-primary-container" />
              Ghi nhớ đăng nhập trên máy này (30 ngày)
            </label>
            {error && <p className="rounded-lg bg-danger/10 p-space-sm text-body-sm text-error">{error}</p>}
            <Button variant="primary" type="submit" disabled={!canSubmit || pending} className="h-10">
              {pending ? <LoaderCircle size={15} className="animate-spin" /> : register ? <UserPlus size={15} /> : <LogIn size={15} />}
              {pending ? register ? local ? "Đang tạo tài khoản…" : "Đang gửi mã xác thực…" : "Đang đăng nhập…" : register ? local ? "Tạo tài khoản" : "Tiếp tục – gửi mã xác thực email" : "Đăng nhập"}
            </Button>
          </form>
          {state.hasUsers && !local && <p className="text-label-sm text-on-surface-variant">
            {"Đã dùng app trên máy này từ trước? Đăng ký / đăng nhập NT bằng "}
            <b>cùng email và mật khẩu cũ</b>
            {" để giữ nguyên dữ liệu."}
          </p>}
          <DataFolderLink />
        </section>}
      </div>
    </main>
  </div>;
}

function ForgotPasswordStep({ initialEmail, remember, onAuthed, onBack }) {
  const [email, setEmail] = useState(initialEmail);
  const [sent, setSent] = useState(null);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [info, setInfo] = useState(null);
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1e3);
    return () => clearInterval(t);
  }, []);
  const wait = Math.max(0, Math.ceil((resendAt - now) / 1e3));
  const mismatch = confirm.length > 0 && confirm !== password;
  const canReset = code.length === 6 && password.length >= 8 && confirm === password;
  const send = async (again) => {
    if (busy || !email.trim() || again && wait > 0) return;
    setBusy(true);
    setError(null);
    try {
      const r = await call("auth.forgotPassword", { email });
      setSent(r);
      setNow(Date.now());
      setResendAt(Date.now() + r.resendInSeconds * 1e3);
      setCode("");
      setInfo(again ? "Đã gửi mã mới – mã cũ không còn dùng được." : null);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const reset = async () => {
    if (!canReset || busy || !sent) return;
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      onAuthed(await call("auth.resetPassword", { email: sent.email, code, newPassword: password, remember }));
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };
  return <section className="flex flex-col gap-space-md p-space-xl">
    <button type="button" onClick={onBack} className="flex items-center gap-1 self-start text-label-md text-on-surface-variant hover:text-on-surface">
      <ArrowLeft size={14} />
      {" Quay lại đăng nhập"}
    </button>
    <div>
      <KeyRound size={28} className="text-secondary" />
      <h1 className="mt-space-sm text-headline-md text-on-surface">Quên mật khẩu</h1>
      <p className="mt-1 text-body-sm text-on-surface-variant">
        {sent ? <>
          {"Nếu "}
          <b className="break-all text-on-surface">{sent.email}</b>
          {" có tài khoản NT, mã 6 số đã được gửi tới email này (hiệu lực"}
          {" "}
          {Math.round(sent.expiresInSeconds / 60)}
          {" phút). Không thấy thư? Xem thêm mục Spam / Quảng cáo."}
        </> : "Nhập email tài khoản NT – chúng tôi gửi mã 6 số để bạn đặt mật khẩu mới. Dữ liệu trên máy được giữ nguyên."}
      </p>
    </div>
    {!sent ? <form
      className="flex flex-col gap-space-md"
      onSubmit={(e) => {
        e.preventDefault();
        void send(false);
      }}
    >
      <Field label="Email" required={true}>
        {(id) => <Input id={id} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" autoFocus={true} />}
      </Field>
      {error && <p className="rounded-lg bg-danger/10 p-space-sm text-body-sm text-error">{error}</p>}
      <Button variant="primary" type="submit" disabled={!email.trim() || busy} className="h-10">
        {busy ? <LoaderCircle size={15} className="animate-spin" /> : <MailCheck size={15} />}
        {" Gửi mã đặt lại mật khẩu"}
      </Button>
    </form> : <form
      className="flex flex-col gap-space-md"
      onSubmit={(e) => {
        e.preventDefault();
        void reset();
      }}
    >
      <Field label="Mã xác thực" required={true}>
        {(id) => <Input
          id={id}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus={true}
          placeholder="••••••"
          className="h-11 text-center font-mono text-[22px] tracking-[0.5em]"
        />}
      </Field>
      <Field label="Mật khẩu mới" required={true} hint="Tối thiểu 8 ký tự">
        {(id) => <PasswordInput id={id} value={password} onChange={setPassword} autoComplete="new-password" />}
      </Field>
      <Field label="Nhập lại mật khẩu mới" required={true} error={mismatch ? "Mật khẩu không khớp" : null}>
        {(id) => <PasswordInput id={id} value={confirm} onChange={setConfirm} autoComplete="new-password" />}
      </Field>
      {error && <p className="rounded-lg bg-danger/10 p-space-sm text-body-sm text-error">{error}</p>}
      {info && !error && <p className="rounded-lg bg-tertiary/10 p-space-sm text-body-sm text-tertiary">{info}</p>}
      <Button variant="primary" type="submit" disabled={!canReset || busy} className="h-10">
        {busy ? <LoaderCircle size={15} className="animate-spin" /> : <LogIn size={15} />}
        {busy ? "Đang đặt mật khẩu…" : "Đặt mật khẩu mới & đăng nhập"}
      </Button>
      <button
        type="button"
        onClick={() => void send(true)}
        disabled={wait > 0 || busy}
        className="flex items-center gap-1 self-center text-label-md text-primary hover:underline disabled:text-on-surface-variant disabled:no-underline"
      >
        <RotateCw size={13} />
        {" "}
        {wait > 0 ? `Gửi lại mã sau ${wait} giây` : "Gửi lại mã"}
      </button>
    </form>}
  </section>;
}

function VerifyEmailStep({ pending, onAuthed, onBack }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [info, setInfo] = useState(null);
  const [resendAt, setResendAt] = useState(() => Date.now() + pending.resendInSeconds * 1e3);
  const [now, setNow] = useState(Date.now());
  const [resending, setResending] = useState(false);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1e3);
    return () => clearInterval(t);
  }, []);
  const wait = Math.max(0, Math.ceil((resendAt - now) / 1e3));
  const submit = async (value = code) => {
    if (value.length !== 6 || busy) return;
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      onAuthed(await call("auth.registerVerify", { email: pending.email, code: value }));
    } catch (e) {
      setError(e.message);
      setCode("");
      setBusy(false);
    }
  };
  const resend = async () => {
    if (wait > 0 || resending) return;
    setResending(true);
    setError(null);
    try {
      const r = await call("auth.registerResend", { email: pending.email });
      setResendAt(Date.now() + r.resendInSeconds * 1e3);
      setCode("");
      setInfo("Đã gửi mã mới – mã cũ không còn dùng được.");
    } catch (e) {
      setError(e.message);
    } finally {
      setResending(false);
    }
  };
  return <section className="flex flex-col gap-space-md p-space-xl">
    <button type="button" onClick={onBack} className="flex items-center gap-1 self-start text-label-md text-on-surface-variant hover:text-on-surface">
      <ArrowLeft size={14} />
      {" Sửa thông tin đăng ký"}
    </button>
    <div>
      <MailCheck size={28} className="text-secondary" />
      <h1 className="mt-space-sm text-headline-md text-on-surface">Xác thực email</h1>
      <p className="mt-1 text-body-sm text-on-surface-variant">
        {"Đã gửi mã 6 số tới "}
        <b className="break-all text-on-surface">{pending.email}</b>
        {". Mã có hiệu lực "}
        {Math.round(pending.expiresInSeconds / 60)}
        {" phút. Không thấy thư? Xem thêm mục Spam / Quảng cáo."}
      </p>
    </div>
    <form
      className="flex flex-col gap-space-md"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <Field label="Mã xác thực" required={true}>
        {(id) => <Input
          id={id}
          value={code}
          onChange={(e) => {
            const v = e.target.value.replace(/\D/g, "").slice(0, 6);
            setCode(v);
            if (v.length === 6) void submit(v);
          }}
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus={true}
          disabled={busy}
          placeholder="••••••"
          className="h-12 text-center font-mono text-[24px] tracking-[0.5em]"
        />}
      </Field>
      {error && <p className="rounded-lg bg-danger/10 p-space-sm text-body-sm text-error">{error}</p>}
      {info && !error && <p className="rounded-lg bg-tertiary/10 p-space-sm text-body-sm text-tertiary">{info}</p>}
      <Button variant="primary" type="submit" disabled={code.length !== 6 || busy} className="h-10">
        {busy ? <LoaderCircle size={15} className="animate-spin" /> : <UserPlus size={15} />}
        {busy ? "Đang tạo tài khoản…" : "Xác nhận & bắt đầu"}
      </Button>
    </form>
    <button
      type="button"
      onClick={() => void resend()}
      disabled={wait > 0 || resending || busy}
      className="flex items-center gap-1 self-center text-label-md text-primary hover:underline disabled:text-on-surface-variant disabled:no-underline"
    >
      {resending ? <LoaderCircle size={13} className="animate-spin" /> : <RotateCw size={13} />}
      {wait > 0 ? `Gửi lại mã sau ${wait} giây` : "Gửi lại mã"}
    </button>
  </section>;
}

function DataFolderLink() {
  const { data } = useApiQuery("storage.location");
  const use = useApiMutation("storage.useExisting");
  return <div className="flex flex-col gap-1 rounded-lg bg-surface-container-lowest p-space-sm text-label-sm text-on-surface-variant">
    <span>{"Thư mục dữ liệu: "}<span className="break-all font-mono text-[11px]">{data?.root ?? "…"}</span></span>
    <button
      type="button"
      disabled={use.isPending}
      onClick={() => use.mutate(void 0)}
      className="flex items-center gap-1 self-start text-primary hover:underline disabled:opacity-50"
      title="Đổi máy: chọn thư mục dữ liệu OmniPage đã chép từ máy cũ, rồi đăng nhập bằng mật khẩu cũ"
    >
      {use.isPending ? <LoaderCircle size={12} className="animate-spin" /> : <FolderInput size={12} />}
      {" Dùng thư mục dữ liệu có sẵn (chuyển từ máy khác)…"}
    </button>
    {use.error && <span className="text-error">{use.error.message}</span>}
    {use.data?.changed && <span className="text-tertiary">Đang khởi động lại với thư mục dữ liệu mới…</span>}
  </div>;
}
