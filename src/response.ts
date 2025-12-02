/**
 * Response class for hrequests-js
 * Mirrors the Python hrequests Response class
 */

import { HTML } from './parser.js';
import { CaseInsensitiveDict } from './toolbelt.js';
import { RequestsCookieJar } from './cookies.js';
import { EncodingNotFoundException } from './exceptions.js';
import type { BrowserSession } from './browser/browser.js';
import type { TLSSession } from './session.js';

// HTTP status code to reason phrase mapping
const STATUS_CODES: Record<number, string> = {
  100: 'Continue',
  101: 'Switching Protocols',
  102: 'Processing',
  103: 'Early Hints',
  200: 'OK',
  201: 'Created',
  202: 'Accepted',
  203: 'Non-Authoritative Information',
  204: 'No Content',
  205: 'Reset Content',
  206: 'Partial Content',
  207: 'Multi-Status',
  208: 'Already Reported',
  226: 'IM Used',
  300: 'Multiple Choices',
  301: 'Moved Permanently',
  302: 'Found',
  303: 'See Other',
  304: 'Not Modified',
  305: 'Use Proxy',
  307: 'Temporary Redirect',
  308: 'Permanent Redirect',
  400: 'Bad Request',
  401: 'Unauthorized',
  402: 'Payment Required',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  406: 'Not Acceptable',
  407: 'Proxy Authentication Required',
  408: 'Request Timeout',
  409: 'Conflict',
  410: 'Gone',
  411: 'Length Required',
  412: 'Precondition Failed',
  413: 'Payload Too Large',
  414: 'URI Too Long',
  415: 'Unsupported Media Type',
  416: 'Range Not Satisfiable',
  417: 'Expectation Failed',
  418: "I'm a Teapot",
  421: 'Misdirected Request',
  422: 'Unprocessable Entity',
  423: 'Locked',
  424: 'Failed Dependency',
  425: 'Too Early',
  426: 'Upgrade Required',
  428: 'Precondition Required',
  429: 'Too Many Requests',
  431: 'Request Header Fields Too Large',
  451: 'Unavailable For Legal Reasons',
  500: 'Internal Server Error',
  501: 'Not Implemented',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout',
  505: 'HTTP Version Not Supported',
  506: 'Variant Also Negotiates',
  507: 'Insufficient Storage',
  508: 'Loop Detected',
  510: 'Not Extended',
  511: 'Network Authentication Required',
};

export interface ResponseOptions {
  url: string;
  statusCode: number;
  headers: CaseInsensitiveDict | Record<string, string>;
  cookies: RequestsCookieJar;
  raw: Buffer | string;
  history?: Response[];
  session?: TLSSession | BrowserSession | null;
  browser?: 'firefox' | 'chrome';
  version?: number;
  elapsed?: number;
  encoding?: string;
  isUtf8?: boolean;
  proxy?: string;
}

/**
 * Response object
 * 
 * Properties:
 *   url: Response url
 *   statusCode: Response status code
 *   reason: Response status reason
 *   headers: Response headers
 *   cookies: Response cookies
 *   text: Response body as text
 *   content: Response body as bytes
 *   ok: True if status code is less than 400
 *   elapsed: Time elapsed for the request (in milliseconds)
 *   html: Response body as HTML parser object
 */
export class Response {
  readonly url: string;
  readonly statusCode: number;
  readonly headers: CaseInsensitiveDict;
  readonly cookies: RequestsCookieJar;
  readonly raw: Buffer;

  history: Response[];
  session: TLSSession | BrowserSession | null;
  browser?: 'firefox' | 'chrome';
  version?: number;
  elapsed?: number;
  encoding: string;
  isUtf8: boolean;
  proxy?: string;

  private _html: HTML | null = null;
  private _text: string | null = null;

  constructor(options: ResponseOptions) {
    this.url = options.url;
    this.statusCode = options.statusCode;
    this.headers = options.headers instanceof CaseInsensitiveDict
      ? options.headers
      : new CaseInsensitiveDict(options.headers);
    this.cookies = options.cookies;
    this.raw = Buffer.isBuffer(options.raw) ? options.raw : Buffer.from(options.raw);
    this.history = options.history || [];
    this.session = options.session || null;
    this.browser = options.browser;
    this.version = options.version;
    this.elapsed = options.elapsed;
    this.isUtf8 = options.isUtf8 ?? true;
    this.proxy = options.proxy;

    // Detect encoding
    this.encoding = options.encoding || this._detectEncoding();
  }

