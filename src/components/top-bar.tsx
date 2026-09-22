import Link from "next/link";
import type { UserRecord } from "@/lib/db/types";
import { LogoutButton } from "@/components/logout-button";

export function TopBar({ user }: { user: UserRecord | null }) {
  return (
    <header className="topbar">
      <div className="topbar__inner">
        <Link href="/" className="brand">
          Jev<span>备考</span>
        </Link>
        <nav className="nav">
          <Link href="/materials">材料</Link>
          <Link href="/mistakes">错题本</Link>
          <Link href="/settings">设置</Link>
        </nav>
        <div className="topbar__right">
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
