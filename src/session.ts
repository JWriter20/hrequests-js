import { fetch, type RequestInit, type Response as UndiciResponse } from 'undici';
import { CookieJar } from 'tough-cookie';
import fetchCookie from 'fetch-cookie';
import { HeaderGenerator } from 'header-generator';
import { Response } from './response.js';
import { render, type BrowserSession, type BrowserSessionOptions } from './browser.js';
import { bridge } from './bridge.js';

export type Method = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS';

export interface SessionOptions {
  browser?: string;
  headers?: Record<string, string>;
  cookies?: Record<string, string> | CookieJar;
  proxy?: string;
  timeout?: number;
  verify?: boolean;
}

export interface RequestOptions extends Omit<RequestInit, 'method'> {
  params?: Record<string, string | number | boolean>;
  json?: unknown;
  cookies?: Record<string, string>;
  timeout?: number;
  verify?: boolean;
  allowRedirects?: boolean;
  render?: boolean | BrowserSessionOptions;
  headers?: Record<string, string>;
  browser?: string;
}

export class Session {
  readonly headers: Record<string, string>;
  readonly cookies: CookieJar;
  private readonly _fetch: ReturnType<typeof fetchCookie>;
  private sessionId: string;
  private useBridge: boolean = false;
  private headerGenerator: HeaderGenerator | null = null;
  private browserName: string | undefined;

  constructor(options: SessionOptions = {}) {
    this.headers = options.headers || {};
    this.cookies = options.cookies instanceof CookieJar
      ? options.cookies
      : new CookieJar();

    if (options.cookies && !(options.cookies instanceof CookieJar)) {
      // TODO: Implement cookie object to jar population
    }

    this._fetch = fetchCookie(fetch as any, this.cookies);

    this.sessionId = Math.random().toString(36).substring(2, 15);

    if (options.browser) {
      this.useBridge = true;
      this.browserName = options.browser;
      try {
        this.headerGenerator = new HeaderGenerator({
          browsers: [options.browser === 'chrome' ? 'chrome' : 'firefox'],
          devices: ['desktop'],
          locales: ['en-US']
        });

        // Generate initial headers if not provided
        const generated = this.headerGenerator.getHeaders();

        // Merge generated headers, keeping user provided ones if conflict
        // But we specifically want User-Agent if missing.
        if (!this.headers['User-Agent'] && !this.headers['user-agent']) {
          Object.assign(this.headers, generated);
        }
      } catch (e) {
        console.error("Failed to initialize HeaderGenerator:", e);
      }
    }
  }

  async request(method: Method, url: string, options: RequestOptions = {}): Promise<Response | BrowserSession> {
    const {
      params,
      json,
      headers = {},
      cookies = {},
      timeout,
      allowRedirects = true,
      render: renderOption,
      browser,
      ...fetchOptions
    } = options;

    if (renderOption) {
      const renderOpts = typeof renderOption === 'boolean' ? {} : renderOption;
      if (browser) renderOpts.browser = browser as 'chrome' | 'firefox';
      else if (this.browserName) renderOpts.browser = this.browserName as 'chrome' | 'firefox';

      return render(url, renderOpts);
    }

    // Merge headers: Session headers < Request headers
    const requestHeaders: Record<string, string> = { ...this.headers, ...headers };

    // Per-request rotation or generation if needed
    if (browser && !requestHeaders['User-Agent'] && !requestHeaders['user-agent']) {
      try {
        const tempGen = new HeaderGenerator({
          browsers: [browser === 'chrome' ? 'chrome' : 'firefox'],
          devices: ['desktop'],
          locales: ['en-US']
        });
        const gen = tempGen.getHeaders();
        Object.assign(requestHeaders, gen);
      } catch (e) { console.error(e); }
    }

    let finalUrl = url;
    if (params) {
      const u = new URL(url);
      Object.entries(params).forEach(([k, v]) => u.searchParams.append(k, String(v)));
      finalUrl = u.toString();
    }

    const shouldUseBridge = this.useBridge || !!browser;
    const targetBrowser = browser || this.browserName || 'chrome';

    if (shouldUseBridge) {
      if (bridge.getPort() === 0) {
        await bridge.load();
      }

      const port = bridge.getPort();

      let requestBody = undefined;
      let isByteRequest = false;

      if (json) {
        requestBody = JSON.stringify(json);
        requestHeaders['Content-Type'] = 'application/json';
      } else if (fetchOptions.body) {
        requestBody = String(fetchOptions.body);
        // TODO: Handle Buffer/Bytes if needed
      }

      const payload = {
        sessionId: this.sessionId,
        requestUrl: finalUrl,
        requestMethod: method,
        requestBody: requestBody,
        headers: requestHeaders,
        timeoutMilliseconds: (timeout || 30) * 1000,
        tlsClientIdentifier: targetBrowser === 'firefox' ? 'firefox_120' : 'chrome_120',
        followRedirects: allowRedirects,
        insecureSkipVerify: false,
        wantHistory: true,
        isByteRequest: isByteRequest,
        randomTlsExtensionOrder: true
      };

      // console.log("Bridge Payload:", JSON.stringify(payload, null, 2));

      const bridgeUrl = `http://127.0.0.1:${port}/request`;

      const resp = await fetch(bridgeUrl, {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: { 'Content-Type': 'application/json' }
      });

      if (!resp.ok) {
        throw new Error(`Bridge request failed: ${resp.statusText}`);
      }

      const data = await resp.json() as any;
      const wrapped = data;
      const actualRes = wrapped.response || (wrapped.history ? wrapped.history[wrapped.history.length - 1] : null);

      if (!actualRes) throw new Error("Invalid response from bridge");

      const resHeaders: Record<string, string> = {};
      if (actualRes.headers) {
        Object.entries(actualRes.headers).forEach(([k, v]) => {
          if (Array.isArray(v)) resHeaders[k] = v.join(', ');
          else resHeaders[k] = String(v);
        });
      }

      return new Response(
        Buffer.from(actualRes.body),
        actualRes.target || finalUrl,
        actualRes.status,
        resHeaders,
        this.cookies
      );

    } else {
      if (json) {
        requestHeaders['Content-Type'] = 'application/json';
        fetchOptions.body = JSON.stringify(json);
      }

      const response = await this._fetch(finalUrl, {
        method,
        headers: requestHeaders,
        redirect: allowRedirects ? 'follow' : 'manual',
        ...fetchOptions
      } as any) as unknown as UndiciResponse;

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((v, k) => {
        responseHeaders[k] = v;
      });

      return new Response(
        buffer,
        response.url,
        response.status,
        responseHeaders,
        this.cookies
      );
    }
  }

  async get(url: string, options?: RequestOptions): Promise<Response | BrowserSession> {
    return this.request('GET', url, options);
  }

  async post(url: string, options?: RequestOptions): Promise<Response | BrowserSession> {
    return this.request('POST', url, options);
  }

  async put(url: string, options?: RequestOptions): Promise<Response | BrowserSession> {
    return this.request('PUT', url, options);
  }

  async patch(url: string, options?: RequestOptions): Promise<Response | BrowserSession> {
    return this.request('PATCH', url, options);
  }

  async delete(url: string, options?: RequestOptions): Promise<Response | BrowserSession> {
    return this.request('DELETE', url, options);
  }

  async head(url: string, options?: RequestOptions): Promise<Response | BrowserSession> {
    return this.request('HEAD', url, options);
  }

  async options(url: string, options?: RequestOptions): Promise<Response | BrowserSession> {
    return this.request('OPTIONS', url, options);
  }
}
