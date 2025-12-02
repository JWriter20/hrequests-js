import { Session, type RequestOptions, type Method } from './session.js';
import { Response } from './response.js';
import type { BrowserSession } from './browser.js';

export async function request(method: Method, url: string, options?: RequestOptions): Promise<Response | BrowserSession> {
  // Create a temporary session for single requests
  const session = new Session();
  return session.request(method, url, options);
}

export const get = (url: string, options?: RequestOptions) => request('GET', url, options);
export const post = (url: string, options?: RequestOptions) => request('POST', url, options);
export const put = (url: string, options?: RequestOptions) => request('PUT', url, options);
export const del = (url: string, options?: RequestOptions) => request('DELETE', url, options);
export const head = (url: string, options?: RequestOptions) => request('HEAD', url, options);
export const optionsReq = (url: string, options?: RequestOptions) => request('OPTIONS', url, options);
export const patch = (url: string, options?: RequestOptions) => request('PATCH', url, options);
