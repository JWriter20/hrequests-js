/**
 * TLS Client for hrequests-js
 * Provides TLS fingerprinting via the Go bridge
 * Mirrors the Python hrequests TLSClient
 */

import { fetch } from 'undici';
import { v4 as uuidv4 } from 'uuid';
import { bridge } from './cffi.js';
import { CaseInsensitiveDict } from './toolbelt.js';
import { RequestsCookieJar, cookiejarToList, listToCookiejar, extractCookiesToJar } from './cookies.js';
import { ClientException, ProxyFormatException } from './exceptions.js';
import type { Response } from './response.js';

// Proxy validation regex
const SUPPORTED_PROXIES = ['http', 'https', 'socks5'];
const PROXY_PATTERN = new RegExp(
  `^(?:${SUPPORTED_PROXIES.join('|')})://(?:[^:]+:[^@]+@)?.*?(?::\\d+)?$`
);

/**
 * Verify that a proxy URL is valid
 */
export function verifyProxy(proxy: string): void {
  if (!PROXY_PATTERN.test(proxy)) {
    throw new ProxyFormatException(`Invalid proxy: ${proxy}`);
  }
}

/**
 * HTTP/2 Settings configuration
 */
export interface H2Settings {
  HEADER_TABLE_SIZE?: number;
  SETTINGS_ENABLE_PUSH?: number;
  MAX_CONCURRENT_STREAMS?: number;
  INITIAL_WINDOW_SIZE?: number;
  MAX_FRAME_SIZE?: number;
  MAX_HEADER_LIST_SIZE?: number;
}

/**
 * Priority frame configuration
 */
export interface PriorityFrame {
  streamID: number;
  priorityParam: {
    weight: number;
    streamDep: number;
    exclusive: boolean;
  };
}

/**
 * Header priority configuration
 */
export interface HeaderPriority {
  streamDep: number;
  exclusive: boolean;
  weight: number;
}

/**
 * TLS Client configuration options
 */
export interface TLSClientOptions {
  /** Browser client identifier (e.g., 'chrome_120', 'firefox_117') */
  clientIdentifier?: string;

  /** Randomize TLS extension order */
  randomTlsExtensionOrder?: boolean;

  /** Force HTTP/1.1 */
  forceHttp1?: boolean;

  /** Catch panics in Go code */
  catchPanics?: boolean;

  /** Enable debug mode */
  debug?: boolean;

  /** Proxy URL */
  proxy?: string;

  /** Initial cookies */
  cookies?: RequestsCookieJar;

  /** Certificate pinning configuration */
  certificatePinning?: Record<string, string[]>;

  /** Disable IPv6 */
  disableIpv6?: boolean;

  /** Detect response encoding */
  detectEncoding?: boolean;

  // Custom TLS profile options

  /** JA3 fingerprint string */
  ja3String?: string;

  /** HTTP/2 settings */
  h2Settings?: H2Settings;

  /** HTTP/2 settings order */
  h2SettingsOrder?: string[];

  /** Supported signature algorithms */
  supportedSignatureAlgorithms?: string[];

  /** Supported delegated credentials algorithms */
  supportedDelegatedCredentialsAlgorithms?: string[];

  /** Supported TLS versions */
  supportedVersions?: string[];

  /** Key share curves */
  keyShareCurves?: string[];

  /** Certificate compression algorithm */
  certCompressionAlgo?: string;

  /** Additional decode (gzip, br, deflate) */
  additionalDecode?: string;

  /** Pseudo header order */
  pseudoHeaderOrder?: string[];

  /** Connection flow / window size increment */
  connectionFlow?: number;

  /** Priority frames */
  priorityFrames?: PriorityFrame[];

  /** Header order */
  headerOrder?: string[];

  /** Header priority */
  headerPriority?: HeaderPriority;
}

/**
 * Request options for TLSClient
 */
export interface TLSRequestOptions {
  data?: string | Buffer | Record<string, unknown>;
  files?: Record<string, unknown>;
  headers?: Record<string, string> | CaseInsensitiveDict;
  cookies?: RequestsCookieJar | Record<string, string> | Array<{ name: string; value: string }>;
  json?: unknown;
  allowRedirects?: boolean;
  history?: boolean;
  verify?: boolean;
  timeout?: number;
  proxy?: string;
}

/**
 * TLS Client class
 * Provides TLS fingerprinting capabilities via the Go bridge
 */
export class TLSClient {
  readonly id: string;
  readonly clientIdentifier?: string;
  readonly randomTlsExtensionOrder: boolean;
  readonly forceHttp1: boolean;
  readonly catchPanics: boolean;
  readonly debug: boolean;
  proxy?: string;
  cookies: RequestsCookieJar;
  readonly certificatePinning?: Record<string, string[]>;
  readonly disableIpv6: boolean;
  readonly detectEncoding: boolean;

