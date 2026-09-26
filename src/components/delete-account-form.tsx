"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** 删号需要输入自己的邮箱确认：这个动作不可恢复。 */
export function DeleteAccountForm({ email }: { email: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmEmail, setConfirmEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(): Promise<void> {
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/account", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmEmail }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(body.error ?? "删除失败");
        return;
      }
      router.push("/login");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  }

  if (!open) {
    return (
      <button type="button" className="btn-danger" onClick={() => setOpen(true)}>
        删除账号与全部数据
      </button>
    );
  }

  return (
    <div>
      <div className="banner banner--err">
        这会永久删除你的材料、试卷、作答、判定记录、掌握度与复习排期，且无法恢复。
        如果你想保留数据，请先在上方导出。
      </div>
      <div className="field">
        <label htmlFor="confirm-email">输入当前账号邮箱以确认：{email}</label>
        <input
          id="confirm-email"
          type="email"
          value={confirmEmail}
          onChange={(event) => setConfirmEmail(event.target.value)}
          placeholder={email}
        />
      </div>
      {error ? <div className="banner banner--err">{error}</div> : null}
      <div className="row">
        <button
          className="btn-danger"
          type="button"
          disabled={pending || confirmEmail.trim().length === 0}
          onClick={() => void submit()}
        >
          {pending ? "删除中…" : "确认删除"}
        </button>
        <button type="button" disabled={pending} onClick={() => setOpen(false)}>
          取消
        </button>
      </div>
    </div>
  );
}
