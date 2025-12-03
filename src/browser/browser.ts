/**
 * Browser automation for hrequests-js
 * Mirrors the Python hrequests browser module with full functionality
 */

import type { BrowserContext, Page, Response as PlaywrightResponse } from 'playwright';
import { Camoufox } from 'camoufox-js';
import { chromium as patchright, type Browser as PatchrightBrowser } from 'patchright';
import { HTML } from '../parser.js';
import { Response } from '../response.js';
import { Proxy } from './proxy.js';
import { CaseInsensitiveDict } from '../toolbelt.js';
import { RequestsCookieJar, listToCookiejar, cookiejarToList, type BrowserCookie } from '../cookies.js';
import {
  CacheDisabledError,
  JavascriptException,
  BrowserTimeoutException,
  NotRenderedException
} from '../exceptions.js';
import { fingerprint, OS_MAP, type OSName } from './fingerprint.js';
import type { TLSSession } from '../session.js';

export type BrowserType = 'firefox' | 'chrome';

export interface BrowserSessionOptions {
  /** Existing TLSSession to inherit settings from */
  session?: TLSSession;
  /** Existing Response to update with browser results */
  response?: Response;
  /** Proxy configuration */
  proxy?: string | Proxy;
  /** Whether to emulate human behavior */
  mockHuman?: boolean;
  /** Browser extensions/addons to load */
  extensions?: string[];
  /** Operating system for fingerprint generation */
  os?: 'win' | 'mac' | 'lin';
  /** Browser type */
  browser?: BrowserType;
  /** Verify HTTPS certificates */
  verify?: boolean;
  /** Run browser in headless mode */
  headless?: boolean;
  /** Enable browser cache */
  enableCache?: boolean;
  /** Additional launch options */
  [key: string]: unknown;
}

/**
 * BrowserSession - Full-featured browser automation
 * 
 * Navigation Methods:
 *   goto(url): Navigate to a URL
 *   forward(): Navigate to the next page in history
 *   back(): Navigate to the previous page in history
 *   awaitNavigation(): Wait for the page navigation to finish
 *   awaitScript(script, arg): Wait for a script to return true
 *   awaitSelector(selector): Wait for a selector to exist
 *   awaitEnabled(selector): Wait for a selector to be enabled
 *   isVisible(selector): Check if a selector is visible
 *   isEnabled(selector): Check if a selector is enabled
 *   awaitUrl(url, timeout): Wait for the URL to match
 *   dragTo(source, target): Drag and drop a selector
 *   type(selector, text, delay): Type text into a selector
 *   click(selector, options): Click a selector
 *   hover(selector): Hover over a selector
 *   evaluate(script, arg): Evaluate and return a script
 *   screenshot(selector, path, fullPage): Take a screenshot
 *   setHeaders(headers): Set the browser headers
 *   close(): Close the instance
 * 
 * Network Methods:
 *   get, post, put, patch, delete, head: Send HTTP requests
 */
export class BrowserSession {
  private browserInstance: PatchrightBrowser | any = null;
  private context: BrowserContext | any = null;
  page: Page | null = null;

  private readonly options: BrowserSessionOptions;
  private readonly browserType: BrowserType;
  private readonly headless: boolean;
  private readonly proxy?: Proxy;
  private readonly verify: boolean;
  private readonly os?: OSName;
  private readonly mockHuman: boolean;
  private readonly enableCache: boolean;

  private _headers: CaseInsensitiveDict | null = null;
  private _closed: boolean = false;
  statusCode: number | null = null;

  // References for cookie sync
  private session?: TLSSession;
  private resp?: Response;

  constructor(options: BrowserSessionOptions = {}) {
    this.options = options;
    this.browserType = options.browser || 'firefox';
    this.headless = options.headless ?? true;
    this.verify = options.verify ?? true;
    this.mockHuman = options.mockHuman ?? false;
    this.enableCache = options.enableCache ?? true;

    if (options.os) {
      this.os = OS_MAP[options.os] as OSName;
    }

    if (options.proxy) {
      this.proxy = options.proxy instanceof Proxy
        ? options.proxy
        : Proxy.fromUrl(options.proxy);
    }

    this.session = options.session;
    this.resp = options.response;

    if (this.resp) {
      this.statusCode = this.resp.statusCode;
    }
  }