  // Custom TLS profile
  readonly ja3String?: string;
  readonly h2Settings?: H2Settings;
  readonly h2SettingsOrder?: string[];
  readonly supportedSignatureAlgorithms?: string[];
  readonly supportedDelegatedCredentialsAlgorithms?: string[];
  readonly supportedVersions?: string[];
  readonly keyShareCurves?: string[];
  readonly certCompressionAlgo?: string;
  readonly additionalDecode?: string;
  readonly pseudoHeaderOrder?: string[];
  readonly connectionFlow?: number;
  readonly priorityFrames?: PriorityFrame[];
  readonly headerOrder?: string[];
  readonly headerPriority?: HeaderPriority;

  private _closed: boolean = false;
  private _headers: CaseInsensitiveDict;

  constructor(options: TLSClientOptions = {}) {
    this.id = uuidv4();
    this.clientIdentifier = options.clientIdentifier;
    this.randomTlsExtensionOrder = options.randomTlsExtensionOrder ?? true;
    this.forceHttp1 = options.forceHttp1 ?? false;
    this.catchPanics = options.catchPanics ?? false;
    this.debug = options.debug ?? false;
    this.proxy = options.proxy;
    this.cookies = options.cookies || new RequestsCookieJar();
    this.certificatePinning = options.certificatePinning;
    this.disableIpv6 = options.disableIpv6 ?? false;
    this.detectEncoding = options.detectEncoding ?? true;

    // Custom TLS profile
    this.ja3String = options.ja3String;
    this.h2Settings = options.h2Settings;
    this.h2SettingsOrder = options.h2SettingsOrder;
    this.supportedSignatureAlgorithms = options.supportedSignatureAlgorithms;
    this.supportedDelegatedCredentialsAlgorithms = options.supportedDelegatedCredentialsAlgorithms;
    this.supportedVersions = options.supportedVersions;
    this.keyShareCurves = options.keyShareCurves;
    this.certCompressionAlgo = options.certCompressionAlgo;
    this.additionalDecode = options.additionalDecode;
    this.pseudoHeaderOrder = options.pseudoHeaderOrder;
    this.connectionFlow = options.connectionFlow;
    this.priorityFrames = options.priorityFrames;
    this.headerOrder = options.headerOrder;
    this.headerPriority = options.headerPriority;

    this._headers = new CaseInsensitiveDict();
  }

  get headers(): CaseInsensitiveDict {
    return this._headers;
  }

  set headers(value: Record<string, string> | CaseInsensitiveDict) {
    if (value instanceof CaseInsensitiveDict) {
      this._headers = value;
    } else {
      this._headers = new CaseInsensitiveDict(value);
    }
  }

  /**
   * Close the TLS client and cleanup resources
   */
  close(): void {
    if (!this._closed) {
      this._closed = true;
      bridge.destroySession(this.id);
    }
  }

  /**
   * Build a request payload for the bridge
   */
  buildRequest(
    method: string,
    url: string,
    options: TLSRequestOptions = {}
  ): { payload: Record<string, unknown>; headers: CaseInsensitiveDict } {
    const {
      data,
      headers,
      cookies,
      json,
      allowRedirects = false,
      history = true,
      verify = true,
      timeout = 30,
      proxy,
    } = options;

    // Prepare request body
    let requestBody: string | undefined;
    let contentType: string | undefined;

    if (data === undefined && json !== undefined) {
      requestBody = typeof json === 'string' ? json : JSON.stringify(json);
      contentType = 'application/json';
    } else if (data !== undefined) {
      if (typeof data === 'string' || Buffer.isBuffer(data)) {
        requestBody = data.toString();
      } else {
        requestBody = new URLSearchParams(data as Record<string, string>).toString();
        contentType = 'application/x-www-form-urlencoded';
      }
    }

    // Prepare headers
    let mergedHeaders: CaseInsensitiveDict;
    if (!this._headers.size) {
      mergedHeaders = new CaseInsensitiveDict(headers || {});
    } else if (!headers) {
      mergedHeaders = this._headers;
    } else {
      mergedHeaders = new CaseInsensitiveDict(this._headers);
      if (headers instanceof CaseInsensitiveDict) {
        mergedHeaders.update(headers);
      } else {
        mergedHeaders.update(headers);
      }

      // Remove null/undefined entries
      for (const [key, value] of mergedHeaders.entries()) {
        if (value === null || value === undefined) {
          mergedHeaders.delete(key);
        }
      }
    }

    // Set content type if needed
    if (contentType && !mergedHeaders.has('Content-Type')) {
      mergedHeaders.set('Content-Type', contentType);
    }

    // Handle cookies
    if (cookies) {
      if (cookies instanceof RequestsCookieJar) {
        this.cookies.update(cookies);
      } else if (Array.isArray(cookies)) {
        for (const cookie of cookies) {
          this.cookies.set(cookie.name, cookie.value);
        }
      } else {
        for (const [name, value] of Object.entries(cookies)) {
          this.cookies.set(name, value);
        }
      }
    }

    // Handle proxy
    let proxyUrl = proxy || this.proxy;
    if (proxyUrl) {
      verifyProxy(proxyUrl);
    }

    // Build request payload
    const isByteRequest = Buffer.isBuffer(data);
    const payload: Record<string, unknown> = {
      sessionId: this.id,
      followRedirects: allowRedirects,
      wantHistory: history,
      forceHttp1: this.forceHttp1,
      withDebug: this.debug,
      catchPanics: this.catchPanics,
      headers: mergedHeaders.toObject(),
      headerOrder: this.headerOrder,
      insecureSkipVerify: !verify,
      isByteRequest,
      detectEncoding: this.detectEncoding,
      additionalDecode: this.additionalDecode,
      proxyUrl,
      requestUrl: url,
      requestMethod: method,
      requestBody: isByteRequest && data ? Buffer.from(data).toString('base64') : requestBody,
      requestCookies: cookiejarToList(this.cookies),
      timeoutMilliseconds: Math.floor(timeout * 1000),
      withoutCookieJar: false,
      disableIPv6: this.disableIpv6,
    };

    if (this.certificatePinning) {
      payload.certificatePinning = this.certificatePinning;
    }

    if (this.clientIdentifier === undefined) {
      // Use custom TLS profile
      payload.customTlsClient = {
        ja3String: this.ja3String,
        h2Settings: this.h2Settings,
        h2SettingsOrder: this.h2SettingsOrder,
        pseudoHeaderOrder: this.pseudoHeaderOrder,
        connectionFlow: this.connectionFlow,
        priorityFrames: this.priorityFrames,
        headerPriority: this.headerPriority,
        certCompressionAlgo: this.certCompressionAlgo,
        supportedVersions: this.supportedVersions,
        supportedSignatureAlgorithms: this.supportedSignatureAlgorithms,
        supportedDelegatedCredentialsAlgorithms: this.supportedDelegatedCredentialsAlgorithms,
        keyShareCurves: this.keyShareCurves,
      };
    } else {
      payload.tlsClientIdentifier = this.clientIdentifier;
      payload.withRandomTLSExtensionOrder = this.randomTlsExtensionOrder;
    }

    return { payload, headers: mergedHeaders };
  }

