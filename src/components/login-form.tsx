"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        setPending(true);
        setError(null);
        try {
          const response = await fetch("/api/auth/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, inviteCode }),
          });
          const payload = (await response.json()) as { error?: string };
          if (!response.ok) {
            setError(payload.error ?? "登录失败");
            return;
          }
          router.replace("/");
          router.refresh();
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setPending(false);
        }
      }}
    >
      <div className="field">
        <label htmlFor="email">邮箱</label>
        <input
          id="email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
        />
      </div>
      <div className="field">
        <label htmlFor="invite">邀请码（首次使用必填）</label>
        <input
          id="invite"
          type="text"
          value={inviteCode}
          onChange={(event) => setInviteCode(event.target.value)}
          placeholder="例如 DEV-INVITE"
        />
      </div>
      {error ? <div className="banner banner--err">{error}</div> : null}
      <button className="btn-primary" type="submit" disabled={pending}>
        {pending ? "登录中…" : "进入"}
      </button>
    </form>
  );
}
