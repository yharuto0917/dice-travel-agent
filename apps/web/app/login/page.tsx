"use client";

import { DiceFive, GoogleLogo } from "@phosphor-icons/react/dist/ssr";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { useAuth } from "@/lib/auth-context";

export default function LoginPage() {
  const { user, loading, configured, signInWithGoogle } = useAuth();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (user) router.replace("/destination");
  }, [user, router]);

  const onSignIn = async () => {
    setBusy(true);
    setError(null);
    try {
      await signInWithGoogle();
    } catch {
      setError("サインインに失敗しました。もう一度お試しください。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 px-6">
      <div className="flex flex-col items-center gap-3 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl border-2 border-line bg-primary text-primary-foreground shadow-toy">
          <DiceFive size={30} weight="fill" />
        </span>
        <h1 className="text-2xl font-extrabold tracking-tight">ミニ旅ダイスにログイン</h1>
        <p className="text-sm text-muted">ログインして、サイコロで旅に出かけよう。</p>
      </div>

      <Card className="w-full">
        <CardBody className="flex flex-col gap-3">
          {configured ? (
            <Button onClick={onSignIn} disabled={busy || loading} size="lg">
              <GoogleLogo size={20} weight="bold" />
              {busy ? "サインイン中..." : "Google でログイン"}
            </Button>
          ) : (
            <p className="text-sm leading-relaxed text-muted">
              Firebase が未設定です。<code className="font-mono">docs/firebase-setup.md</code>{" "}
              を参照して環境変数を設定してください。
            </p>
          )}
          {error ? <p className="text-sm font-bold text-accent">{error}</p> : null}
        </CardBody>
      </Card>
    </div>
  );
}
