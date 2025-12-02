/**
 * Session classes for hrequests-js
 * Mirrors the Python hrequests session module with full functionality
 */

import { TLSClient, type TLSClientOptions, type TLSRequestOptions } from './client.js';
import { Response, buildResponse, type ResponseOptions } from './response.js';
import { CaseInsensitiveDict, FileUtils, type FileInput } from './toolbelt.js';
import { RequestsCookieJar, mergeCookies, cookiejarFromDict, extractCookiesToJar } from './cookies.js';
import { render, BrowserSession, type BrowserSessionOptions } from './browser/index.js';
import {
  generateHeaders,
  getMajorVersion,
  OS_MAP,
  BROWSER_VERSIONS,
  getTlsVersion,
  getLatestVersion,
  type OSName,
  type BrowserName
} from './browser/fingerprint.js';
import { Proxy } from './browser/proxy.js';
import { bridge } from './cffi.js';

export type Method = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS';
export type OSType = 'win' | 'mac' | 'lin';

export interface TLSSessionOptions extends TLSClientOptions {
  /** Browser to use [firefox, chrome] */
  browser: BrowserName;
  /** Browser version */
  version?: number;
  /** OS to use in header [win, mac, lin] */
  os?: OSType;
  /** Custom headers */
  headers?: Record<string, string> | CaseInsensitiveDict;
  /** Indicates if session is temporary */
  temp?: boolean;
  /** Verify the server's TLS certificate */
  verify?: boolean;
  /** Default timeout in seconds */
  timeout?: number;
}

export interface RequestOptions {
  /** Data to send with the request */
  data?: string | Buffer | Record<string, unknown>;
  /** Files to upload */
  files?: Record<string, FileInput>;
  /** Request headers */
  headers?: Record<string, string> | CaseInsensitiveDict;
  /** Cookies to send */
  cookies?: RequestsCookieJar | Record<string, string>;
  /** JSON body */
  json?: unknown;
  /** Allow redirects */
  allowRedirects?: boolean;
  /** Remember request history */
  history?: boolean;
  /** Verify TLS certificate */
  verify?: boolean;
  /** Timeout in seconds */
  timeout?: number;
  /** Proxy URL */
  proxy?: string | Proxy;
  /** URL parameters */
  params?: Record<string, string | number | boolean>;
  /** Render in browser instead of making HTTP request */
  render?: boolean | BrowserSessionOptions;
  /** Browser for fingerprinting */
  browser?: BrowserName;
}

/**
 * TLSSession - Session object that sends requests with TLS client
 * 
 * Methods:
 *   get, post, put, patch, delete, head, options: Send HTTP requests
 *   resetHeaders(): Rotate the headers of the session
 *   render(): Render a page with playwright
 */
export class TLSSession extends TLSClient {
  readonly browser: BrowserName;
  readonly temp: boolean;
  readonly defaultVerify: boolean;
  readonly defaultTimeout: number;

  private _os: OSType;
  private _version: number;
  private _tlsVersion: number;

  constructor(options: TLSSessionOptions) {
    const { browser, version, os, headers, temp, verify, timeout, ...tlsOptions } = options;

    // Determine TLS version
    let tlsVersion: number;
    if (version) {
      tlsVersion = getTlsVersion(browser, version);
    } else {
      tlsVersion = getLatestVersion(browser);
    }

    // Initialize TLS client with browser identifier
    super({
      ...tlsOptions,
      clientIdentifier: `${browser}_${tlsVersion}`,
    });

    this.browser = browser;
    this._tlsVersion = tlsVersion;
    this._os = os || (['win', 'mac', 'lin'] as const)[Math.floor(Math.random() * 3)];
    this.temp = temp ?? false;
    this.defaultVerify = verify ?? true;
    this.defaultTimeout = timeout ?? 30;

    // Set headers
    if (headers) {
      this.headers = new CaseInsensitiveDict(headers);
      this._version = version || getMajorVersion(headers) || tlsVersion;
    } else {
      this.resetHeaders(this._os);
      this._version = this._tlsVersion;
    }
  }

  /**
   * Get the browser version
   */
  get version(): number {
    return this._version;
  }

  /**
   * Set the browser version
   */
  set version(value: number) {
    this._version = value;
  }

  /**
   * Get the TLS version
   */
  get tlsVersion(): number {
    return this._tlsVersion;
  }

  /**
   * Get the OS
   */
  get os(): OSType {
    return this._os;
  }

  /**
   * Set the OS (triggers header regeneration)
   */
  set os(value: OSType) {
    if (!['win', 'mac', 'lin'].includes(value)) {
      throw new Error(`'${value}' is not a valid OS: (win, mac, lin)`);
    }
    this._os = value;
    this.resetHeaders(value);
  }

  /**
   * Rotates the headers of the session
   */
  resetHeaders(os?: OSType): void {
    const osName = OS_MAP[os || this._os] as OSName;
    const newHeaders = generateHeaders(this.browser, {
      version: this._tlsVersion,
      os: osName,
    });
    this.headers = new CaseInsensitiveDict(newHeaders);

    // Update version from new headers
    const majorVersion = getMajorVersion(newHeaders);
    if (majorVersion) {
      this._version = majorVersion;
    }
  }

  /**
   * Shortcut to render method
   */
  async render(
    url: string,
    options: Omit<BrowserSessionOptions, 'session' | 'browser'> = {}
  ): Promise<BrowserSession> {
    const proxyValue = options.proxy || this.proxy;
    return render(url, {
      ...options,
      os: this._os,
      session: this,
      browser: this.browser,
      proxy: proxyValue as string | Proxy | undefined,
    });
  }

