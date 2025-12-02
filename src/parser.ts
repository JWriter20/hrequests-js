/**
 * HTML Parser for hrequests-js
 * Mirrors the Python hrequests parser module
 */

import * as cheerio from 'cheerio';
import type { Element as CheerioElement, AnyNode } from 'domhandler';
import { type CheerioAPI, type Cheerio } from 'cheerio';
import { SelectorNotFoundException, NotRenderedException } from './exceptions.js';
import type { TLSSession } from './session.js';
import type { BrowserSession } from './browser/browser.js';

const DEFAULT_URL = 'https://example.org/';
const DEFAULT_NEXT_SYMBOL = ['next', 'more', 'older'];

// Keyword argument mapping for HTML attributes
const KWARG_MAP: Record<string, string> = {
  'class_': 'class',
  'for_': 'for',
  'async_': 'async',
  'accept_charset': 'accept-charset',
  'http_equiv': 'http-equiv',
};

/**
 * An element of HTML
 */
export class Element {
  private readonly $: CheerioAPI;
  private readonly element: Cheerio<CheerioElement>;
  private readonly _url: string;
  private readonly brSession?: BrowserSession;
  private _attrs: Record<string, string | string[]> | null = null;

  constructor(
    $: CheerioAPI,
    element: Cheerio<CheerioElement>,
    url: string,
    brSession?: BrowserSession
  ) {
    this.$ = $;
    this.element = element;
    this._url = url;
    this.brSession = brSession;
  }

  /**
   * The tag name of the element
   */
  get tag(): string {
    return this.element.prop('tagName')?.toLowerCase() || '';
  }

  /**
   * The text content of the element
   */
  get text(): string {
    return this.element.text();
  }

  /**
   * Get the text of the element with options
   */
  getText(options: { children?: boolean; separator?: string; strip?: boolean } = {}): string {
    const { children = true, separator = '\n', strip = false } = options;

    let text: string;
    if (children) {
      text = this.element.text();
    } else {
      // Get only direct text nodes
      text = this.element.contents()
        .filter((_, node) => node.type === 'text')
        .text();
    }

    if (strip) {
      text = text.trim();
    }

    return text;
  }

  /**
   * The full text content including links
   */
  get fullText(): string {
    return this.element.text();
  }

  /**
   * Unicode representation of the HTML content
   */
  get html(): string {
    return this.element.html() || '';
  }

  /**
   * Bytes representation of the HTML content
   */
  get rawHtml(): Buffer {
    return Buffer.from(this.html);
  }

  /**
   * Returns a dictionary of the attributes of the Element
   */
  get attrs(): Record<string, string | string[]> {
    if (this._attrs === null) {
      const rawAttrs = this.element.attr() || {};
      this._attrs = { ...rawAttrs };

      // Split class and rel up, as there are usually many of them
      for (const attr of ['class', 'rel']) {
        if (attr in this._attrs && typeof this._attrs[attr] === 'string') {
          this._attrs[attr] = (this._attrs[attr] as string).split(/\s+/);
        }
      }
    }
    return this._attrs;
  }

  /**
   * Get a specific attribute
   */
  attr(name: string): string | string[] | undefined {
    // Check kwarg map
    const mappedName = KWARG_MAP[name] || name;
    return this.attrs[mappedName];
  }

  /**
   * Find a single element matching the selector
   */
  find(
    selector: string = '*',
    options: {
      containing?: string | string[];
      raiseException?: boolean;
      attrs?: Record<string, string>;
    } = {}
  ): Element | null {
    const { containing, raiseException = true, attrs } = options;

    const result = this.findAll(selector, { containing, first: true, raiseException, attrs });
    return Array.isArray(result) ? result[0] || null : result;
  }

