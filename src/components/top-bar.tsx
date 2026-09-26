import Link from "next/link";
import type { UserRecord } from "@/lib/db/types";
import { BrandMark } from "@/components/brand-mark";
import { LogoutButton } from "@/components/logout-button";
import { ThemeToggle } from "@/components/theme-toggle";

export function TopBar({ user }: { user: UserRecord | null }) {
  return (
    <header className="topbar">
      <div className="topbar__inner">
        <Link href="/" className="brand">
          <BrandMark size={22} />
          Jev<span>备考</span>
        </Link>
        <nav className="nav">
          <Link href="/materials">材料</Link>
          <Link href="/reviews">复习</Link>
          <Link href="/mistakes">错题本</Link>
          <Link href="/settings">设置</Link>
        </nav>
        <div className="topbar__right">
          <ThemeToggle />
          {user ? (
            <>
              <span>{user.email}</span>
              <LogoutButton />
            </>
          ) : (
            <Link href="/login">登录</Link>
          )}
        </div>
      </div>
    </header>
  );
}
