import { GiteaClient, type GiteaClientConfig } from "./gitea-client.js";

export interface GiteaClientPoolConfig extends GiteaClientConfig {
  identityId?: string;
  allowEnvTokenFallback?: boolean;
}

export class GiteaClientPool {
  private clients = new Map<string, GiteaClient>();

  getClient(config: GiteaClientPoolConfig): GiteaClient {
    if (config.identityId && !config.giteaToken) {
      throw new Error(
        `Selected Gitea identity (${config.identityId}) has no valid token for this run`,
      );
    }
    const allowEnvFallback = config.allowEnvTokenFallback !== false && !config.identityId;
    const token = config.giteaToken || (allowEnvFallback ? process.env.GITEA_TOKEN || "" : "");
    const effectiveConfig = { ...config, giteaToken: token };
    const key = `${config.giteaUrl}::${config.repoOwner}::${config.repoName}::${token}`;
    let client = this.clients.get(key);
    if (!client) {
      client = new GiteaClient(effectiveConfig);
      this.clients.set(key, client);
    }
    return client;
  }

  hasClient(config: GiteaClientConfig): boolean {
    const key = `${config.giteaUrl}::${config.repoOwner}::${config.repoName}::${config.giteaToken}`;
    return this.clients.has(key);
  }

  clear(): void {
    this.clients.clear();
  }
}
