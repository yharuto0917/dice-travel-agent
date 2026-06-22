import Link from "next/link";
import { ArrowRight, ArrowLeft, Wrench } from "@phosphor-icons/react/dist/ssr";
import { AppShell } from "@/components/layout/app-shell";
import { Card, CardBody } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { FLOW_STEPS } from "@/lib/flow";
import { cn } from "@/lib/utils";

/** フロー各画面の共通プレースホルダー。進捗ステッパー＋前後ナビ付き。 */
export function FlowPlaceholder({ index }: { index: number }) {
  const step = FLOW_STEPS[index];
  const StepIcon = step.icon;
  const prev = index > 0 ? FLOW_STEPS[index - 1] : null;
  const next = index < FLOW_STEPS.length - 1 ? FLOW_STEPS[index + 1] : null;

  return (
    <AppShell title={step.title} back={{ href: prev?.path ?? "/" }}>
      <div className="flex flex-1 flex-col">
        {/* 進捗ステッパー */}
        <ol className="flex items-center gap-1.5">
          {FLOW_STEPS.map((s, i) => (
            <li
              key={s.slug}
              className={cn(
                "h-1.5 flex-1 rounded-full",
                i <= index ? "bg-primary" : "bg-surface-2",
              )}
            />
          ))}
        </ol>
        <p className="mt-3 text-xs font-bold tracking-wide text-muted">
          STEP {String(index + 1).padStart(2, "0")} / {String(FLOW_STEPS.length).padStart(2, "0")}
        </p>

        <Card className="mt-4">
          <CardBody className="flex flex-col items-center gap-4 px-6 py-10 text-center">
            <span className="flex h-20 w-20 items-center justify-center rounded-3xl bg-surface-2 text-primary shadow-pip">
              <StepIcon size={44} weight="duotone" />
            </span>
            <div>
              <h1 className="text-xl font-extrabold">{step.title}</h1>
              <p className="mt-2 text-sm leading-relaxed text-muted">{step.subtitle}</p>
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-sun/25 px-3 py-1 text-xs font-bold text-wood">
              <Wrench size={14} weight="bold" />
              実装予定: #{step.issue}
            </span>
          </CardBody>
        </Card>

        <div className="mt-auto flex items-center gap-3 pt-8">
          <Link
            href={prev?.path ?? "/"}
            className={cn(buttonVariants({ variant: "outline" }), "flex-1")}
          >
            <ArrowLeft size={18} weight="bold" />
            {prev ? prev.title : "ホーム"}
          </Link>
          <Link
            href={next?.path ?? "/"}
            className={cn(buttonVariants(), "flex-1")}
          >
            {next ? next.title : "ホームへ"}
            <ArrowRight size={18} weight="bold" />
          </Link>
        </div>
      </div>
    </AppShell>
  );
}
