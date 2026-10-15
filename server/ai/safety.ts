// Rule-based safety checks around AI assistance (Stage 9). These do not rely
// on the AI behaving well: they run on the server, on the way in and out.
//
//   • hazardFlags: words in the fault, observations, sources or answer that
//     mean serious risk always add a fixed "follow approved procedures"
//     notice — whatever the AI says.
//   • filterAnswerText: removes wording that would claim a safety decision
//     (safe to use, return to service, clear a lockout, override a failed
//     test, approve a repair) and invented likelihood percentages.
//   • redact: strips e-mail addresses and long number sequences (phone or
//     record numbers) before anything is sent to an external provider.
import "server-only";

export const HAZARDS = {
  electrical: {
    label: "Electrical hazard",
    pattern:
      /\b(mains|leakage current|earth (?:bond|leakage)|insulation|shock|high[- ]voltage|capacitor|electrocut\w*|live part|exposed conductor)\b/i,
  },
  radiation: {
    label: "Radiation or laser hazard",
    pattern: /\b(x-?ray|radiation|ionising|ionizing|laser|radioactive|uv-c)\b/i,
  },
  pressure: {
    label: "Pressure or gas hazard",
    pattern: /\b(pressur\w*|compressed|cylinder|oxygen|medical gas|nitrous|vacuum line|pneumatic|gas leak)\b/i,
  },
  infection: {
    label: "Infection-control hazard",
    pattern: /\b(blood|body fluid|biohazard|contaminat\w*|infecti\w*|decontaminat\w*|sharps)\b/i,
  },
  heat: {
    label: "Heat, smoke or fire hazard",
    pattern: /\b(smoke|burn\w*|fire|overheat\w*|scorch\w*|melt\w*|sparks?)\b/i,
  },
  energy: {
    label: "Stored energy / high-energy output",
    pattern: /\b(defibrillat\w*|energy delivery|discharge|electrosurg\w*|diathermy)\b/i,
  },
} as const;
export type HazardKey = keyof typeof HAZARDS;

export const HAZARD_NOTICE =
  "This fault may involve a serious hazard. Follow your organisation's approved procedures and the manufacturer's service instructions, use the required protective equipment, and involve a qualified specialist where required. BiomedIntel.ai does not give hazardous repair instructions.";

export function hazardFlags(...texts: (string | null | undefined)[]): HazardKey[] {
  const all = texts.filter(Boolean).join("\n");
  return (Object.keys(HAZARDS) as HazardKey[]).filter((k) => HAZARDS[k].pattern.test(all));
}

/** Wording that would claim a safety or approval decision. */
const DECISION_PATTERNS: RegExp[] = [
  /\b(?:is|are|now|device|unit|equipment)?\s*safe (?:for (?:patient|clinical) use|to (?:use|return|operate|put back))\b/i,
  /\b(?:return(?:ed|ing)?|release(?:d)?|put(?:ting)? back|restor(?:e|ed|ing)) (?:it |the device |the unit |the equipment )?(?:to|into) (?:clinical )?(?:service|use)\b/i,
  /\b(?:clear(?:ed|ing)?|remov(?:e|ed|ing)|lift(?:ed|ing)?|bypass(?:ed|ing)?|override|overrid(?:e|ing|den)) (?:the )?(?:safety )?(?:hold|lock-?out|tag-?out|lock|interlock)\b/i,
  /\b(?:override|overrid(?:e|ing|den)|ignor(?:e|ing)|disregard(?:ing)?) (?:the )?(?:failed )?(?:electrical )?safety test\b/i,
  /\b(?:approv(?:e|ed|ing)|sign(?:ed)? off|certif(?:y|ied|ies)) (?:the |this )?(?:repair|work|device|equipment|maintenance|return)\b/i,
  /\b(?:mark|set|change)(?:ed|ing)? (?:the )?(?:device |asset |equipment )?status\b/i,
  /\bpassed (?:the )?(?:electrical )?safety (?:test|check)\b/i,
];
const CONFIDENCE_PATTERNS: RegExp[] = [
  /\b\d{1,3}(?:\.\d+)?\s?%\s*(?:likely|likelihood|probab\w*|chance|confiden\w*|certain\w*|sure)\b/i,
  /\b(?:likelihood|probability|confidence|certainty|chance)\s*(?:of|is|:|=|score)?\s*(?:about|around|approx\w*)?\s*\d{1,3}(?:\.\d+)?\s?%/i,
  /\b(?:confidence|probability|likelihood)\s*(?:score|level)?\s*[:=]?\s*(?:high|medium|low|0?\.\d+)\b/i,
];
export const REMOVED_DECISION =
  "[Removed: BiomedIntel.ai does not make safety, approval or return-to-service decisions.]";
export const REMOVED_CONFIDENCE = "[Removed: an unsupported likelihood or confidence figure.]";

export function filterAnswerText(s: string, flags: Set<string>): string {
  let out = s;
  for (const p of DECISION_PATTERNS) {
    if (p.test(out)) {
      flags.add("decision_wording_removed");
      return REMOVED_DECISION; // the whole item: partial removal could change its meaning
    }
  }
  for (const p of CONFIDENCE_PATTERNS) {
    if (p.test(out)) {
      flags.add("confidence_removed");
      out = out.replace(new RegExp(p.source, "gi"), REMOVED_CONFIDENCE);
    }
  }
  return out;
}

/** Removes e-mail addresses and long digit sequences before text leaves the application. */
export function redact(s: string): string {
  return s
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email removed]")
    .replace(/(?:\+?\d[\d\s().-]{7,}\d)/g, (m) => (m.replace(/\D/g, "").length >= 8 ? "[number removed]" : m));
}
