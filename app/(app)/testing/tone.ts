import type { CalState } from "@/lib/validation/testing";

export const stateTone: Record<CalState, "ok" | "warn" | "danger" | "neutral"> = {
  CURRENT: "ok",
  DUE_SOON: "warn",
  OVERDUE: "danger",
  FAILED: "danger",
  NOT_CALIBRATED: "neutral",
};
