import { useState } from "react";
import { EyeOff, Eye } from "lucide-react";
import { Input } from "../../components/ui/Input";

export function PasswordInput({ id, value, onChange, autoComplete }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input
        id={id}
        type={show ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        className="pr-9"
      />
      <button
        type="button"
        aria-label={show ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
        onClick={() => setShow((s) => !s)}
        className="absolute right-1 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded text-outline hover:text-on-surface"
      >
        {show ? <EyeOff size={14} /> : <Eye size={14} />}
      </button>
    </div>
  );
}
