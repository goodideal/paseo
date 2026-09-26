import type { PluginHookContext } from "@getpaseo/plugin/server";

export class Executor {
  public async autoContinue(agentId: string, context: PluginHookContext) {
    try {
      await context.paseo.agents.ref(agentId).send("请继续执行下一步任务，直到交付并验证完成。");
    } catch (e) {
      console.error("Failed to send auto-continue prompt", e);
    }
  }

  public async allowPermission(agentId: string, requestId: string, context: PluginHookContext) {
    try {
      await context.paseo.agents.ref(agentId).respondToPermission({
        requestId,
        response: { behavior: "allow" },
      });
    } catch (e) {
      console.error("Failed to allow permission", e);
    }
  }
}
