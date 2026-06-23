"use client";

import { CircleNotch } from "@phosphor-icons/react/dist/ssr";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth-context";

/** 未ログイン時は /login へ誘導する保護ラッパー。 */
export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading, configured } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (configured && !loading && !user) {
      router.replace("/login");
    }
  }, [configured, loading, user, router]);

  // Firebase 未設定時は素通り（開発用。本番では設定必須）
  if (!configured) return <>{children}</>;

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center text-muted">
        <CircleNotch size={28} weight="bold" className="animate-spin" />
      </div>
    );
  }

  if (!user) return null; // リダイレクト中

  return <>{children}</>;
}