  /**
   * Detect encoding from content or headers
   */
  private _detectEncoding(): string {
    // Check Content-Type header for charset
    const contentType = this.headers.get('Content-Type');
    if (contentType) {
      const match = contentType.match(/charset=([^\s;]+)/i);
      if (match) {
        return match[1].replace(/['"]/g, '');
      }
    }

    // Check for BOM
    if (this.raw.length >= 3) {
      // UTF-8 BOM
      if (this.raw[0] === 0xEF && this.raw[1] === 0xBB && this.raw[2] === 0xBF) {
        return 'utf-8';
      }
      // UTF-16 BE BOM
      if (this.raw[0] === 0xFE && this.raw[1] === 0xFF) {
        return 'utf-16be';
      }
      // UTF-16 LE BOM
      if (this.raw[0] === 0xFF && this.raw[1] === 0xFE) {
        return 'utf-16le';
      }
    }

    // Default to UTF-8
    return 'utf-8';
  }

  /**
   * Response status reason phrase
   */
  get reason(): string {
    return STATUS_CODES[this.statusCode] || 'Unknown';
  }

  /**
   * Parse response body as JSON
   */
  json<T = unknown>(): T {
    return JSON.parse(this.text);
  }

  /**
   * Response body as bytes (Buffer)
   */
  get content(): Buffer {
    return this.raw;
  }

  /**
   * Response body as text
   */
  get text(): string {
    if (this._text === null) {
      if (!this.encoding) {
        throw new EncodingNotFoundException('Response does not have a valid encoding.');
      }
      this._text = this.raw.toString(this.encoding as BufferEncoding);
    }
    return this._text;
  }

  /**
   * Response body as HTML parser object
   */
  get html(): HTML {
    if (this._html === null) {
      this._html = new HTML(this.text, this.url, this.session);
    }
    return this._html;
  }

  /**
   * Shortcut to .html.find
   */
  find(selector: string) {
    return this.html.find(selector);
  }

  /**
   * Shortcut to .html.findAll
   */
  findAll(selector: string) {
    return this.html.findAll(selector);
  }

  /**
   * True if status code is less than 400
   */
  get ok(): boolean {
    return this.statusCode < 400;
  }

  /**
   * Returns the parsed header links of the response, if any
   */
  get links(): Record<string, Record<string, string>> {
    const header = this.headers.get('Link');
    const resolvedLinks: Record<string, Record<string, string>> = {};

    if (!header) {
      return resolvedLinks;
    }

    const links = parseHeaderLinks(header);
    for (const link of links) {
      const key = link.rel || link.url;
      resolvedLinks[key] = link;
    }
    return resolvedLinks;
  }

  /**
   * Render the response in a browser
   */
  async render(options: {
    proxy?: string;
    browser?: 'firefox' | 'chrome';
    headless?: boolean;
    mockHuman?: boolean;
  } = {}): Promise<BrowserSession> {
    // Dynamic import to avoid circular dependency
    const { render } = await import('./browser/browser.js');

    return render(this.url, {
      response: this,
      session: this.session as TLSSession | undefined,
      proxy: options.proxy || this.proxy,
      browser: options.browser || this.browser,
      headless: options.headless,
      mockHuman: options.mockHuman,
    });
  }

  /**
   * Boolean evaluation - True if status code is less than 400
   */
  valueOf(): boolean {
    return this.ok;
  }

  toString(): string {
    return `<Response [${this.statusCode}]>`;
  }

  /**
   * Support for with/using statement pattern
   */
  [Symbol.dispose](): void {
    // Cleanup if needed
  }
}

/**
 * Parse Link header into a list of link objects
 */
function parseHeaderLinks(value: string): Array<Record<string, string>> {
  const links: Array<Record<string, string>> = [];
  const replaceChars = " '\"";
  value = value.trim();

  if (!value) {
    return links;
  }

  for (const val of value.split(/, *</)) {
    const parts = val.split(';', 2);
    const url = parts[0];
    const params = parts[1] || '';

    const link: Record<string, string> = {
      url: url.replace(/[<> '"]/g, ''),
    };

    for (const param of params.split(';')) {
      const keyValue = param.split('=', 2);
      if (keyValue.length === 2) {
        const key = keyValue[0].trim().replace(/['" ]/g, '');
        const paramValue = keyValue[1].trim().replace(/['" ]/g, '');
        link[key] = paramValue;
      }
    }

    links.push(link);
  }

  return links;
}

/**
 * Build a Response object from bridge response data
 */
export function buildResponse(
  res: {
    target?: string;
    status: number;
    headers: Record<string, string | string[]> | null;
    body: string | Buffer;
    isBase64?: boolean;
  },
  cookies: RequestsCookieJar,
  proxy?: string
): Response {
  // Build headers
  const resHeaders: Record<string, string> = {};
  if (res.headers) {
    for (const [key, value] of Object.entries(res.headers)) {
      if (Array.isArray(value)) {
        resHeaders[key] = value.length === 1 ? value[0] : value.join(', ');
      } else {
        resHeaders[key] = value;
      }
    }
  }

  // Decode base64 body if needed
  let body: Buffer;
  if (res.isBase64 && typeof res.body === 'string') {
    body = Buffer.from(res.body, 'base64');
  } else if (Buffer.isBuffer(res.body)) {
    body = res.body;
  } else {
    body = Buffer.from(res.body || '');
  }

  return new Response({
    url: res.target || '',
    statusCode: res.status,
    headers: new CaseInsensitiveDict(resHeaders),
    cookies,
    raw: body,
    isUtf8: !res.isBase64,
    proxy,
  });
}

/**
 * A FailedResponse object is returned when a request fails and no exception handler is provided
 */
export class FailedResponse {
  readonly exception: Error;

  constructor(exception: Error) {
    this.exception = exception;
  }

  valueOf(): boolean {
    return false;
  }

  toString(): string {
    return `<FailedResponse: ${this.exception.message}>`;
  }
}
