import { z } from "zod";

/** サイコロの出目（1〜6） */
export const DiceFaceSchema = z.number().int().min(1).max(6);
export type DiceFace = z.infer<typeof DiceFaceSchema>;

/** 振り直しの上限回数 */
export const MAX_REROLLS = 3;

/** サイコロ進行状態 */
export const DiceStateSchema = z.object({
  /** 直近の出目（未ロールは null） */
  rolledFace: DiceFaceSchema.nullable().default(null),
  /** これまでの振り直し回数（0〜MAX_REROLLS） */
  rerollCount: z.number().int().min(0).max(MAX_REROLLS).default(0),
  /** 行き先確定済みか */
  confirmed: z.boolean().default(false),
  /** 確定した候補ID */
  confirmedCandidateId: z.string().nullable().default(null),
});
export type DiceState = z.infer<typeof DiceStateSchema>;
