"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function DeleteMaterialButton({ materialId }: { materialId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!confirming) {
    return (
      <button type="button" className="btn-danger" onClick={() => setConfirming(true)}>
        删除材料
      </button>
    );
  }

  return (
    <span className="row">
      <span className="small">删除后该材料及其试卷、判定记录都会一并移除，且无法恢复。</span>
      <button
        type="button"
        className="btn-danger"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          setError(null);
          try {
            const response = await fetch(`/api/materials/${materialId}`, { method: "DELETE" });
            if (!response.ok) {
              const payload = (await response.json()) as { error?: string };
              setError(payload.error ?? "删除失败");
              return;
            }
            router.replace("/materials");
            router.refresh();
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setPending(false);
          }
        }}
      >
        {pending ? "删除中…" : "确认删除"}
      </button>
      <button type="button" onClick={() => setConfirming(false)} disabled={pending}>
        取消
      </button>
      {error ? <span className="small" style={{ color: "var(--err)" }}>{error}</span> : null}
    </span>
  );
}
