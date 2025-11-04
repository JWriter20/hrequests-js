import { HRequestsServiceManager } from "./serviceManager.js";
import { ResponseHandle } from "./responseHandle.js";
import type { HResponse, RequestOptions, ResponseMetadata, SessionOptions } from "./types.js";

export * from "./types.js";
export { HRequestsServiceManager } from "./serviceManager.js";
export { ResponseHandle } from "./responseHandle.js";

const defaultManager = new HRequestsServiceManager();

export async function ensureService(): Promise<void> {
  await defaultManager.ensureService();
}

export async function createSession(options?: SessionOptions): Promise<string> {
  return await defaultManager.createSession(options);
}

export async function closeSession(sessionId: string): Promise<void> {
  await defaultManager.closeSession(sessionId);
}

export async function sendRequest(
  url: string,
  options?: RequestOptions,
  sessionId?: string | null,
): Promise<ResponseMetadata> {
  return await defaultManager.sendRequest(url, options, sessionId);
}

export async function getResponseText(responseId: string): Promise<string> {
  return await defaultManager.getResponseText(responseId);
}

export async function getResponseJson<T = unknown>(responseId: string): Promise<T> {
  return await defaultManager.getResponseJson<T>(responseId);
}

export async function streamResponseContent(responseId: string) {
  return await defaultManager.streamResponseContent(responseId);
}

export async function saveResponseContent(responseId: string, destinationPath: string): Promise<void> {
  await defaultManager.saveResponseContent(responseId, destinationPath);
}

export async function deleteResponse(responseId: string): Promise<void> {
  await defaultManager.deleteResponse(responseId);
}

export async function shutdown(): Promise<void> {
  await defaultManager.shutdown();
}

export async function request(
  method: string,
  url: string,
  options: RequestOptions = {},
  sessionId?: string | null,
): Promise<ResponseHandle> {
  return await defaultManager.request(method, url, options, sessionId);
}

export async function get(url: string, options: RequestOptions = {}, sessionId?: string | null): Promise<HResponse> {
  return await defaultManager.get(url, options, sessionId);
}

export async function post(url: string, options: RequestOptions = {}, sessionId?: string | null): Promise<HResponse> {
  return await defaultManager.post(url, options, sessionId);
}

export async function put(url: string, options: RequestOptions = {}, sessionId?: string | null): Promise<HResponse> {
  return await defaultManager.put(url, options, sessionId);
}

export async function patch(url: string, options: RequestOptions = {}, sessionId?: string | null): Promise<HResponse> {
  return await defaultManager.patch(url, options, sessionId);
}

export async function del(url: string, options: RequestOptions = {}, sessionId?: string | null): Promise<HResponse> {
  return await defaultManager.delete(url, options, sessionId);
}

export async function head(url: string, options: RequestOptions = {}, sessionId?: string | null): Promise<HResponse> {
  return await defaultManager.head(url, options, sessionId);
}

export async function options(url: string, options: RequestOptions = {}, sessionId?: string | null): Promise<HResponse> {
  return await defaultManager.options(url, options, sessionId);
}

export default defaultManager;
