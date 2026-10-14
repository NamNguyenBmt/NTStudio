import { useState, useEffect } from "react";
import { call } from "../../lib/api";
import { ArrowLeft, LoaderCircle, MailCheck, RotateCw, UserPlus } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Field } from "../../components/ui/Field";

export function VerifyEmailStep({ pending, onAuthed, onBack }) {
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
  return (
    <section className="flex flex-col gap-space-md p-space-xl">
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1 self-start text-label-md text-on-surface-variant hover:text-on-surface"
      >
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
          {(id) => (
            <Input
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
            />
          )}
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
    </section>
  );
}