  /**
   * Find all elements matching the selector
   */
  findAll(
    selector: string = '*',
    options: {
      containing?: string | string[];
      first?: boolean;
      raiseException?: boolean;
      attrs?: Record<string, string>;
    } = {}
  ): Element[] | Element | null {
    const { containing, first = false, raiseException = true, attrs } = options;

    // Build selector with attributes
    let fullSelector = selector;
    if (attrs) {
      for (const [key, value] of Object.entries(attrs)) {
        const mappedKey = KWARG_MAP[key] || key;
        fullSelector += `[${mappedKey}="${value}"]`;
      }
    }

    // Find elements
    let found: Cheerio<CheerioElement>;
    if (first) {
      const firstEl = this.element.find(fullSelector).first();
      if (firstEl.length === 0) {
        if (!raiseException) {
          return null;
        }
        throw new SelectorNotFoundException(`No elements were found with selector '${fullSelector}'.`);
      }
      found = firstEl;
    } else {
      found = this.element.find(fullSelector) as Cheerio<CheerioElement>;
    }

    // Convert to Element objects
    let elements = found.map((_, el) =>
      new Element(this.$, this.$(el) as Cheerio<CheerioElement>, this._url, this.brSession)
    ).toArray();

    // Filter by containing text
    if (containing) {
      const containingList = Array.isArray(containing) ? containing : [containing];
      elements = elements.filter(element =>
        containingList.some(c => element.fullText.toLowerCase().includes(c.toLowerCase()))
      );
      elements.reverse();
    }

    if (first) {
      return elements[0] || null;
    }
    return elements;
  }

  /**
   * Search the Element for the given parse template
   */
  search(template: string): Record<string, string> | null {
    // Simple template parsing - looks for {name} patterns
    const regex = template.replace(/\{(\w+)\}/g, '(?<$1>.+?)');
    const match = this.html.match(new RegExp(regex));
    if (match && match.groups) {
      return match.groups;
    }
    return null;
  }

  /**
   * Search the Element multiple times for the given parse template
   */
  searchAll(template: string): Array<Record<string, string>> {
    const regex = template.replace(/\{(\w+)\}/g, '(?<$1>.+?)');
    const matches = this.html.matchAll(new RegExp(regex, 'g'));
    const results: Array<Record<string, string>> = [];
    for (const match of matches) {
      if (match.groups) {
        results.push(match.groups);
      }
    }
    return results;
  }

  /**
   * All found links on the element, in as-is form
   */
  get links(): Set<string> {
    const linkSet = new Set<string>();
    const anchors = this.findAll('a') as Element[];

    for (const link of anchors) {
      const href = link.attr('href');
      if (typeof href === 'string') {
        const trimmed = href.trim();
        if (
          trimmed &&
          !trimmed.startsWith('#') &&
          !trimmed.startsWith('javascript:') &&
          !trimmed.startsWith('mailto:')
        ) {
          linkSet.add(trimmed);
        }
      }
    }

    return linkSet;
  }

  /**
   * All found links on the element, in absolute form
   */
  get absoluteLinks(): Set<string> {
    const linkSet = new Set<string>();
    for (const link of this.links) {
      linkSet.add(this._makeAbsolute(link));
    }
    return linkSet;
  }

  /**
   * The base URL for the element
   */
  get baseUrl(): string {
    // Check for <base> tag
    const baseEl = this.find('base', { raiseException: false });
    if (baseEl) {
      const href = baseEl.attr('href');
      if (typeof href === 'string' && href.trim()) {
        return href.trim();
      }
    }

    // Parse the url to separate out the path
    try {
      const parsed = new URL(this._url);
      const pathParts = parsed.pathname.split('/');
      pathParts.pop();
      parsed.pathname = pathParts.join('/') + '/';
      return parsed.toString();
    } catch {
      return this._url;
    }
  }

  /**
   * Makes a given link absolute
   */
  private _makeAbsolute(link: string): string {
    try {
      const parsed = new URL(link, this.baseUrl);
      return parsed.toString();
    } catch {
      return link;
    }
  }

  /**
   * Get the CSS selector path for this element
   */
  get cssPath(): string {
    const path: string[] = [];
    let current = this.element;

    while (current.length > 0) {
      const tagName = current.prop('tagName')?.toLowerCase();
      if (!tagName || tagName === 'html') break;

      const parent = current.parent();
      if (parent.length === 0) break;

      // Count siblings of same type before this element
      const siblings = parent.children(tagName);
      const index = siblings.index(current) + 1;

      path.unshift(`${tagName}:nth-of-type(${index})`);
      current = parent as Cheerio<CheerioElement>;
    }

    return path.join(' > ');
  }

