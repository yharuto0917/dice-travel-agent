import { ArrowRight, DiceFive, MapPinLine, PaintBrushBroad } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { FLOW_STEPS } from "@/lib/flow";
import { cn } from "@/lib/utils";

export default function Home() {
  return (
    <div className="flex min-h-dvh flex-col px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(2rem,env(safe-area-inset-top))]">
      <header className="flex items-center gap-2.5">
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-2xl border-2 border-line bg-primary text-primary-foreground shadow-toy">
          <DiceFive size={22} weight="fill" />
        </span>
        <span className="text-lg font-extrabold tracking-tight">ミニ旅ダイス</span>
      </header>

      <section className="mt-10">
        <p className="inline-flex items-center gap-1.5 rounded-full border-2 border-line bg-surface px-3 py-1 text-xs font-bold text-muted shadow-toy">
          <MapPinLine size={14} weight="bold" />
          ミニチュアの日本を旅する
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
        <Link href="/styleguide" className={buttonVariants({ variant: "outline", size: "lg" })}>
          <PaintBrushBroad size={20} weight="bold" />
          デザイン土台プレビュー
        </Link>
      </div>

      <section className="mt-10">
        <h2 className="text-xs font-bold uppercase tracking-wide text-muted">旅のながれ</h2>
        <ol className="mt-3 grid gap-2.5">
          {FLOW_STEPS.map((step, i) => {
            const StepIcon = step.icon;
            return (
              <li key={step.slug}>
                <Link href={step.path} className="block">
                  <Card className="transition hover:-translate-y-0.5 hover:shadow-toy-lg">
                    <CardBody className="flex items-center gap-3 p-4">
                      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-surface-2 text-foreground">
                        <StepIcon size={22} weight="duotone" />
                      </span>
                      <span className="min-w-0">
                        <span className="flex items-center gap-2 text-sm font-bold">
                          <span className="text-muted">{String(i + 1).padStart(2, "0")}</span>
                          {step.title}
                        </span>
                        <span className="block truncate text-xs text-muted">{step.subtitle}</span>
                      </span>
                      <ArrowRight
                        size={18}
                        weight="bold"
                        className={cn("ml-auto shrink-0 text-muted")}
                      />
                    </CardBody>
                  </Card>
                </Link>
              </li>
            );
          })}
        </ol>
      </section>

      <footer className="mt-auto pt-10 text-center text-xs text-muted">
        Dice Travel Agent · M0 基盤
      </footer>
    </div>
  );
}
