import { ArrowLeft, ClockCounterClockwise } from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { Response } from "@/components/ai-elements/response";
import { Card, CardBody } from "@/components/ui/card";
import { getChangelog } from "@/lib/changelog";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "更新履歴 | 旅ダイス",
  description: "旅ダイスの最新アップデートと改善の記録",
};

export default function ChangelogPage() {
  const releases = getChangelog();

  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(2rem,env(safe-area-inset-top))]">
      <header className="flex items-center gap-3">
        <Link
          href="/"
          className="inline-flex h-9 w-9 items-center justify-center rounded-2xl border-2 border-line bg-surface text-foreground shadow-toy transition-transform active:scale-95"
          aria-label="ホームに戻る"
        >
          <ArrowLeft size={20} weight="bold" />
        </Link>
        <div>
          <h1 className="text-xl font-extrabold tracking-tight">更新履歴</h1>
          <p className="text-xs text-muted">旅ダイスの改善と新機能の記録</p>
        </div>
      </header>

      <main className="mt-8 flex-1 space-y-6">
        {releases.length > 0 ? (
          releases.map((release, index) => (
            <Card key={release.version}>
              <CardBody className="p-5">
                <div className="flex items-center justify-between border-b border-line pb-3">
                  <div className="flex items-center gap-2">
                    <span className="rounded-full border border-line bg-primary/10 px-2.5 py-0.5 text-xs font-extrabold text-primary">
                      v{release.version}
                    </span>
                    {index === 0 && (
                      <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[0.625rem] font-bold text-emerald-600">
                        最新
                      </span>
                    )}
                  </div>
                  <time className="text-xs font-medium text-muted">{release.date}</time>
                </div>
                <div className="pt-3 text-sm">
                  <Response>{release.content}</Response>
                </div>
              </CardBody>
            </Card>
          ))
        ) : (
          <Card>
            <CardBody className="flex flex-col items-center gap-2 p-6 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-surface-2 text-muted">
                <ClockCounterClockwise size={24} weight="duotone" />
              </span>
              <p className="text-sm font-bold">更新履歴がまだありません</p>
              <p className="text-xs leading-relaxed text-muted">
                今後のアップデートにご期待ください。
              </p>
            </CardBody>
          </Card>
        )}
      </main>

      <footer className="mt-auto pt-10 text-center text-xs text-muted">
        TabiDice ©2026 Y.Haruto
      </footer>
    </div>
  );
}