  /**
   * Initialize the browser
   */
  async init(): Promise<void> {
    const proxyConfig = this.proxy?.toPlaywright();

    // Camoufox handles all fingerprinting by default
    if (this.browserType === 'firefox') {
      // Use Camoufox for Firefox
      const instance = await Camoufox({
        headless: this.headless,
        proxy: proxyConfig,
        // humanize: this.mockHuman, // if supported
      });

      if ('newContext' in instance) {
        this.browserInstance = instance;
        this.context = await this.browserInstance.newContext({
          ignoreHTTPSErrors: !this.verify,
        });
      } else {
        this.context = instance;
      }
    } else {
      // Generate fingerprint for the browser
      const fp = fingerprint.generateForBrowser(this.browserType, this.os);
      // Use Patchright for Chrome
      this.browserInstance = await patchright.launch({
        headless: this.headless,
        proxy: proxyConfig,
        args: [
          '--disable-blink-features=AutomationControlled',
        ],
      });

      this.context = await this.browserInstance.newContext({
        ignoreHTTPSErrors: !this.verify,
        extraHTTPHeaders: fp.headers,
      });

      await fingerprint.injectContext(this.context, fp);
    }

    // Inject fingerprint
    if (this.context) {
      this.page = await this.context.newPage();
    }
  }

  /**
   * Ensure browser is initialized
   */
  private async ensureInit(): Promise<void> {
    if (!this.page) {
      await this.init();
    }
  }

  // ==================== Navigation Methods ====================

  /**
   * Navigate to a URL
   */
  async goto(url: string): Promise<PlaywrightResponse | null> {
    await this.ensureInit();
    const resp = await this.page!.goto(url);
    if (resp) {
      this.statusCode = resp.status();
    }
    return resp;
  }

  /**
   * Navigate to the next page in history
   */
  async forward(): Promise<PlaywrightResponse | null> {
    await this.ensureInit();
    if (this.browserType === 'firefox' && !this.enableCache) {
      throw new CacheDisabledError();
    }
    return this.page!.goForward();
  }

  /**
   * Navigate to the previous page in history
   */
  async back(): Promise<PlaywrightResponse | null> {
    await this.ensureInit();
    if (this.browserType === 'firefox' && !this.enableCache) {
      throw new CacheDisabledError();
    }
    return this.page!.goBack();
  }

  /**
   * Wait for the page navigation to finish
   */
  async awaitNavigation(timeout: number = 30): Promise<void> {
    await this.ensureInit();
    await this.page!.waitForLoadState('load', { timeout: timeout * 1000 });
  }

  /**
   * Wait for a script to return true
   */
  async awaitScript(script: string, arg?: unknown, timeout: number = 30): Promise<void> {
    await this.ensureInit();
    await this.page!.waitForFunction(script, arg, { timeout: timeout * 1000 });
  }

  /**
   * Wait for a selector to exist
   */
  async awaitSelector(selector: string, timeout: number = 30): Promise<void> {
    await this.ensureInit();
    await this.page!.waitForFunction(
      (sel) => !!document.querySelector(sel),
      selector,
      { timeout: timeout * 1000 }
    );
  }

  /**
   * Wait for a selector to be enabled
   */
  async awaitEnabled(selector: string, timeout: number = 30): Promise<void> {
    await this.ensureInit();
    await this.page!.waitForFunction(
      (sel) => {
        const el = document.querySelector(sel) as HTMLInputElement | HTMLButtonElement | null;
        return el && !el.disabled;
      },
      selector,
      { timeout: timeout * 1000 }
    );
  }

  /**
   * Check if a selector is visible
   */
  async isVisible(selector: string): Promise<boolean> {
    await this.ensureInit();
    return this.page!.isVisible(selector);
  }

  /**
   * Check if a selector is enabled
   */
  async isEnabled(selector: string): Promise<boolean> {
    await this.ensureInit();
    if (!await this.page!.isVisible(selector)) {
      return false;
    }
    return this.page!.evaluate(
      (sel) => {
        const el = document.querySelector(sel) as HTMLInputElement | HTMLButtonElement | null;
        return el ? !el.disabled : false;
      },
      selector
    );
  }

