import {
  DiceFive,
  MapTrifold,
  BookOpenText,
  Sparkle,
  Compass,
  Mountains,
  ForkKnife,
  SunHorizon,
} from "@phosphor-icons/react/dist/ssr";
import { AppShell } from "@/components/layout/app-shell";
import { Card, CardBody } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Conversation } from "@/components/ai-elements/conversation";
import { Message, MessageAvatar, MessageContent } from "@/components/ai-elements/message";

const SWATCHES = [
  { name: "background", cls: "bg-background" },
  { name: "surface", cls: "bg-surface" },
  { name: "surface-2", cls: "bg-surface-2" },
  { name: "primary", cls: "bg-primary" },
  { name: "accent", cls: "bg-accent" },
  { name: "sky", cls: "bg-sky" },
  { name: "sun", cls: "bg-sun" },
  { name: "wood", cls: "bg-wood" },
  { name: "foreground", cls: "bg-foreground" },
  { name: "muted", cls: "bg-muted" },
];

const SAMPLE_ICONS = [
  { Icon: DiceFive, label: "DiceFive" },
  { Icon: MapTrifold, label: "MapTrifold" },
  { Icon: Compass, label: "Compass" },
  { Icon: Mountains, label: "Mountains" },
  { Icon: ForkKnife, label: "ForkKnife" },
  { Icon: SunHorizon, label: "SunHorizon" },
  { Icon: BookOpenText, label: "BookOpenText" },
  { Icon: Sparkle, label: "Sparkle" },
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8 first:mt-0">
      <h2 className="mb-3 text-xs font-bold uppercase tracking-wide text-muted">{title}</h2>
      {children}
    </section>
  );
}

export default function StyleguidePage() {
  return (
    <AppShell title="デザイン土台" back={{ href: "/" }}>
      {/* デザイントークン（カラー） */}
      <Section title="カラートークン">
        <div className="grid grid-cols-2 gap-2.5">
          {SWATCHES.map((s) => (
            <Card key={s.name}>
              <CardBody className="flex items-center gap-3 p-3">
                <span className={`h-9 w-9 rounded-xl border border-line ${s.cls}`} />
                <code className="font-mono text-xs text-muted">{s.name}</code>
              </CardBody>
            </Card>
          ))}
        </div>
      </Section>

      {/* タイポグラフィ */}
      <Section title="タイポグラフィ">
        <Card>
          <CardBody className="space-y-2">
            <p className="text-2xl font-extrabold tracking-tight">見出し / Heading 800</p>
            <p className="text-base font-bold">小見出し / Subheading 700</p>
            <p className="text-sm text-foreground">本文テキスト。ミニチュアの日本を旅する。</p>
            <p className="text-xs text-muted">補足テキスト・キャプション (muted)</p>
            <p className="font-mono text-xs text-muted">mono 12345 / dice</p>
          </CardBody>
        </Card>
      </Section>

      {/* ボタン */}
      <Section title="ボタン">
        <Card>
          <CardBody className="flex flex-wrap gap-2.5">
            <Button variant="primary">Primary</Button>
            <Button variant="accent">Accent</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="primary" size="sm">
              Small
            </Button>
          </CardBody>
        </Card>
      </Section>

      {/* Phosphor アイコン サンプル */}
      <Section title="Phosphor アイコン">
        <Card>
          <CardBody>
            <div className="mb-4 flex items-end gap-4">
              <DiceFive size={32} weight="thin" />
              <DiceFive size={32} weight="regular" />
              <DiceFive size={32} weight="bold" />
              <DiceFive size={32} weight="fill" className="text-primary" />
              <DiceFive size={32} weight="duotone" className="text-accent" />
            </div>
            <div className="grid grid-cols-4 gap-3 text-center">
              {SAMPLE_ICONS.map(({ Icon, label }) => (
                <div key={label} className="flex flex-col items-center gap-1.5">
                  <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-surface-2 text-foreground">
                    <Icon size={24} weight="duotone" />
                  </span>
                  <code className="font-mono text-[10px] text-muted">{label}</code>
                </div>
              ))}
            </div>
          </CardBody>
        </Card>
      </Section>

      {/* AI Elements サンプル */}
      <Section title="AI Elements サンプル">
        <Card>
          <CardBody>
            <Conversation>
              <Message role="assistant">
                <MessageAvatar role="assistant" />
                <MessageContent role="assistant">
                  こんにちは！どんな旅にしましょうか？テーマや予算感を教えてください。
                </MessageContent>
              </Message>
              <Message role="user">
                <MessageAvatar role="user" />
                <MessageContent role="user">
                  温泉とローカルグルメ中心で、1泊2日・予算ひかえめでお願いします。
                </MessageContent>
              </Message>
              <Message role="assistant">
                <MessageAvatar role="assistant" />
                <MessageContent role="assistant">
                  承知しました。候補地の天気と宿を調べて、しおりを組み立てますね。
                </MessageContent>
              </Message>
            </Conversation>
            <p className="mt-4 text-xs text-muted">
              ※ 表示専用の土台。#13 / #20 で AI SDK UI (useAgentChat) と結線します。
            </p>
          </CardBody>
        </Card>
      </Section>
    </AppShell>
  );
}
