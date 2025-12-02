/**
 * Cookie utilities for hrequests-js
 * Mirrors the Python hrequests cookies module
 */

import { CookieJar, Cookie } from 'tough-cookie';
import { CaseInsensitiveDict } from './toolbelt.js';

export interface CookieDict {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expires?: number | Date;
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
}

export class CookieConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CookieConflictError';
  }
}

/**
 * Enhanced CookieJar that provides dict-like interface
 * Compatible with the Python RequestsCookieJar
 */
export class RequestsCookieJar {
  private jar: CookieJar;

  constructor(jar?: CookieJar) {
    this.jar = jar || new CookieJar();
  }

  /** Get the underlying tough-cookie CookieJar */
  getJar(): CookieJar {
    return this.jar;
  }

  /**
   * Dict-like get() that also supports optional domain and path args
   */
  get(name: string, defaultValue?: string, domain?: string, path?: string): string | undefined {
    try {
      return this._findNoDuplicates(name, domain, path);
    } catch {
      return defaultValue;
    }
  }

  /**
   * Dict-like set() that also supports optional domain and path args
   */
  set(name: string, value: string | null, options: Partial<CookieDict> = {}): Cookie | undefined {
    if (value === null) {
      this.remove(name, options.domain, options.path);
      return undefined;
    }

    const cookie = createCookie(name, value, options);
    this.setCookie(cookie);
    return cookie;
  }

  /**
   * Set a cookie in the jar
   */
  setCookie(cookie: Cookie | string, url?: string): void {
    if (typeof cookie === 'string') {
      this.jar.setCookieSync(cookie, url || 'http://localhost');
    } else {
      // Convert Cookie to string and set
      const cookieStr = cookie.toString();
      const domain = cookie.domain || 'localhost';
      const secure = cookie.secure ? 'https' : 'http';
      this.jar.setCookieSync(cookieStr, `${secure}://${domain.replace(/^\./, '')}${cookie.path || '/'}`);
    }
  }

  /**
   * Remove a cookie by name
   */
  remove(name: string, domain?: string, path?: string): void {
    // Get all cookies and filter out the one to remove
    const allCookies = this._getAllCookies();
    const toRemove: Cookie[] = [];

    for (const cookie of allCookies) {
      if (cookie.key !== name) continue;
      if (domain !== undefined && cookie.domain !== domain) continue;
      if (path !== undefined && cookie.path !== path) continue;
      toRemove.push(cookie);
    }

    // Remove by clearing and re-adding all except the ones to remove
    if (toRemove.length > 0) {
      const remaining = allCookies.filter(c => !toRemove.includes(c));
      this.jar.removeAllCookiesSync();
      for (const cookie of remaining) {
        this.setCookie(cookie);
      }
    }
  }

  /** Returns an iterator of cookie names */
  *keys(): IterableIterator<string> {
    const seen = new Set<string>();
    for (const cookie of this._getAllCookies()) {
      if (!seen.has(cookie.key)) {
        seen.add(cookie.key);
        yield cookie.key;
      }
    }
  }

  /** Returns an iterator of cookie values */
  *values(): IterableIterator<string> {
    for (const cookie of this._getAllCookies()) {
      yield cookie.value;
    }
  }

  /** Returns an iterator of [name, value] pairs */
  *entries(): IterableIterator<[string, string]> {
    for (const cookie of this._getAllCookies()) {
      yield [cookie.key, cookie.value];
    }
  }

  /** Returns a list of all domains in the jar */
  listDomains(): string[] {
    const domains: string[] = [];
    for (const cookie of this._getAllCookies()) {
      if (cookie.domain && !domains.includes(cookie.domain)) {
        domains.push(cookie.domain);
      }
    }
    return domains;
  }

  /** Returns a list of all paths in the jar */
  listPaths(): string[] {
    const paths: string[] = [];
    for (const cookie of this._getAllCookies()) {
      if (cookie.path && !paths.includes(cookie.path)) {
        paths.push(cookie.path);
      }
    }
    return paths;
  }

  /** Returns True if there are multiple domains in the jar */
  multipleDomains(): boolean {
    const domains: string[] = [];
    for (const cookie of this._getAllCookies()) {
      if (cookie.domain) {
        if (domains.includes(cookie.domain)) {
          return true;
        }
        domains.push(cookie.domain);
      }
    }
    return false;
  }

  /**
   * Returns a plain dict of name-value pairs that meet the requirements
   */
  getDict(domain?: string, path?: string): Record<string, string> {
    const result: Record<string, string> = {};
    for (const cookie of this._getAllCookies()) {
      if (domain !== undefined && cookie.domain !== domain) continue;
      if (path !== undefined && cookie.path !== path) continue;
      result[cookie.key] = cookie.value;
    }
    return result;
  }

  /** Check if a cookie with the given name exists */
  has(name: string): boolean {
    for (const cookie of this._getAllCookies()) {
      if (cookie.key === name) return true;
    }
    return false;
  }

  /** Update this jar with cookies from another jar or dict */
  update(other: RequestsCookieJar | Record<string, string> | CookieJar): void {
    if (other instanceof RequestsCookieJar) {
      for (const cookie of other._getAllCookies()) {
        this.setCookie(cookie);
      }
    } else if (other instanceof CookieJar) {
      const cookies = other.getCookiesSync('http://localhost');
      for (const cookie of cookies) {
        this.setCookie(cookie);
      }
    } else {
      for (const [name, value] of Object.entries(other)) {
        this.set(name, value);
      }
    }
  }

