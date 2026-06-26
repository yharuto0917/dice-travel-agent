import {
  type AgentState,
  AgentStateSchema,
  type GeoPoint,
  type HitlQuestion,
  prefectureCentroid,
  type TimelineEvent,
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
import { runDay, type TimelineInput } from "./flow/orchestrator";
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

/** 実行履歴タイムラインの保持上限。DO state は全同期されるため、古い順に間引いて肥大を防ぐ。 */
const TIMELINE_MAX = 200;

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

    // 新規生成のたびに履歴を初期化し、開始イベントを1件積む（再開時の重複を避ける）。
    this.setState({
      ...this.state,
      phase: "understanding",
      progress: 0,
      error: null,
      timeline: [],
    });
    this.pushTimeline({ kind: "phase", label: "プラン生成を開始しました" });
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
      this.pushTimeline({
        kind: "phase",
        label: `${row.destinationPref || "目的地"}の条件を整理しました（${nights === 0 ? "日帰り" : `${nights}泊${dayCount}日`}）`,
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
        // askedCount は過去に提示済みの質問総数。humanInTheLoop の上限判定に使う（#47）。
        hitl: {
          pending: [],
          answers: answeredMap(this.state.questions),
          askedCount: this.state.questions.length,
        },
      };

      // 当日の生成開始を履歴へ（同 groupId の done と対にして所要が分かるようにする）。
      this.pushTimeline(
        {
          kind: "phase",
          label: `${n}日目の計画を作成しています`,
          status: "start",
          groupId: `day-${n}`,
        },
        n,
      );

      // ストリーミングの実行状況・思考要約を activity / thought に反映し、
      // ツール／サブエージェントの開始・完了を timeline（当日番号付き）へ追記する。
      const result = await runDay(
        this.env,
        ctx,
        plan,
        n,
        (status, thought) => this.setActivity(status, thought ?? null),
        (ev) => this.pushTimeline(ev, n),
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
      this.pushTimeline(
        {
          kind: "phase",
          label: `${n}日目の計画ができました（予定 ${result.day.items.length} 件）`,
          status: "done",
          groupId: `day-${n}`,
        },
        n,
      );
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
    this.pushTimeline({
      kind: "phase",
      label: "計画を検証・保存しています",
      status: "start",
      groupId: "finalize",
    });
    const destPoint = await this.loadDestPoint(createClients(this.env), row.destinationPref);

    // 行き先は確定済み（行に prefectureCode あり）なら必ず destination を構成する。
    // location はジオコーディング結果を優先し、失敗(null)時は県庁所在地の代表点へ
    // フォールバックする。座標欠落で完成スキーマ検証が落ち、completed プランが
    // destination 欠落のまま保存される事態を防ぐ。
    const destLocation = destPoint ?? prefectureCentroid(row.destinationPrefCode);

    // 完成スキーマが要求する必須項目（id/destination/conditions/images）を既知値から補う。
    const candidate: TravelPlanDraft = {
      ...plan,
      id: plan.id ?? this.name,
      status: "completed",
      ...(row.conditions ? { conditions: row.conditions } : {}),
      ...(row.destinationPrefCode && destLocation
        ? {
            destination: {
              id: this.name,
              prefectureCode: row.destinationPrefCode,
              prefecture: row.destinationPref ?? "",
              location: destLocation,
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
    this.pushTimeline({
      kind: "phase",
      label: "プランが完成しました",
      status: "done",
      groupId: "finalize",
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

  /**
   * 実行履歴イベントを timeline へ追記する（#47 可観測性）。id/時刻/日番号を付与し、
   * 古い順に上限件数へ丸めてから setState する。activity（最新の一行）と違い履歴として残る。
   */
  private pushTimeline(input: TimelineInput, dayNumber: number | null = null): void {
    // groupId は当日番号で名前空間化する。orchestrator は日をまたいで同じ groupId
    // （例: "think-1"）を再採番するため、前置しないと別日の start/done が衝突する。
    const groupId = input.groupId
      ? dayNumber != null
        ? `d${dayNumber}:${input.groupId}`
        : input.groupId
      : null;
    const event: TimelineEvent = {
      id: crypto.randomUUID(),
      kind: input.kind,
      label: input.label,
      status: input.status ?? "done",
      groupId,
      detail: input.detail ?? null,
      dayNumber,
      at: new Date().toISOString(),
    };
    const timeline = [...this.state.timeline, event].slice(-TIMELINE_MAX);
    this.setState({ ...this.state, timeline });
  }

  /** 完成計画を D1 に保存。上書き前に旧版を plan_versions へスナップショットする（#16）。 */
  private async persistPlan(finalPlan: TravelPlanDraft, row: PlanRow): Promise<void> {
    const db = getDb(this.env);
    const currentVersion = row.version ?? 1;

    // 旧 plan がある場合のみ「旧版を currentVersion で退避 → 新版を +1」とする。
    // 初回確定（旧 plan が null）はスナップショット対象が無いため version を据え置き、
    // 最初の完成プランを version 1 として残す。据え置かないと最初の版が
    // plan_versions に存在せず diff/履歴から永久に辿れなくなる。
    const nextVersion = row.plan ? currentVersion + 1 : currentVersion;

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
        version: nextVersion,
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

    // 確認待ちに入ったことを履歴へ。質問文を detail に載せ、後から何を聞かれたか追える。
    for (const q of newQuestions) {
      this.pushTimeline({
        kind: "hitl",
        label: "確認をお願いしています",
        status: "start",
        groupId: `hitl-${q.id}`,
        detail: q.question,
      });
    }

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
    this.pushTimeline({
      kind: "hitl",
      label: "回答を受け取りました",
      status: "done",
      groupId: `hitl-${id}`,
      detail: answer,
    });
    await this.maybeResume(questions);
  }

  @callable()
  async skipQuestion(id: string): Promise<void> {
    const questions = skipInList(this.state.questions, id);
    this.setState({ ...this.state, questions });
    this.pushTimeline({
      kind: "hitl",
      label: "確認をスキップしました",
      status: "done",
      groupId: `hitl-${id}`,
    });
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
