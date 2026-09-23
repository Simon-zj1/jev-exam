"use client";

import { useEffect, useState } from "react";

type Theme = "light" | "dark";

function readTheme(): Theme {
  if (typeof document === "undefined") return "light";
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("light");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setTheme(readTheme());
    setMounted(true);
  }, []);

  return (
    <button
      type="button"
      className="theme-toggle"
      aria-label={theme === "dark" ? "切换到浅色模式" : "切换到深色模式"}
      onClick={() => {
        const next: Theme = readTheme() === "dark" ? "light" : "dark";
        document.documentElement.dataset.theme = next;
        try {
          window.localStorage.setItem("jev-exam-theme", next);
        } catch {
          /* 隐私模式下忽略 */
        }
        setTheme(next);
      }}
    >
      {mounted && theme === "dark" ? "浅色" : "深色"}
    </button>
  );
}
