"use client";

export function PrintButton({ label = "打印 / 存 PDF" }: { label?: string }) {
  return (
    <button className="no-print" type="button" onClick={() => window.print()}>
      {label}
    </button>
  );
}
