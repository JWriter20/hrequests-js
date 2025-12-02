import { Response as UndiciResponse } from 'undici';
import { HTML } from './html.js';
import type { CookieJar } from 'tough-cookie';

export class Response {
  readonly raw: Buffer;
  readonly url: string;
  readonly statusCode: number;
  readonly headers: Record<string, string>;
  readonly cookies: CookieJar;
  readonly history: Response[];

  private _html: HTML | null = null;
  private _json: unknown | null = null;
  private _text: string | null = null;

  constructor(
    raw: Buffer,
    url: string,
    statusCode: number,
    headers: Record<string, string>,
    cookies: CookieJar,
    history: Response[] = []
  ) {
    this.raw = raw;
    this.url = url;
    this.statusCode = statusCode;
    this.headers = headers;
    this.cookies = cookies;
    this.history = history;
  }

  get ok(): boolean {
    return this.statusCode >= 200 && this.statusCode < 300;
  }

  // Compatible with previous API (async method)
  async text(): Promise<string> {
    if (this._text === null) {
      // TODO: Handle encoding from headers
      this._text = this.raw.toString('utf-8');
    }
    return this._text;
  }

  get content(): Buffer {
    return this.raw;
  }

  get html(): HTML {
    if (this._html === null) {
      // Synchronous access to text (assuming it was loaded or we load it now)
      if (this._text === null) {
        this._text = this.raw.toString('utf-8');
      }
      this._html = new HTML(this._text!, this.url);
    }
    return this._html;
  }

  // Compatible with previous API (async method)
  async json<T = unknown>(): Promise<T> {
    if (this._json === null) {
      try {
        const text = await this.text();
        this._json = JSON.parse(text);
      } catch (e) {
        throw new Error('Response is not valid JSON');
      }
    }
    return this._json as T;
  }

  get reason(): string {
    // TODO: Map status code to reason phrase
    return '';
  }

  async delete(): Promise<void> {
    // No-op for local implementation
  }

  toString(): string {
    return `<Response [${this.statusCode}]>`;
  }
}
