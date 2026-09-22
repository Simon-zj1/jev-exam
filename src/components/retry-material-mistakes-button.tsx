"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function RetryMaterialMistakesButton({ materialId }: { materialId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <span className="row">
      <button
        type="button"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          setError(null);
          try {
            const response = await fetch(`/api/materials/${materialId}/retry-mistakes`, {
              method: "POST",
            });
            const payload = (await response.json()) as { examId?: string; error?: string };
            if (!response.ok || !payload.examId) {
              setError(payload.error ?? "创建重考失败");
              return;
            }
            router.push(`/exams/${payload.examId}/take`);
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setPending(false);
          }
        }}
      >
        {pending ? "创建中…" : "重考该材料的错题"}
      </button>
      {error ? <span className="small" style={{ color: "var(--err)" }}>{error}</span> : null}
    </span>
  );
}
