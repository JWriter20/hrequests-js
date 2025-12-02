import * as cheerio from 'cheerio';
import type { Element as CheerioElement } from 'domhandler';
import { type CheerioAPI, type Cheerio } from 'cheerio';

export class Element {
  private readonly $: CheerioAPI;
  private readonly element: Cheerio<CheerioElement>;

  constructor($: CheerioAPI, element: Cheerio<CheerioElement>) {
    this.$ = $;
    this.element = element;
  }

  get text(): string {
    return this.element.text();
  }

  get html(): string | null {
    return this.element.html();
  }

  get tagName(): string {
    return this.element.prop('tagName')?.toLowerCase() || '';
  }

  get attrs(): Record<string, string> {
    return this.element.attr() || {};
  }

  attr(name: string): string | undefined {
    return this.element.attr(name);
  }

  find(selector: string): Element | null {
    const found = this.element.find(selector).first();
    if (found.length === 0) return null;
    return new Element(this.$, found as Cheerio<CheerioElement>);
  }

  findAll(selector: string): Element[] {
    const found = this.element.find(selector);
    return found.map((_, el) => new Element(this.$, this.$(el) as Cheerio<CheerioElement>)).toArray();
  }
}

export class HTML {
  private readonly $: CheerioAPI;
  private readonly _url: string;
  private readonly _html: string;

  constructor(html: string, url: string = 'http://example.com') {
    this._html = html;
    this._url = url;
    this.$ = cheerio.load(html);
  }

  get url(): string {
    return this._url;
  }

  get html(): string {
    return this._html;
  }

  get text(): string {
    return this.$.text();
  }

  find(selector: string): Element | null {
    const found = this.$(selector).first();
    if (found.length === 0) return null;
    return new Element(this.$, found as Cheerio<CheerioElement>);
  }

  findAll(selector: string): Element[] {
    const found = this.$(selector);
    return found.map((_, el) => new Element(this.$, this.$(el) as Cheerio<CheerioElement>)).toArray();
  }
}

