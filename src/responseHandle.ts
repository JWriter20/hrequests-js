import type { Readable } from "node:stream";

import type { HRequestsServiceManager } from "./serviceManager.js";
import type { HResponse, ResponseMetadata } from "./types.js";

export class ResponseHandle implements HResponse {
  constructor(private readonly manager: HRequestsServiceManager, private readonly meta: ResponseMetadata) { }

  get responseId(): string {
    return this.meta.responseId;
  }

  get status(): number {
    return this.meta.status;
  }

  get reason(): string {
    return this.meta.reason;
  }

  get ok(): boolean {
    return this.meta.ok;
  }

  get url(): string {
    return this.meta.url;
  }

  get headers(): Record<string, string> {
    return this.meta.headers;
  }

  get cookies(): Record<string, unknown> {
    return this.meta.cookies;
  }

  get elapsedMs(): number | null {
    return this.meta.elapsedMs;
  }

  get encoding(): string | null {
    return this.meta.encoding;
  }

  get httpVersion(): string | null {
    return this.meta.httpVersion;
  }

  get history(): Array<{ status: number; url: string }> {
    return this.meta.history;
  }

  async text(): Promise<string> {
    return await this.manager.getResponseText(this.meta.responseId);
  }

  async json<T = unknown>(): Promise<T> {
    return await this.manager.getResponseJson<T>(this.meta.responseId);
  }

  async stream(): Promise<Readable> {
    return await this.manager.streamResponseContent(this.meta.responseId);
  }

  async saveToFile(destinationPath: string): Promise<void> {
    await this.manager.saveResponseContent(this.meta.responseId, destinationPath);
  }

  async delete(): Promise<void> {
    await this.manager.deleteResponse(this.meta.responseId);
  }

  metadata(): ResponseMetadata {
    return { ...this.meta };
  }
}