  /**
   * Wait for the URL to match
   */
  async awaitUrl(
    url: string | RegExp | ((url: URL) => boolean),
    timeout: number = 30
  ): Promise<void> {
    await this.ensureInit();
    await this.page!.waitForURL(url, { timeout: timeout * 1000 });
  }

  /**
   * Drag and drop a selector
   */
  async dragTo(
    source: string,
    target: string,
    options: { timeout?: number; waitAfter?: boolean; check?: boolean } = {}
  ): Promise<void> {
    await this.ensureInit();
    const { timeout = 30, waitAfter = false, check = false } = options;
    await this.page!.dragAndDrop(source, target, {
      timeout: timeout * 1000,
      noWaitAfter: !waitAfter,
      strict: check,
    });
  }

  /**
   * Type text into a selector
   */
  async type(
    selector: string,
    text: string,
    options: { delay?: number; timeout?: number } = {}
  ): Promise<void> {
    await this.ensureInit();
    const { delay = 50, timeout = 30 } = options;

    if (!this.mockHuman) {
      await this.page!.type(selector, text, { delay, timeout: timeout * 1000 });
      return;
    }

    // Human-like typing with randomized delays
    await this.page!.click(selector);
    for (const char of text) {
      const randomDelay = Math.floor(delay * 0.5 + Math.random() * delay);
      await this.page!.keyboard.type(char, { delay: randomDelay });
    }
  }

  /**
   * Click a selector
   */
  async click(
    selector: string,
    options: {
      button?: 'left' | 'right' | 'middle';
      count?: number;
      timeout?: number;
      waitAfter?: boolean;
    } = {}
  ): Promise<void> {
    await this.ensureInit();
    const { button = 'left', count = 1, timeout = 30, waitAfter = true } = options;
    await this.page!.click(selector, {
      button,
      clickCount: count,
      timeout: timeout * 1000,
      noWaitAfter: !waitAfter,
    });
  }

  /**
   * Hover over a selector
   */
  async hover(
    selector: string,
    options: { modifiers?: Array<'Alt' | 'Control' | 'Meta' | 'Shift'>; timeout?: number } = {}
  ): Promise<void> {
    await this.ensureInit();
    const { modifiers, timeout = 90 } = options;
    await this.page!.hover(selector, { modifiers, timeout: timeout * 1000 });
  }

  /**
   * Evaluate and return javascript
   */
  async evaluate<T>(script: string | ((arg: unknown) => T), arg?: unknown): Promise<T> {
    await this.ensureInit();
    try {
      return await this.page!.evaluate(script, arg);
    } catch (e) {
      throw new JavascriptException(`Javascript eval exception: ${e}`);
    }
  }

  /**
   * Take a screenshot of the page
   */
  async screenshot(options: {
    selector?: string;
    path?: string;
    fullPage?: boolean;
  } = {}): Promise<Buffer | void> {
    await this.ensureInit();
    const { selector, path, fullPage = false } = options;

    let buffer: Buffer;
    if (selector) {
      const locator = this.page!.locator(selector);
      buffer = await locator.screenshot({ path });
    } else {
      buffer = await this.page!.screenshot({ path, fullPage });
    }

    if (!path) {
      return buffer;
    }
  }

  /**
   * Set the browser headers
   */
  async setHeaders(headers: Record<string, string> | CaseInsensitiveDict): Promise<void> {
    await this.ensureInit();

    const headerObj = headers instanceof CaseInsensitiveDict
      ? headers.toObject()
      : headers;

    // Convert array values to comma-separated strings
    const processedHeaders: Record<string, string> = {};
    for (const [key, value] of Object.entries(headerObj)) {
      processedHeaders[key] = Array.isArray(value) ? value.join(', ') : value;
    }

    this._headers = new CaseInsensitiveDict(processedHeaders);
    await this.context!.setExtraHTTPHeaders(processedHeaders);
  }

  /**
   * Load text content into the page
   */
  async loadText(text: string): Promise<void> {
    await this.ensureInit();
    await this.page!.setContent(text);
    await this.page!.waitForLoadState('domcontentloaded');
  }

