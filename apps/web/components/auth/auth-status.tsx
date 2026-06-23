"use client";

import { SignOut } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";

/** ヘッダー用のログイン状態表示（ログイン中はログアウト、未ログインはログイン導線）。 */
export function AuthStatus() {
  const { user, loading, configured, logout } = useAuth();

  if (!configured || loading) return null;

  if (!user) {
    return (
      <Link href="/login" className={buttonVariants({ variant: "outline", size: "sm" })}>
        ログイン
      </Link>
    );
  }

  return (
    <button
      type="button"
      onClick={() => logout()}
      className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
      aria-label="ログアウト"
    >
      <SignOut size={16} weight="bold" />
      <span className="max-w-24 truncate">{user.displayName ?? "ログアウト"}</span>
    </button>
  );
}
