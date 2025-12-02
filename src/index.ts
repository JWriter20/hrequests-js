/**
 * hrequests-js - TypeScript port of hrequests
 * Mirrors hrequests/__init__.py
 * 
 * A full-featured HTTP client with TLS fingerprinting and browser automation
 */

// Core exports (mirrors __init__.py imports)
export { Session, TLSSession, firefox, chrome } from './session.js';
export type { Method, RequestOptions, TLSSessionOptions, OSType } from './session.js';

export { Response, FailedResponse, buildResponse } from './response.js';
export type { ResponseOptions } from './response.js';

// Parser (html.py -> parser.py)
export { HTML, Element } from './parser.js';

// Browser module
export { BrowserSession, render } from './browser/index.js';
export type { BrowserSessionOptions, BrowserType } from './browser/index.js';

export { Proxy } from './browser/proxy.js';

// TLS Client (client.py)
export { TLSClient, verifyProxy } from './client.js';
export type {
  TLSClientOptions,
  TLSRequestOptions as TLSClientRequestOptions,
  H2Settings,
  PriorityFrame,
  HeaderPriority,
  BridgeResponse
} from './client.js';

// Request utilities (reqs.py)
export {
  TLSRequest,
  LazyTLSRequest,
  asyncRequest,
  asyncGet,
  asyncPost,
  asyncPut,
  asyncPatch,
  asyncDelete,
  asyncHead,
  asyncOptions,
  request,
  get,
  post,
  put,
  patch,
  del,
  head,
  optionsReq,
  map,
  imap,
  imapEnum,
} from './reqs.js';
export type { TLSRequestOptions } from './reqs.js';

// Utility exports (toolbelt.py)
export { CaseInsensitiveDict, FileUtils } from './toolbelt.js';
export type { FileData, FileInput } from './toolbelt.js';

// Cookies (cookies.py)
export {
  RequestsCookieJar,
  CookieConflictError,
  createCookie,
  cookiejarFromDict,
  mergeCookies,
  listToCookiejar,
  cookiejarToList,
  extractCookiesToJar,
} from './cookies.js';
export type { CookieDict, BrowserCookie } from './cookies.js';

// Fingerprint exports (browser/fingerprint.ts)
export {
  BrowserFingerprint,
  fingerprint,
  generateHeaders,
  getMajorVersion,
  getTlsVersion,
  getLatestVersion,
  OS_MAP,
  BROWSER_VERSIONS,
} from './browser/fingerprint.js';
export type {
  FingerprintOptions,
  GeneratedFingerprint,
  BrowserName,
  OSName,
  DeviceType,
} from './browser/fingerprint.js';

// Exception exports (exceptions.py)
export {
  ClientException,
  BrowserException,
  EnableMockHumanException,
  BrowserTimeoutException,
  NotRenderedException,
  JavascriptException,
  CacheDisabledError,
  SelectorNotFoundException,
  EncodingNotFoundException,
  ProxyFormatException,
  MissingLibraryException,
} from './exceptions.js';

// CFFI/Bridge exports (cffi.py)
export { bridge, BridgeManager } from './cffi.js';

/**
 * Shutdown the bridge server
 */
export async function shutdown(): Promise<void> {
  const { bridge } = await import('./cffi.js');
  bridge.stop();
}

// Default export for convenience
import { request, get, post, put, patch, del, head, optionsReq } from './reqs.js';
import { Session, firefox, chrome } from './session.js';
import { render } from './browser/index.js';
import { map, imap } from './reqs.js';

const hrequests = {
  // Request methods
  request,
  get,
  post,
  put,
  patch,
  delete: del,
  head,
  options: optionsReq,

  // Session classes
  Session,
  firefox,
  chrome,

  // Browser
  render,

  // Async utilities
  map,
  imap,

  // Shutdown
  shutdown,
};

export default hrequests;
