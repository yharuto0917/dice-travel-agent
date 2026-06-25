import { type AgentState, AgentStateSchema, type GeoPoint, type HitlQuestion } from "@repo/shared";
import { Agent, callable } from "agents";
import { eq } from "drizzle-orm";
import { createClients } from "../clients";
import { getDb } from "../db/client";
import { type PlanRow, plans } from "../db/schema";
import type { Bindings } from "../env";
import { createUsageCounter } from "./flow/judgement";
import { dayCountOf, mergeDay, nightsOf } from "./flow/merge";
import { runDay } from "./flow/orchestrator";
import { buildStepPlan } from "./flow/step-plan";
import { hasLlm } from "./llm/provider";
import { PLAN_PIPELINE } from "./pipeline";

/** ステップ間の待ち（秒）。進行をクライアントで可視化するための小さな間隔。 */
const STEP_DELAY_SEC = 1;

export class TravelPlanningAgent extends Agent<Bindings, AgentState> {
  initialState: AgentState = AgentStateSchema.parse({});

  validateStateChange(next: AgentState): void {
    const result = AgentStateSchema.safeParse(next);
    if (!result.success) {
      throw new Error(`Invalid AgentState: ${result.error.message}`);
    }
  }

  @callable()
  async start(): Promise<void> {
    if (this.state.phase !== "idle" && this.state.phase !== "error") return;

    const row = await this.loadPlanRow();
    if (!row) {
      this.setState({ ...this.state, phase: "error", error: "plan not found" });
      return;
    }

    this.setState({ ...this.state, phase: "understanding", progress: 0, error: null });
    await this.schedule(0, "runStep", { index: 0 });
  }

  async runStep(payload: { index: number }): Promise<void> {
    const { index } = payload;
    const row = await this.loadPlanRow();

    // DO 退避後に行が削除されているとスケジュール実行から runStep が直接呼ばれうる。
    // start() と同じ「plan not found」不変条件をここでも保証し、欠損行から
    // 汎用ダミー計画を完成扱いにしてしまうのを防ぐ。
    if (!row) {
      this.setState({ ...this.state, phase: "error", error: "plan not found" });
      return;
    }

    if (!hasLlm(this.env)) {
      // Fallback to existing PLAN_PIPELINE
      const step = PLAN_PIPELINE[index];
      if (!step) {
        this.setState({ ...this.state, phase: "done", progress: 1 });
        return;
      }

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
      return;
    }

    // AI-based Agent Flow
    const steps = buildStepPlan(row?.conditions);
    const step = steps[index];

    if (!step) {
      this.setState({ ...this.state, phase: "done", progress: 1 });
      return;
    }

    const clients = createClients(this.env);
    let plan = this.state.plan || {};

    if (step.type === "setup") {
      const nights = nightsOf(row.conditions?.nights);
      const dayCount = dayCountOf(nights);

      plan = {
        ...plan,
        status: "draft",
        title: `${row.destinationPref || "目的地"}の旅`,
        summary: `AIが作成した${nights === 0 ? "日帰り" : `${nights}泊${dayCount}日`}のプランです。`,
        nights,
        days: Array.from({ length: dayCount }, (_, i) => ({
          dayNumber: i + 1,
          title: `${i + 1}日目`,
          items: [],
        })),
      };

      this.setState({
        ...this.state,
        phase: "designing",
        plan,
        filledSections: [...new Set([...this.state.filledSections, "conditions"])],
        progress: (index + 1) / steps.length,
      });
    } else if (step.type === "planDay") {
      const n = step.dayNumber;

      // 行き先のジオコーディングは全日で不変なので一度だけ実行してキャッシュする。
      const destPoint = await this.loadDestPoint(clients, row.destinationPref);

      const ctx = {
        clients,
        destPoint,
        conditions: row.conditions || {},
        usage: createUsageCounter(),
      };

      const day = await runDay(this.env, ctx, plan, n);
      plan = mergeDay(plan, day);

      this.setState({
        ...this.state,
        phase: "designing",
        plan,
        filledSections: [...new Set([...this.state.filledSections, `day${n}`])],
        progress: (index + 1) / steps.length,
      });
    } else if (step.type === "finalize") {
      plan = {
        ...plan,
        status: "completed",
        createdAt: new Date().toISOString(),
      };

      this.setState({
        ...this.state,
        phase: "done",
        plan,
        filledSections: [...new Set([...this.state.filledSections, "summary"])],
        progress: 1,
      });
      // Do not schedule next step as this is the end
      return;
    }

    await this.schedule(
      STEP_DELAY_SEC,
      "runStep",
      { index: index + 1 },
      { retry: { maxAttempts: 3 } },
    );
  }

  @callable()
  async answerQuestion(id: string, answer: string): Promise<void> {
    const questions = this.state.questions.map(
      (q): HitlQuestion => (q.id === id ? { ...q, answer, status: "answered" } : q),
    );
    this.setState({ ...this.state, questions });
  }

  onError(connectionOrError: unknown, maybeError?: unknown): void {
    const error = maybeError ?? connectionOrError;
    this.setState({ ...this.state, phase: "error", error: String(error) });
  }

  private cachedRow: PlanRow | null | undefined;

  private async loadPlanRow(): Promise<PlanRow | null> {
    if (this.cachedRow !== undefined) return this.cachedRow;
    const db = getDb(this.env);
    const [row] = await db.select().from(plans).where(eq(plans.id, this.name));
    this.cachedRow = row ?? null;
    return this.cachedRow;
  }

  /** 行き先のジオコーディング結果のメモリキャッシュ。全日で不変なため一度だけ問い合わせる。 */
  private cachedDestPoint: GeoPoint | null | undefined;

  private async loadDestPoint(
    clients: ReturnType<typeof createClients>,
    destinationPref: string | null | undefined,
  ): Promise<GeoPoint | null> {
    if (this.cachedDestPoint !== undefined) return this.cachedDestPoint;
    this.cachedDestPoint = destinationPref
      ? await clients.geocoding.geocode(destinationPref)
      : null;
    return this.cachedDestPoint;
  }
}
