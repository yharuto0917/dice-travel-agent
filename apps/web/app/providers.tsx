"use client";

import { AuthProvider } from "@/lib/auth-context";

/** クライアント側のグローバルプロバイダ群。 */
export function Providers({ children }: { children: React.ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>;
}
