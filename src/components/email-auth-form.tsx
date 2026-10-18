import { useState, type FormEvent } from "react";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { authClient } from "@/lib/auth/client";

function explain(message: string | undefined): string {
  const text = message ?? "";
  if (/already exists|already registered/i.test(text)) return "呢個電郵已經註冊咗。";
  if (/invalid email or password|invalid credentials/i.test(text)) return "電郵或密碼唔啱。";
  if (/password/i.test(text)) return "密碼最少 8 個字。";
  return text || "登入失敗，再試一次。";
}

export function EmailAuthForm() {
  const navigate = useNavigate();
  const router = useRouter();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (password.length < 8) {
      setError("密碼最少 8 個字。");
      return;
    }
    setBusy(true);
    setError(null);
    const result =
      mode === "up"
        ? await authClient.signUp.email({
            name: name.trim() || email.split("@")[0] || "User",
            email: email.trim(),
            password,
            callbackURL: "/",
          })
        : await authClient.signIn.email({
            email: email.trim(),
            password,
            callbackURL: "/",
          });
    if (result.error) {
      setBusy(false);
      setError(explain(result.error.message));
      return;
    }
    await router.invalidate();
    await navigate({ to: "/" });
    setBusy(false);
  }

  const field =
    "min-h-11 w-full rounded-xl border border-line bg-paper px-4 text-sm outline-none focus:border-ink";

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2">
      {mode === "up" ? (
        <input
          className={field}
          type="text"
          autoComplete="name"
          placeholder="名稱"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      ) : null}
      <input
        className={field}
        type="email"
        required
        autoComplete="email"
        placeholder="電郵"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
      />
      <input
        className={field}
        type="password"
        required
        minLength={8}
        autoComplete={mode === "up" ? "new-password" : "current-password"}
        placeholder="密碼（最少 8 個字）"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
      />
      {error ? <p className="text-sm text-signal">{error}</p> : null}
      <button
        type="submit"
        disabled={busy}
        className="min-h-11 rounded-xl bg-ink px-4 text-sm font-medium text-paper disabled:opacity-60"
      >
        {busy ? "請等一陣…" : mode === "up" ? "註冊並登入" : "用電郵登入"}
      </button>
      <button
        type="button"
        className="min-h-11 text-sm text-muted hover:text-ink"
        onClick={() => {
          setMode(mode === "up" ? "in" : "up");
          setError(null);
        }}
      >
        {mode === "up" ? "已有帳號？登入" : "未有帳號？註冊"}
      </button>
    </form>
  );
}
