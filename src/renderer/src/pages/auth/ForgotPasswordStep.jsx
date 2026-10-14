import { useState, useEffect } from "react";
import { call } from "../../lib/api";
import { ArrowLeft, KeyRound, LoaderCircle, LogIn, MailCheck, RotateCw } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Field } from "../../components/ui/Field";
import { PasswordInput } from "./PasswordInput";

export function ForgotPasswordStep({ initialEmail, remember, onAuthed, onBack }) {
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
    if (busy || !email.trim() || (again && wait > 0)) return;
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
  return (
    <section className="flex flex-col gap-space-md p-space-xl">
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1 self-start text-label-md text-on-surface-variant hover:text-on-surface"
      >
        <ArrowLeft size={14} />
        {" Quay lại đăng nhập"}
      </button>
      <div>
        <KeyRound size={28} className="text-secondary" />
        <h1 className="mt-space-sm text-headline-md text-on-surface">Quên mật khẩu</h1>
        <p className="mt-1 text-body-sm text-on-surface-variant">
          {sent ? (
            <>
              {"Nếu "}
              <b className="break-all text-on-surface">{sent.email}</b>
              {" có tài khoản Omnira, mã 6 số đã được gửi tới email này (hiệu lực"}{" "}
              {Math.round(sent.expiresInSeconds / 60)}
              {" phút). Không thấy thư? Xem thêm mục Spam / Quảng cáo."}
            </>
          ) : (
            "Nhập email tài khoản Omnira – chúng tôi gửi mã 6 số để bạn đặt mật khẩu mới. Dữ liệu trên máy được giữ nguyên."
          )}
        </p>
      </div>
      {!sent ? (
        <form
          className="flex flex-col gap-space-md"
          onSubmit={(e) => {
            e.preventDefault();
            void send(false);
          }}
        >
          <Field label="Email" required={true}>
            {(id) => (
              <Input
                id={id}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                autoFocus={true}
              />
            )}
          </Field>
          {error && <p className="rounded-lg bg-danger/10 p-space-sm text-body-sm text-error">{error}</p>}
          <Button variant="primary" type="submit" disabled={!email.trim() || busy} className="h-10">
            {busy ? <LoaderCircle size={15} className="animate-spin" /> : <MailCheck size={15} />}
            {" Gửi mã đặt lại mật khẩu"}
          </Button>
        </form>
      ) : (
        <form
          className="flex flex-col gap-space-md"
          onSubmit={(e) => {
            e.preventDefault();
            void reset();
          }}
        >
          <Field label="Mã xác thực" required={true}>
            {(id) => (
              <Input
                id={id}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus={true}
                placeholder="••••••"
                className="h-11 text-center font-mono text-[22px] tracking-[0.5em]"
              />
            )}
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
            <RotateCw size={13} /> {wait > 0 ? `Gửi lại mã sau ${wait} giây` : "Gửi lại mã"}
          </button>
        </form>
      )}
    </section>
  );
}
