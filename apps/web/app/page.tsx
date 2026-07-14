import { ArrowRight, Compass, DiceFive, MapPinLine } from "@phosphor-icons/react/dist/ssr";
import { cookies } from "next/headers";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { formatHistoryDate, HISTORY_COOKIE_NAME, parseHistory } from "@/lib/history";

// cookies() の参照により当ルートは動的レンダリングになり、Home へ戻る度に最新の
// 作成履歴 Cookie を反映する。
export default async function Home() {
  const store = await cookies();
  const history = parseHistory(store.get(HISTORY_COOKIE_NAME)?.value);

  return (
    <div className="flex min-h-dvh flex-col px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(2rem,env(safe-area-inset-top))]">
      <header className="flex items-center gap-2.5">
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-2xl border-2 border-line bg-primary text-primary-foreground shadow-toy">
          <DiceFive size={22} weight="fill" />
        </span>
        <span className="text-lg font-extrabold tracking-tight">旅ダイス</span>
        {process.env.NEXT_PUBLIC_APP_VERSION && (
          <span className="rounded-full border border-line bg-surface px-2 py-0.5 text-[0.625rem] font-bold text-muted">
            v{process.env.NEXT_PUBLIC_APP_VERSION}
          </span>
        )}
      </header>

      <section className="mt-10">
        <p className="inline-flex items-center gap-1.5 rounded-full border-2 border-line bg-surface px-3 py-1 text-xs font-bold text-muted shadow-toy">
          <MapPinLine size={14} weight="bold" />
          あなたの知らない日本を旅する
        </p>
        <h1 className="mt-4 text-[2rem] font-extrabold leading-[1.2] tracking-tight">
          サイコロを振って、
          <br />
          行き先をきめよう。
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          6つの候補からサイコロで行き先を決定。AI Agent があなたの旅のしおりを自動で組み立てます。
        </p>
      </section>

      <div className="mt-7 grid gap-3">
        <Link href="/destination" className={buttonVariants({ size: "lg" })}>
          旅をはじめる
          <ArrowRight size={20} weight="bold" />
        </Link>
      </div>

      <section className="mt-10">
        <h2 className="text-xs font-bold uppercase tracking-wide text-muted">作成した旅</h2>
        {history.length > 0 ? (
          <ol className="mt-3 grid gap-2.5">
            {history.map((entry) => (
              <li key={entry.id}>
                <Link href={`/itinerary?planId=${entry.id}`} className="block">
                  <Card className="transition hover:-translate-y-0.5 hover:shadow-toy-lg">
                    <CardBody className="flex items-center gap-3 p-4">
                      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-surface-2 text-foreground">
                        <Compass size={22} weight="duotone" />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-bold">{entry.title}</span>
                        <span className="block truncate text-xs text-muted">
                          {formatHistoryDate(entry.createdAt)} に作成
                        </span>
                      </span>
                      <ArrowRight size={18} weight="bold" className="ml-auto shrink-0 text-muted" />
                    </CardBody>
                  </Card>
                </Link>
              </li>
            ))}
          </ol>
        ) : (
          <Card className="mt-3">
            <CardBody className="flex flex-col items-center gap-2 p-6 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-surface-2 text-muted">
                <Compass size={24} weight="duotone" />
              </span>
              <p className="text-sm font-bold">まだ作成した旅はありません</p>
              <p className="text-xs leading-relaxed text-muted">
                「旅をはじめる」から最初の旅を作りましょう。
              </p>
            </CardBody>
          </Card>
        )}
      </section>

      <footer className="mt-auto pt-10 text-center text-xs text-muted">
        TabiDice ©2026 Y.Haruto
      </footer>
    </div>
  );
}