  /**
   * Pass through to BrowserSession methods
   */
  private _getBrowserMethod(name: string): ((...args: unknown[]) => Promise<unknown>) | undefined {
    if (!this.brSession) {
      throw new NotRenderedException(`Method ${name} only allowed in BrowserSession`);
    }

    const method = (this.brSession as any)[name];
    if (typeof method === 'function') {
      return (...args: unknown[]) => method.call(this.brSession, this.cssPath, ...args);
    }
    return undefined;
  }

  // Browser session passthrough methods
  async click(): Promise<void> {
    const method = this._getBrowserMethod('click');
    if (method) await method();
  }

  async type(text: string, delay?: number): Promise<void> {
    const method = this._getBrowserMethod('type');
    if (method) await method(text, delay);
  }

  async hover(): Promise<void> {
    const method = this._getBrowserMethod('hover');
    if (method) await method();
  }

  async screenshot(path?: string): Promise<Buffer | void> {
    const method = this._getBrowserMethod('screenshot');
    if (method) return method(path) as Promise<Buffer | void>;
  }

  toString(): string {
    const attrs = Object.entries(this.attrs)
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
      .join(' ');
    return `<Element '${this.tag}' ${attrs}>`;
  }
}

/**
 * An HTML document, ready for parsing
 */
export class HTML extends Element {
  private readonly _session: TLSSession | BrowserSession | null;
  private _nextSymbol: string[];

  constructor(
    html: string,
    url: string = DEFAULT_URL,
    session?: TLSSession | BrowserSession | null
  ) {
    const $ = cheerio.load(html);
    const root = $.root() as unknown as Cheerio<CheerioElement>;

    super($, root, url, session as BrowserSession | undefined);

    this._session = session || null;
    this._nextSymbol = [...DEFAULT_NEXT_SYMBOL];
  }

  /**
   * The session used for the HTML request
   */
  get session(): TLSSession | BrowserSession | null {
    return this._session;
  }

  /**
   * The URL of the HTML document
   */
  get url(): string {
    return (this as any)._url;
  }

  /**
   * Attempts to find the next page URL
   * If fetch is true, returns the HTML object of next page
   * If fetch is false, simply returns the next URL
   */
  async next(options: { fetch?: boolean; nextSymbol?: string[] } = {}): Promise<HTML | string | null> {
    const { fetch = false, nextSymbol = this._nextSymbol } = options;

    const getNext = (): string | null => {
      const candidates = this.findAll('a', { containing: nextSymbol }) as Element[];

      for (const candidate of candidates) {
        const href = candidate.attr('href');
        if (typeof href !== 'string') continue;

        // Support 'next' rel
        const rel = candidate.attr('rel');
        if (Array.isArray(rel) && rel.includes('next')) {
          return href;
        }

        // Support 'next' in classnames
        const classes = candidate.attr('class');
        if (Array.isArray(classes)) {
          for (const cls of classes) {
            if (cls.includes('next')) {
              return href;
            }
          }
        }

        if (href.includes('page')) {
          return href;
        }
      }

      // Resort to the last candidate
      if (candidates.length > 0) {
        const lastHref = candidates[candidates.length - 1].attr('href');
        if (typeof lastHref === 'string') {
          return lastHref;
        }
      }

      return null;
    };

    const nextUrl = getNext();
    if (!nextUrl) {
      return null;
    }

    const absoluteUrl = (this as any)._makeAbsolute(nextUrl);

    if (!fetch) {
      return absoluteUrl;
    }

    // Fetch the next page
    if (this._session && 'get' in this._session) {
      const response = await (this._session as TLSSession).get(absoluteUrl);
      return response.html;
    }

    return absoluteUrl;
  }

  /**
   * Add a next symbol to look for when paginating
   */
  addNextSymbol(symbol: string): void {
    this._nextSymbol.push(symbol);
  }

  /**
   * Async iterator for pagination
   */
  async *[Symbol.asyncIterator](): AsyncGenerator<HTML> {
    let current: HTML | null = this;

    while (current) {
      yield current;
      try {
        const next = await current.next({ fetch: true });
        current = next instanceof HTML ? next : null;
      } catch {
        break;
      }
    }
  }

  toString(): string {
    return `<HTML url=${JSON.stringify(this.url)}>`;
  }
}
