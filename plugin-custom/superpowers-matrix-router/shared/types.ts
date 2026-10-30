export type MatrixTier = "plan" | "review" | "flash";

export interface ProviderModelMapping {
  plan: string;
  review: string;
  flash: string;
  thinkingOptionId?: string;
}

export interface RouterDecision {
  tier: MatrixTier;
  targetModel: string;
  reason: string;
  matchedRule: string;
  previousModel?: string;
  thinkingOptionId?: string;
}
