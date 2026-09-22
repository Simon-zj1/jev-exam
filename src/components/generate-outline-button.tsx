"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function GenerateOutlineButton({ materialId }: { materialId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div>
      <button
        type="button"
        className="btn-primary"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          setError(null);
          try {
            const response = await fetch(`/api/materials/${materialId}/outline`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ topicCount: 6 }),
            });
            const payload = (await response.json()) as { error?: string };
            if (!response.ok) {
              setError(payload.error ?? "生成大纲失败");
              return;
            }
            router.refresh();
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setPending(false);
          }
        }}
      >
        {pending ? "正在切分知识点…" : "生成知识点大纲"}
      </button>
      {error ? (
        <div className="banner banner--err" style={{ marginTop: 12 }}>
          {error}
        </div>
      ) : null}
    </div>
  );
}
