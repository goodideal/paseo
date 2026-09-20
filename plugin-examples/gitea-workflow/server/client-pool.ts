import { GiteaClient, type GiteaClientConfig } from "./gitea-client.js";

export class GiteaClientPool {
  private clients = new Map<string, GiteaClient>();

  getClient(config: GiteaClientConfig): GiteaClient {
    const key = `${config.giteaUrl}::${config.repoOwner}::${config.repoName}::${config.giteaToken}`;
    let client = this.clients.get(key);
    if (!client) {
      client = new GiteaClient(config);
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
