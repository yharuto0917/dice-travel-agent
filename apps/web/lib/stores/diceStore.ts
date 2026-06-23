import {
  type DestinationCandidate,
  type DiceFace,
  type DiceState,
  MAX_REROLLS,
} from "@repo/shared";
import { create } from "zustand";

export interface DiceStore extends DiceState {
  candidates: DestinationCandidate[];
  setCandidates: (candidates: DestinationCandidate[]) => void;
  rollDice: (face: DiceFace) => void;
  confirmDestination: () => void;
  resetDice: () => void;
  canReroll: () => boolean;
}

export const useDiceStore = create<DiceStore>((set, get) => ({
  rolledFace: null,
  rerollCount: 0,
  confirmed: false,
  confirmedCandidateId: null,
  candidates: [],

  setCandidates: (candidates) =>
    set({
      candidates,
      rolledFace: null,
      rerollCount: 0,
      confirmed: false,
      confirmedCandidateId: null,
    }),

  rollDice: (face) =>
    set((state) => {
      if (state.confirmed) return state;
      // 初回ロールはカウントしない、2回目以降（振り直し）をカウントする
      // ただし上限に達している場合は状態を変えない
      const isReroll = state.rolledFace !== null;
      if (isReroll && state.rerollCount >= MAX_REROLLS) return state;

      return {
        rolledFace: face,
        rerollCount: isReroll ? state.rerollCount + 1 : state.rerollCount,
      };
    }),

  confirmDestination: () =>
    set((state) => {
      if (state.rolledFace === null || state.candidates.length < state.rolledFace) return state;
      const candidate = state.candidates[state.rolledFace - 1]; // 出目 1〜6 を インデックス 0〜5 にマッピング
      return {
        confirmed: true,
        confirmedCandidateId: candidate.id,
      };
    }),

  resetDice: () =>
    set({
      rolledFace: null,
      rerollCount: 0,
      confirmed: false,
      confirmedCandidateId: null,
    }),

  canReroll: () => {
    const state = get();
    return !state.confirmed && state.rerollCount < MAX_REROLLS;
  },
}));