  /**
   * Send a request
   */
  async request(
    method: Method,
    url: string,
    options: RequestOptions = {}
  ): Promise<Response> {
    const {
      data,
      files,
      headers,
      cookies,
      json,
      allowRedirects = true,
      history = false,
      verify,
      timeout,
      proxy,
      params,
      render: renderOption,
    } = options;

    // Handle render option - use browser to render JS, then return Response with final content
    if (renderOption) {
      const renderOpts = typeof renderOption === 'boolean' ? {} : renderOption;
      const browserSession = await this.render(url, renderOpts as Omit<BrowserSessionOptions, 'session' | 'browser'>);

      // Get the rendered content and cookies from the browser
      const content = await browserSession.getContent();
      const browserCookies = await browserSession.getCookies();
      const statusCode = browserSession.statusCode || 200;
      const finalUrl = browserSession.url;

      // Close the browser session
      await browserSession.close();

      // Return a Response with the rendered content
      return new Response({
        url: finalUrl,
        statusCode,
        headers: browserSession.headers,
        cookies: browserCookies,
        raw: Buffer.from(content),
        session: this,
        browser: this.browser,
        version: this._version,
      });
    }

    // Build URL with params
    let finalUrl = url;
    if (params) {
      const searchParams = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        searchParams.append(key, String(value));
      }
      const separator = url.includes('?') ? '&' : '?';
      finalUrl = `${url}${separator}${searchParams.toString()}`;
    }

    // Handle file uploads
    let requestData = data;
    let requestHeaders = headers;
    if (files) {
      const { body, contentType } = FileUtils.encodeFiles(files, data as Record<string, unknown>);
      requestData = body;
      requestHeaders = {
        ...(headers instanceof CaseInsensitiveDict ? headers.toObject() : headers),
        'Content-Type': contentType,
      };
    }

    // Convert proxy
    let proxyUrl: string | undefined;
    if (proxy) {
      proxyUrl = proxy instanceof Proxy ? proxy.url : proxy;
    }

    // Record start time
    const startTime = Date.now();

    // Execute request
    const bridgeResponse = await this.executeRequest(method, finalUrl, {
      data: requestData,
      headers: requestHeaders,
      cookies: cookies instanceof RequestsCookieJar ? cookies : cookies ? cookiejarFromDict(cookies) : undefined,
      json,
      allowRedirects,
      history,
      verify: verify ?? this.defaultVerify,
      timeout: timeout ?? this.defaultTimeout,
      proxy: proxyUrl,
    });

    // Calculate elapsed time
    const elapsed = Date.now() - startTime;

    // Build response
    const response = new Response({
      url: bridgeResponse.url,
      statusCode: bridgeResponse.statusCode,
      headers: bridgeResponse.headers,
      cookies: bridgeResponse.cookies,
      raw: bridgeResponse.body,
      history: bridgeResponse.history.map(h => new Response({
        url: h.url,
        statusCode: h.statusCode,
        headers: h.headers,
        cookies: h.cookies,
        raw: h.body,
        isUtf8: h.isUtf8,
        proxy: h.proxy,
      })),
      session: this.temp ? null : this,
      browser: this.browser,
      version: this._version,
      elapsed,
      isUtf8: bridgeResponse.isUtf8,
      proxy: bridgeResponse.proxy,
    });

    return response;
  }

  // HTTP method shortcuts
  async get(url: string, options?: RequestOptions): Promise<Response> {
    return this.request('GET', url, options);
  }

  async post(url: string, options?: RequestOptions): Promise<Response> {
    return this.request('POST', url, options);
  }

  async put(url: string, options?: RequestOptions): Promise<Response> {
    return this.request('PUT', url, options);
  }

  async patch(url: string, options?: RequestOptions): Promise<Response> {
    return this.request('PATCH', url, options);
  }

  async delete(url: string, options?: RequestOptions): Promise<Response> {
    return this.request('DELETE', url, options);
  }

  async head(url: string, options?: RequestOptions): Promise<Response> {
    return this.request('HEAD', url, options);
  }

  async options(url: string, options?: RequestOptions): Promise<Response> {
    return this.request('OPTIONS', url, options);
  }
}

/**
 * Session - Default session with Firefox browser
 */
export class Session extends TLSSession {
  constructor(options: Partial<TLSSessionOptions> = {}) {
    const browser = options.browser || 'firefox';
    let version = options.version;

    // Validate version if specified
    if (version) {
      const supportedVersions = BROWSER_VERSIONS[browser];
      if (!supportedVersions.includes(version as any)) {
        throw new Error(
          `'${version}' is not a supported ${browser} version: ${supportedVersions.join(', ')}`
        );
      }
    }

    super({
      ...options,
      browser,
      version,
    });
  }
}

/**
 * Session shortcut class
 */
class SessionShortcut {
  static browserName: BrowserName;
  static versions: readonly number[];

  static Session(options: Omit<Partial<TLSSessionOptions>, 'browser'> = {}): Session {
    return new Session({
      ...options,
      browser: this.browserName,
    });
  }

  static tlsVersion(version: number): number {
    return getTlsVersion(this.browserName, version);
  }

  static BrowserSession(options: Omit<BrowserSessionOptions, 'browser'> = {}): Promise<BrowserSession> {
    return render(undefined, {
      ...options,
      browser: this.browserName,
    });
  }
}

/**
 * Firefox session shortcuts
 */
export class firefox extends SessionShortcut {
  static override browserName: BrowserName = 'firefox';
  static override versions = BROWSER_VERSIONS.firefox;
}

/**
 * Chrome session shortcuts
 */
export class chrome extends SessionShortcut {
  static override browserName: BrowserName = 'chrome';
  static override versions = BROWSER_VERSIONS.chrome;
}

// Re-export types
export type { TLSClientOptions, TLSRequestOptions };