  /** Return a copy of this jar */
  copy(): RequestsCookieJar {
    const newJar = new RequestsCookieJar();
    newJar.update(this);
    return newJar;
  }

  /** Clear all cookies */
  clear(): void {
    this.jar.removeAllCookiesSync();
  }

  /** Get all cookies as an array */
  private _getAllCookies(): Cookie[] {
    // Get cookies for a broad URL to capture most cookies
    // This is a workaround since tough-cookie doesn't have a direct "get all" method
    try {
      const store = (this.jar as any).store;
      if (store && typeof store.getAllCookies === 'function') {
        return store.getAllCookiesSync() || [];
      }
    } catch {
      // Fallback
    }
    return [];
  }

  private _findNoDuplicates(name: string, domain?: string, path?: string): string {
    let result: string | undefined;
    for (const cookie of this._getAllCookies()) {
      if (cookie.key !== name) continue;
      if (domain !== undefined && cookie.domain !== domain) continue;
      if (path !== undefined && cookie.path !== path) continue;

      if (result !== undefined) {
        throw new CookieConflictError(`There are multiple cookies with name, '${name}'`);
      }
      result = cookie.value;
    }

    if (result === undefined) {
      throw new Error(`name='${name}', domain='${domain}', path='${path}'`);
    }
    return result;
  }

  [Symbol.iterator](): IterableIterator<[string, string]> {
    return this.entries();
  }
}

/**
 * Create a cookie from underspecified parameters
 */
export function createCookie(name: string, value: string, options: Partial<CookieDict> = {}): Cookie {
  const cookieOptions: any = {
    key: name,
    value: value,
    domain: options.domain || '',
    path: options.path || '/',
    secure: options.secure ?? false,
    httpOnly: options.httpOnly ?? false,
    sameSite: options.sameSite,
  };

  if (options.expires) {
    cookieOptions.expires = options.expires instanceof Date
      ? options.expires
      : new Date(options.expires * 1000);
  }

  return new Cookie(cookieOptions);
}

/**
 * Transform a dict to RequestsCookieJar
 */
export function cookiejarFromDict(cookieDict: Record<string, string>): RequestsCookieJar {
  const jar = new RequestsCookieJar();
  if (cookieDict) {
    for (const [name, value] of Object.entries(cookieDict)) {
      jar.set(name, value);
    }
  }
  return jar;
}

/**
 * Merge cookies in session and cookies provided in request
 */
export function mergeCookies(
  cookiejar: RequestsCookieJar,
  cookies: Record<string, string> | RequestsCookieJar
): RequestsCookieJar {
  if (cookies instanceof RequestsCookieJar) {
    cookiejar.update(cookies);
  } else {
    for (const [name, value] of Object.entries(cookies)) {
      cookiejar.set(name, value);
    }
  }
  return cookiejar;
}

/**
 * Convert browser cookies (Playwright format) to RequestsCookieJar
 */
export function listToCookiejar(browserCookies: BrowserCookie[]): RequestsCookieJar {
  const jar = new RequestsCookieJar();
  for (const brCookie of browserCookies) {
    jar.set(brCookie.name, brCookie.value, {
      domain: brCookie.domain,
      path: brCookie.path,
      expires: brCookie.expires,
      secure: brCookie.secure,
      httpOnly: brCookie.httpOnly,
      sameSite: brCookie.sameSite as 'Strict' | 'Lax' | 'None' | undefined,
    });
  }
  return jar;
}

/**
 * Convert RequestsCookieJar to browser cookies (Playwright format)
 */
export function cookiejarToList(cookiejar: RequestsCookieJar): BrowserCookie[] {
  const result: BrowserCookie[] = [];

  try {
    const store = (cookiejar.getJar() as any).store;
    if (store && typeof store.getAllCookies === 'function') {
      const cookies = store.getAllCookiesSync() || [];
      for (const cookie of cookies) {
        result.push({
          name: cookie.key,
          value: cookie.value,
          domain: cookie.domain || '',
          path: cookie.path || '/',
          expires: cookie.expires ? Math.floor(cookie.expires.getTime() / 1000) : undefined,
          secure: cookie.secure,
          httpOnly: cookie.httpOnly,
          sameSite: cookie.sameSite,
        });
      }
    }
  } catch {
    // Fallback - return empty
  }

  return result;
}

export interface BrowserCookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expires?: number;
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: string;
}

/**
 * Extract cookies from response headers into jar
 */
export function extractCookiesToJar(
  requestUrl: string,
  requestHeaders: CaseInsensitiveDict | Record<string, string>,
  cookieJar: RequestsCookieJar,
  responseHeaders: Record<string, string | string[]>
): RequestsCookieJar {
  const responseCookieJar = new RequestsCookieJar();

  // Get Set-Cookie headers
  const setCookieHeaders = responseHeaders['set-cookie'] || responseHeaders['Set-Cookie'];
  if (!setCookieHeaders) {
    return responseCookieJar;
  }

  const cookies = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];

  for (const cookieStr of cookies) {
    try {
      responseCookieJar.setCookie(cookieStr, requestUrl);
      cookieJar.setCookie(cookieStr, requestUrl);
    } catch {
      // Ignore invalid cookies
    }
  }

  return responseCookieJar;
}

