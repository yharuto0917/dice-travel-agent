import {
  type AgentState,
  AgentStateSchema,
  type GeoPoint,
  type HitlQuestion,
  type TravelPlanDraft,
} from "@repo/shared";
import { Agent, callable } from "agents";
import { eq } from "drizzle-orm";
import { createClients } from "../clients";
import { getDb } from "../db/client";
import { type PlanRow, plans, planVersions } from "../db/schema";
import type { Bindings } from "../env";
import { createUsageCounter, HITL_TIMEOUT_SEC } from "./flow/judgement";
import { dayCountOf, mergeDay, nightsOf } from "./flow/merge";
import { runDay } from "./flow/orchestrator";
import { buildStepPlan } from "./flow/step-plan";
import {
  answeredMap,
  answerInList,
  hasPending,
  skipInList,
  skipManyInList,
} from "./hitl/questions";
import { hasLlm } from "./llm/provider";
import { PLAN_PIPELINE } from "./pipeline";
import type { ToolContext } from "./tools/context";
import { checkPlan } from "./validation/checker";
import { fillEmptyDays, fixPlan } from "./validation/fix";

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

      const ctx: ToolContext = {
        clients,
        destPoint,
        conditions: row.conditions || {},
        usage: createUsageCounter(),
        // 再開時、既回答の HITL Q&A をプロンプトへ反映し同じ質問の再発行を防ぐ。
        hitl: { pending: [], answers: answeredMap(this.state.questions) },
      };

      // ストリーミングの実行状況・思考要約を activity / thought に反映する。
      const result = await runDay(this.env, ctx, plan, n, (status, thought) =>
        this.setActivity(status, thought ?? null),
      );

      // 計画担当が humanInTheLoop を呼んだら、当日を確定せず回答待ちで保留する。
      if (result.status === "hitl") {
        await this.enterAwaitingUser(index, result.questions);
        return;
      }

      plan = mergeDay(plan, result.day);

      this.setState({
        ...this.state,
        phase: "designing",
        plan,
        filledSections: [...new Set([...this.state.filledSections, `day${n}`])],
        progress: (index + 1) / steps.length,
        activity: null, // 当日完了。次ステップ開始までクリア。
        thought: null,
      });
    } else if (step.type === "finalize") {
      await this.finalizePlan(plan, row);
      // 永続化まで完了したのでここで終了（次 step は schedule しない）。
      return;
    }

    await this.schedule(
      STEP_DELAY_SEC,
      "runStep",
      { index: index + 1 },
      { retry: { maxAttempts: 3 } },
    );
  }

  /**
   * 最終確定（#16）: 行き先/条件を注入して完成スキーマへ寄せ → checker → fix →
   * 失敗時は決定的フォールバック（best-effort を completed 保存）。
   * 上書き前に旧版を plan_versions へ退避し、部分失敗でも作業を失わない。
   */
  private async finalizePlan(plan: TravelPlanDraft, row: PlanRow): Promise<void> {
    this.setActivity("計画を検証・保存しています…");
    const destPoint = await this.loadDestPoint(createClients(this.env), row.destinationPref);

    // 完成スキーマが要求する必須項目（id/destination/conditions/images）を既知値から補う。
    const candidate: TravelPlanDraft = {
      ...plan,
      id: plan.id ?? this.name,
      status: "completed",
      ...(row.conditions ? { conditions: row.conditions } : {}),
      ...(destPoint && row.destinationPrefCode
        ? {
            destination: {
              id: this.name,
              prefectureCode: row.destinationPrefCode,
              prefecture: row.destinationPref ?? "",
              location: destPoint,
              tags: [],
            },
          }
        : {}),
      images: plan.images ?? [],
      createdAt: plan.createdAt ?? new Date().toISOString(),
    };

    const check = checkPlan(candidate);
    let finalPlan: TravelPlanDraft;
    if (check.valid && check.parsed) {
      finalPlan = check.parsed;
    } else {
      // まず「予定が空の日」を1日ずつ個別に再生成して埋める。全体を作り直す fixPlan は
      // 複数日の全 JSON が出力上限を超えると切り詰めで破綻し修復が効かないため、出力が
      // 小さく確実に収まる per-day 修復を先に通す（ユーザー報告の「各日の旅程が出ない」対策）。
      let repaired = candidate;
      if ((candidate.days ?? []).some((d) => d.items.length === 0)) {
        this.setActivity("空の日程を作り直しています…");
        try {
          repaired = await fillEmptyDays(this.env, candidate);
        } catch {
          repaired = candidate;
        }
      }

      const recheck = checkPlan(repaired);
      if (recheck.valid && recheck.parsed) {
        finalPlan = recheck.parsed;
      } else {
        // 残る軽微欠落（日数整合・予算超過など）は generateObject で修復（completed パスは
        // 常に LLM 有）。修復が例外を投げても finalize を止めない: catch して best-effort を保存。
        let fixed: TravelPlanDraft | null = null;
        try {
          fixed = await fixPlan(this.env, repaired, recheck.errors);
        } catch {
          fixed = null;
        }
        // 修復不能でも破綻させない: per-day 修復済みの best-effort を completed として保存する。
        finalPlan = fixed ?? repaired;
      }
    }

    await this.persistPlan(finalPlan, row);

    this.setState({
      ...this.state,
      phase: "done",
      plan: finalPlan,
      filledSections: [...new Set([...this.state.filledSections, "summary"])],
      progress: 1,
      activity: null,
      thought: null,
    });
  }

  /**
   * ストリーミング中の実行状況（activity）と思考要約（thought）を反映する。
   * 値に変化が無ければ setState せず、ブロードキャストの氾濫を防ぐ。
   */
  private setActivity(status: string, thought: string | null = null): void {
    if (this.state.activity === status && this.state.thought === thought) return;
    this.setState({ ...this.state, activity: status, thought });
  }

  /** 完成計画を D1 に保存。上書き前に旧版を plan_versions へスナップショットする（#16）。 */
  private async persistPlan(finalPlan: TravelPlanDraft, row: PlanRow): Promise<void> {
    const db = getDb(this.env);
    const currentVersion = row.version ?? 1;

    if (row.plan) {
      await db.insert(planVersions).values({
        id: crypto.randomUUID(),
        planId: this.name,
        version: currentVersion,
        plan: row.plan,
      });
    }

    await db
      .update(plans)
      .set({
        plan: finalPlan,
        status: "completed",
        title: finalPlan.title ?? row.title,
        version: currentVersion + 1,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(plans.id, this.name));

    // 次回 loadPlanRow で最新を読むようキャッシュを無効化する。
    this.cachedRow = undefined;
  }

  /** HITL 回答待ちへ遷移し、タイムアウト alarm を仕掛ける（次 step は schedule しない）。 */
  private async enterAwaitingUser(index: number, newQuestions: HitlQuestion[]): Promise<void> {
    this.setState({
      ...this.state,
      phase: "awaiting_user",
      questions: [...this.state.questions, ...newQuestions],
      resumeIndex: index,
      awaitingSince: new Date().toISOString(),
      activity: null,
      thought: null,
    });

    // 期限到来で未回答を skip して同 index を再開する（破綻させない）。
    await this.schedule(HITL_TIMEOUT_SEC, "hitlTimeout", {
      index,
      ids: newQuestions.map((q) => q.id),
    });
  }

  @callable()
  async answerQuestion(id: string, answer: string): Promise<void> {
    const questions = answerInList(this.state.questions, id, answer);
    this.setState({ ...this.state, questions });
    await this.maybeResume(questions);
  }

  @callable()
  async skipQuestion(id: string): Promise<void> {
    const questions = skipInList(this.state.questions, id);
    this.setState({ ...this.state, questions });
    await this.maybeResume(questions);
  }

  /** タイムアウト発火時、未回答の対象質問を skip して再開を試みる。 */
  async hitlTimeout(payload: { index: number; ids: string[] }): Promise<void> {
    // 既に再開済み／別ステップへ進んでいれば何もしない（二重再開防止）。
    if (this.state.phase !== "awaiting_user") return;
    if (this.state.resumeIndex !== payload.index) return;

    const questions = skipManyInList(this.state.questions, payload.ids);
    this.setState({ ...this.state, questions });
    await this.maybeResume(questions);
  }

  /** pending が無くなったら designing へ戻し、保留中だった runStep(index) を再 schedule する。 */
  private async maybeResume(questions: HitlQuestion[]): Promise<void> {
    if (this.state.phase !== "awaiting_user") return;
    if (hasPending(questions)) return; // まだ未回答が残る

    const index = this.state.resumeIndex;
    this.setState({
      ...this.state,
      phase: "designing",
      resumeIndex: null,
      awaitingSince: null,
    });

    if (index !== null) {
      await this.schedule(STEP_DELAY_SEC, "runStep", { index }, { retry: { maxAttempts: 3 } });
    }
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
