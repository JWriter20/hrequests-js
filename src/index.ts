export * from './session.js';
export * from './response.js';
export * from './request.js';
export * from './html.js';
export * from './browser.js';

export type { Response as HResponse } from './response.js';

export async function shutdown(): Promise<void> {
  // No-op for local implementation as we don't manage a global service process
}

// Default export
import { request, get, post, put, patch, del, head, optionsReq } from './request.js';
import { Session } from './session.js';
import { render } from './browser.js';

const defaultExport = {
  request,
  get,
  post,
  put,
  patch,
  delete: del,
  head,
  options: optionsReq,
  Session,
  render
};

export default defaultExport;
