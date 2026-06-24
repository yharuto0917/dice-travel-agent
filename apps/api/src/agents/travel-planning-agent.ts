import { type AgentState, AgentStateSchema, type HitlQuestion } from "@repo/shared";
import { Agent, callable } from "agents";
import { eq } from "drizzle-orm";
import { getDb } from "../db/client";
import { type PlanRow, plans } from "../db/schema";
import type { Bindings } from "../env";
import { PLAN_PIPELINE } from "./pipeline";

/** ステップ間の待ち（秒）。進行をクライアントで可視化するための小さな間隔。 */
const STEP_DELAY_SEC = 1;

/**
 * 旅程生成エージェント（#13 骨格）。
 *
 * Cloudflare Agents SDK（Durable Object）上で「決まったフロー」を実行し、
 * 計画書ドラフト(`TravelPlanDraft`)を段階的に充填、`setState` で接続中の
 * クライアントへ状態を同期する。各ステップは `this.schedule()` で次を予約する
 * スケジュール駆動のステートマシンで、スケジュールは DO の SQLite に永続するため
 * DO 退避を跨いでも自動再開する（durable execution）。
 *
 * インスタンス名 = planId（`/agents/travel-planning-agent/{planId}`）。
 * 条件・行き先は planId をキーに D1 の `plans` から読み込む。
 *
 * 注: 各ステップの中身はスタブ。実APIツール/Gemini オーケストレーションは #14、
 * HITL 本実装は #15、計画JSONのD1永続化は #16 で実装する。
 */
export class TravelPlanningAgent extends Agent<Bindings, AgentState> {
  /** 既存スキーマの default をそのまま初期状態に使う（phase:"idle" 等）。 */
  initialState: AgentState = AgentStateSchema.parse({});

  /** 状態は常に共有スキーマに適合させる（plan は partial 許容）。 */
  validateStateChange(next: AgentState): void {
    const result = AgentStateSchema.safeParse(next);
    if (!result.success) {
      throw new Error(`Invalid AgentState: ${result.error.message}`);
    }
  }

  /**
   * 計画生成フローを開始する（フロントの接続後に一度だけ呼ぶ）。
   * 冪等: 既に進行中/完了済みなら何もしない（再接続・再描画でも安全）。
   */
  @callable()
  async start(): Promise<void> {
    if (this.state.phase !== "idle" && this.state.phase !== "error") return;

    const firstStep = PLAN_PIPELINE[0];
    if (!firstStep) return;

    const row = await this.loadPlanRow();
    if (!row) {
      this.setState({ ...this.state, phase: "error", error: "plan not found" });
      return;
    }

    this.setState({ ...this.state, phase: firstStep.phase, progress: 0, error: null });
    await this.schedule(0, "runStep", { index: 0 });
  }

  /**
   * パイプラインの1ステップを実行する（schedule から呼ばれる）。
   * 末尾まで来たら `done`。各ステップ末で次ステップをリトライ付きで予約する。
   */
  async runStep(payload: { index: number }): Promise<void> {
    const { index } = payload;
    const step = PLAN_PIPELINE[index];

    // 全ステップ完了
    if (!step) {
      this.setState({ ...this.state, phase: "done", progress: 1 });
      return;
    }

    const row = await this.loadPlanRow();
    const nextPlan = step.fill(this.state.plan ?? {}, {
      conditions: row?.conditions,
      destinationName: row?.destinationPref,
      nowIso: new Date().toISOString(),
    });

    this.setState({
      ...this.state,
      phase: step.phase,
      plan: nextPlan,
      filledSections: [...new Set([...this.state.filledSections, step.section])],
      progress: (index + 1) / PLAN_PIPELINE.length,
    });

    await this.schedule(
      STEP_DELAY_SEC,
      "runStep",
      { index: index + 1 },
      { retry: { maxAttempts: 3 } },
    );
  }

  /**
   * Human-in-the-loop の回答を受け取る足場（#15で本実装）。
   * 該当質問を answered にし、骨格フローでは通常発火しない。
   */
  @callable()
  async answerQuestion(id: string, answer: string): Promise<void> {
    const questions = this.state.questions.map(
      (q): HitlQuestion => (q.id === id ? { ...q, answer, status: "answered" } : q),
    );
    this.setState({ ...this.state, questions });
  }

  /** スケジュール実行などで補足されなかった例外を error 状態として同期する。 */
  onError(connectionOrError: unknown, maybeError?: unknown): void {
    const error = maybeError ?? connectionOrError;
    this.setState({ ...this.state, phase: "error", error: String(error) });
  }

  /**
   * plan 行のメモリキャッシュ。生成中の条件・行き先は不変なので、各ステップで
   * D1 を読み直さず再利用する。未取得は undefined、取得済みで該当なしは null。
   * DO が退避するとメモリは失われ、次回 loadPlanRow で再取得される。
   */
  private cachedRow: PlanRow | null | undefined;

  /**
   * planId（= インスタンス名）で D1 の plan 行を読む。
   * 一度読んだ行は cachedRow に保持し、全ステップで使い回す（同一行の再クエリを避ける）。
   */
  private async loadPlanRow(): Promise<PlanRow | null> {
    if (this.cachedRow !== undefined) return this.cachedRow;
    const db = getDb(this.env);
    const [row] = await db.select().from(plans).where(eq(plans.id, this.name));
    this.cachedRow = row ?? null;
    return this.cachedRow;
  }
}
