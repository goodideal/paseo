export type MatrixTier = "plan" | "review" | "flash";

export type DomainRole =
  | "ui"
  | "backend"
  | "pm"
  | "architect"
  | "qa"
  | "review"
  | "scout"
  | "general";

export type ProviderModelMapping = Record<MatrixTier, string>;

export interface RouterDecision {
  tier: MatrixTier;
  targetModel: string;
  reason: string;
  matchedRule: string;
  previousModel?: string;
}

export interface DomainRoleDecision {
  role: DomainRole;
  matchedRule: string;
  profilePath: string;
  lazyToolConfigPath: string;
}