  /**
   * Set cookies in the browser context
   */
  async setCookies(cookiejar: RequestsCookieJar): Promise<void> {
    await this.ensureInit();
    const cookies = cookiejarToList(cookiejar);
    const playwrightCookies = cookies.map(c => ({
      name: c.name,
      value: c.value,
      domain: c.domain || 'localhost',
      path: c.path || '/',
      expires: c.expires,
      secure: c.secure,
      httpOnly: c.httpOnly,
      sameSite: c.sameSite as 'Strict' | 'Lax' | 'None' | undefined,
    }));
    await this.context!.addCookies(playwrightCookies);
  }

  /**
   * Run an async function with the page
   */
  async run<T>(fn: (page: Page) => Promise<T>): Promise<T> {
    await this.ensureInit();
    return fn(this.page!);
  }

  // ==================== Properties ====================

  /**
   * Get the page URL
   */
  get url(): string {
    return this.page?.url() || '';
  }

  /**
   * Set the page URL (navigate)
   */
  set url(url: string) {
    this.goto(url);
  }

  /**
   * Get the page headers
   */
  get headers(): CaseInsensitiveDict {
    if (this._headers) {
      return this._headers;
    }
    // Extract User-Agent if available
    return new CaseInsensitiveDict({
      'User-Agent': this.page ? 'Mozilla/5.0' : '',
    });
  }

  /**
   * Set headers
   */
  set headers(headers: Record<string, string> | CaseInsensitiveDict) {
    this.setHeaders(headers);
  }

  /**
   * Get the page content
   */
  async getContent(): Promise<string> {
    await this.ensureInit();
    return this.page!.content();
  }

  /**
   * Get the page content (alias)
   */
  get content(): Promise<string> {
    return this.getContent();
  }

  /**
   * Get the page text
   */
  get text(): Promise<string> {
    return this.getContent();
  }

  /**
   * Get the page cookies
   */
  async getCookies(): Promise<RequestsCookieJar> {
    await this.ensureInit();
    const browserCookies = await this.context!.cookies();
    return listToCookiejar(browserCookies as BrowserCookie[]);
  }

  /**
   * Get cookies property
   */
  get cookies(): Promise<RequestsCookieJar> {
    return this.getCookies();
  }

  /**
   * Get the page HTML as an HTML object
   */
  async getHtml(): Promise<HTML> {
    const content = await this.getContent();
    return new HTML(content, this.url, this);
  }

  /**
   * Get HTML property
   */
  get html(): Promise<HTML> {
    return this.getHtml();
  }

  /**
   * Get the proxy configuration
   */
  get proxies(): Record<string, string> {
    return this.proxy ? { all: this.proxy.url } : {};
  }

  /**
   * Get the status reason
   */
  get reason(): string | undefined {
    if (this.statusCode === null) return undefined;
    const STATUS_CODES: Record<number, string> = {
      200: 'OK', 201: 'Created', 204: 'No Content',
      301: 'Moved Permanently', 302: 'Found', 304: 'Not Modified',
      400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden',
      404: 'Not Found', 500: 'Internal Server Error',
    };
    return STATUS_CODES[this.statusCode] || 'Unknown';
  }

  /**
   * Find an element
   */
  async find(selector: string): Promise<import('../parser.js').Element | null> {
    const html = await this.getHtml();
    return html.find(selector);
  }

  /**
   * Find all elements
   */
  async findAll(selector: string): Promise<import('../parser.js').Element[]> {
    const html = await this.getHtml();
    return html.findAll(selector) as import('../parser.js').Element[];
  }

  // ==================== Network Methods ====================

  /**
   * Send a request using the browser context
   */
  async request(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD',
    url: string,
    options: {
      params?: Record<string, string | number | boolean>;
      data?: unknown;
      headers?: Record<string, string>;
      form?: Record<string, string | number | boolean>;
      multipart?: Record<string, string | number | boolean | Buffer>;
      timeout?: number;
      verify?: boolean;
      maxRedirects?: number;
    } = {}
  ): Promise<Response> {
    await this.ensureInit();

    const {
      params,
      data,
      headers,
      form,
      multipart,
      timeout = 30,
      verify = true,
      maxRedirects,
    } = options;

    // Build URL with params
    let finalUrl = url;
    if (params) {
      const searchParams = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        searchParams.append(key, String(value));
      }
      finalUrl = `${url}?${searchParams.toString()}`;
    }