  /**
   * Execute a request via the bridge
   */
  async executeRequest(
    method: string,
    url: string,
    options: TLSRequestOptions = {}
  ): Promise<BridgeResponse> {
    // Ensure bridge is loaded
    if (bridge.getPort() === 0) {
      await bridge.load();
    }

    const { payload, headers } = this.buildRequest(method, url, options);

    try {
      const resp = await fetch(`http://127.0.0.1:${bridge.getPort()}/request`, {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: { 'Content-Type': 'application/json' },
      });

      if (!resp.ok) {
        throw new ClientException(`Bridge request failed: ${resp.statusText}`);
      }

      const responseObject = await resp.json() as any;
      return this.buildResponse(url, headers, responseObject, payload.proxyUrl as string | undefined);
    } catch (e) {
      if (e instanceof ClientException) throw e;
      throw new ClientException(`Request failed: ${e}`);
    }
  }

  /**
   * Build a response object from the bridge response
   */
  private buildResponse(
    url: string,
    headers: CaseInsensitiveDict,
    responseObject: any,
    proxy?: string
  ): BridgeResponse {
    if (!responseObject.isHistory) {
      return this.buildResponseObj(url, headers, responseObject.response || responseObject, proxy);
    }

    const history: BridgeResponse[] = [];
    const resps = responseObject.history || [];

    for (let i = 0; i < resps.length; i++) {
      let itemUrl: string;
      if (i > 0) {
        // Get the location redirect URL from the previous response
        itemUrl = resps[i - 1].headers?.Location?.[0] || url;
      } else {
        itemUrl = url;
      }
      history.push(this.buildResponseObj(itemUrl, headers, resps[i], proxy));
    }

    // Assign history to last response
    const resp = history[history.length - 1];
    resp.history = history.slice(0, -1);
    return resp;
  }

  /**
   * Build a single response object
   */
  private buildResponseObj(
    url: string,
    headers: CaseInsensitiveDict,
    res: any,
    proxy?: string
  ): BridgeResponse {
    if (res.status === 0) {
      throw new ClientException(res.body || 'Request failed');
    }

    // Extract cookies from response
    const responseCookieJar = extractCookiesToJar(
      url,
      headers,
      this.cookies,
      res.headers || {}
    );

    // Build response headers
    const resHeaders: Record<string, string> = {};
    if (res.headers) {
      for (const [key, value] of Object.entries(res.headers)) {
        if (Array.isArray(value)) {
          resHeaders[key] = value.length === 1 ? value[0] : value.join(', ');
        } else {
          resHeaders[key] = String(value);
        }
      }
    }

    // Decode base64 body if needed
    let body: Buffer;
    if (res.isBase64) {
      body = Buffer.from(res.body, 'base64');
    } else {
      body = Buffer.from(res.body || '');
    }

    return {
      url: res.target || url,
      statusCode: res.status,
      headers: new CaseInsensitiveDict(resHeaders),
      cookies: responseCookieJar,
      body,
      isUtf8: !res.isBase64,
      proxy,
      history: [],
    };
  }
}

export interface BridgeResponse {
  url: string;
  statusCode: number;
  headers: CaseInsensitiveDict;
  cookies: RequestsCookieJar;
  body: Buffer;
  isUtf8: boolean;
  proxy?: string;
  history: BridgeResponse[];
}

