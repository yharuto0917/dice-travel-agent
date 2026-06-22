import type { Icon } from "@phosphor-icons/react";
import {
  MapTrifold,
  DiceFive,
  SlidersHorizontal,
  Sparkle,
  BookOpenText,
} from "@phosphor-icons/react/dist/ssr";

/** 行き先決定 → 計画 → しおり までの画面フロー定義（ルーティング骨組みの単一の真実）。 */
export type FlowStep = {
  slug: string;
  path: string;
  title: string;
  subtitle: string;
  icon: Icon;
  /** 本実装を担当するIssue番号 */
  issue: number;
};

export const FLOW_STEPS: FlowStep[] = [
  {
    slug: "destination",
    path: "/destination",
    title: "行き先候補",
    subtitle: "日本地図から6つの候補を選ぶ",
    icon: MapTrifold,
    issue: 7,
  },
  {
    slug: "dice",
    path: "/dice",
    title: "サイコロ",
    subtitle: "出た目で行き先を決める（振り直し3回）",
    icon: DiceFive,
    issue: 9,
  },
  {
    slug: "conditions",
    path: "/conditions",
    title: "旅の条件",
    subtitle: "テーマ・予算感・カスタマイズを入力",
    icon: SlidersHorizontal,
    issue: 11,
  },
  {
    slug: "generating",
    path: "/generating",
    title: "計画作成中",
    subtitle: "AI Agentが旅程を組み立てる",
    icon: Sparkle,
    issue: 13,
  },
  {
    slug: "itinerary",
    path: "/itinerary",
    title: "旅のしおり",
    subtitle: "冊子風レイアウトで計画を表示",
    icon: BookOpenText,
    issue: 19,
  },
];