    // Use Playwright's request API
    const apiRequest = this.context!.request;
    const resp = await apiRequest.fetch(finalUrl, {
      method: method.toLowerCase() as any,
      headers,
      data,
      form: form as Record<string, string>,
      multipart: multipart as Record<string, string | number | boolean>,
      timeout: timeout * 1000,
      failOnStatusCode: false,
      ignoreHTTPSErrors: !verify,
      maxRedirects,
    });

    const content = await resp.body();
    const browserCookies = await this.context!.cookies();
    const cookiejar = listToCookiejar(browserCookies as BrowserCookie[]);

    const responseHeaders: Record<string, string> = {};
    for (const [key, value] of Object.entries(resp.headers())) {
      responseHeaders[key] = String(value);
    }

    return new Response({
      url: resp.url(),
      statusCode: resp.status(),
      headers: new CaseInsensitiveDict(responseHeaders),
      cookies: cookiejar,
      raw: content,
      session: this.session,
    });
  }

  async get(url: string, options?: Parameters<BrowserSession['request']>[2]): Promise<Response> {
    return this.request('GET', url, options);
  }

  async post(url: string, options?: Parameters<BrowserSession['request']>[2]): Promise<Response> {
    return this.request('POST', url, options);
  }

  async put(url: string, options?: Parameters<BrowserSession['request']>[2]): Promise<Response> {
    return this.request('PUT', url, options);
  }

  async patch(url: string, options?: Parameters<BrowserSession['request']>[2]): Promise<Response> {
    return this.request('PATCH', url, options);
  }

  async delete(url: string, options?: Parameters<BrowserSession['request']>[2]): Promise<Response> {
    return this.request('DELETE', url, options);
  }

  async head(url: string, options?: Parameters<BrowserSession['request']>[2]): Promise<Response> {
    return this.request('HEAD', url, options);
  }

  // ==================== Lifecycle ====================

  /**
   * Close the browser session
   */
  async close(): Promise<void> {
    if (this._closed) return;

    // Context never started
    if (this.context === null) {
      return;
    }

    // Get cookies before closing
    const cookiejar = await this.getCookies();

    // Update session if provided
    if (this.session) {
      this.session.cookies.update(cookiejar);
    }

    // Update response if provided
    if (this.resp) {
      (this.resp as any).cookies = cookiejar;
      (this.resp as any).raw = Buffer.from(await this.page!.content());
      (this.resp as any).url = this.page!.url();
      (this.resp as any).statusCode = this.statusCode;
    }

    // Close browser
    this._closed = true;
    if (this.context) {
      await this.context.close();
    }
    if (this.browserInstance) {
      await this.browserInstance.close();
    }
  }

  /**
   * Alias for close
   */
  async shutdown(): Promise<void> {
    await this.close();
  }

  /**
   * Support for using statement
   */
  async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }

  async delete_(): Promise<void> {
    await this.close();
  }

  /**
   * Parse JSON from page body
   */
  async json(): Promise<unknown> {
    await this.ensureInit();
    const content = await this.page!.innerText('body');
    return JSON.parse(content);
  }
}

/**
 * Render a page with a browser
 */
export async function render(
  url?: string,
  options: BrowserSessionOptions & {
    response?: Response;
    session?: TLSSession;
  } = {}
): Promise<BrowserSession> {
  if (!url && !options.session && !options.response) {
    throw new Error('Must provide a url or an existing session/response');
  }

  const browserSession = new BrowserSession(options);
  await browserSession.init();

  // Include headers from session if provided
  if (options.session && 'headers' in options.session) {
    await browserSession.setHeaders(options.session.headers);
  }

  // Include cookies from session or response
  const cookieSource = options.session || options.response;
  if (cookieSource && 'cookies' in cookieSource) {
    await browserSession.setCookies(cookieSource.cookies as RequestsCookieJar);
  }

  // Navigate to URL if provided
  if (url) {
    await browserSession.goto(url);
  }

  return browserSession;
}
