import { z } from "zod";

export const VerificationProfileSchema = z
  .object({
    name: z.string().trim().min(1).max(128),
    command: z.string().trim().min(1).max(256),
    args: z.array(z.string().trim().min(1).max(256)),
    timeoutMs: z
      .number()
      .int()
      .positive()
      .max(60 * 60 * 1000),
    allowedCwdScope: z.string().trim().min(1).max(1024),
    envAllowlist: z.array(z.string().trim().min(1).max(128)).optional(),
  })
  .strict();

export type VerificationProfile = z.infer<typeof VerificationProfileSchema>;

export class VerificationProfileRegistry {
  private readonly profiles = new Map<string, VerificationProfile>();

  constructor(initialProfiles?: VerificationProfile[]) {
    if (initialProfiles) {
      for (const profile of initialProfiles) {
        this.register(profile);
      }
    }
  }

  register(profile: VerificationProfile): void {
    const validated = VerificationProfileSchema.parse(profile);
    if (this.profiles.has(validated.name)) {
      throw new Error(`Verification profile already registered: ${validated.name}`);
    }
    this.profiles.set(validated.name, validated);
  }

  get(name: string): VerificationProfile | undefined {
    return this.profiles.get(name);
  }

  has(name: string): boolean {
    return this.profiles.has(name);
  }

  list(): VerificationProfile[] {
    return [...this.profiles.values()].sort((a, b) => a.name.localeCompare(b.name));
  }
}

export function createDefaultVerificationProfileRegistry(): VerificationProfileRegistry {
  return new VerificationProfileRegistry([
    {
      name: "typecheck",
      command: "npm",
      args: ["run", "typecheck"],
      timeoutMs: 120_000,
      allowedCwdScope: "workspace",
      envAllowlist: ["PATH", "NODE_ENV"],
    },
    {
      name: "unit-test",
      command: "npm",
      args: ["test"],
      timeoutMs: 180_000,
      allowedCwdScope: "workspace",
      envAllowlist: ["PATH", "NODE_ENV"],
    },
    {
      name: "lint",
      command: "npm",
      args: ["run", "lint"],
      timeoutMs: 60_000,
      allowedCwdScope: "workspace",
      envAllowlist: ["PATH", "NODE_ENV"],
    },
  ]);
}
