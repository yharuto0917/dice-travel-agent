import { z } from "zod";
import { GeoPointSchema, ImageRefSchema } from "./common";

/** 地方区分（8地方） */
export const RegionSchema = z.enum([
  "hokkaido",
  "tohoku",
  "kanto",
  "chubu",
  "kinki",
  "chugoku",
  "shikoku",
  "kyushu-okinawa",
]);
export type Region = z.infer<typeof RegionSchema>;

/** 行き先候補（地図表示・サイコロの目に対応） */
export const DestinationCandidateSchema = z.object({
  id: z.string(),
  /** JIS都道府県コード "01"〜"47"（48以降は無効） */
  prefectureCode: z.string().regex(/^(0[1-9]|[1-3][0-9]|4[0-7])$/),
  prefecture: z.string(),
  /** より細かいエリア名（任意） */
  area: z.string().optional(),
  region: RegionSchema.optional(),
  location: GeoPointSchema,
  tags: z.array(z.string()).default([]),
  thumbnail: ImageRefSchema.optional(),
  description: z.string().optional(),
});
export type DestinationCandidate = z.infer<typeof DestinationCandidateSchema>;

/** サイコロの6面に対応する候補リスト（必ず6件） */
export const DestinationCandidatesSchema = z.array(DestinationCandidateSchema).length(6);
export type DestinationCandidates = z.infer<typeof DestinationCandidatesSchema>;
