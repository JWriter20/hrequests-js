import { type Browser, type BrowserContext, type Page } from 'playwright';
import { Camoufox } from 'camoufox-js';
import { chromium as patchright } from 'patchright';
import { HTML } from './html.js';
import { Session } from './session.js';

export interface BrowserSessionOptions {
  headless?: boolean;
  mockHuman?: boolean;
  browser?: 'firefox' | 'chrome';
  // ... other options
}

export class BrowserSession {
  private browserInstance: any = null; // Use any to support both Playwright (Camoufox) and Patchright types
  private context: any = null;
  page: Page | null = null;

  constructor(private options: BrowserSessionOptions = {}) { }

  async init(): Promise<void> {
    const browserType = this.options.browser || 'firefox';
    const headless = this.options.headless ?? true;

    if (browserType === 'firefox') {
      const instance = await Camoufox({
        headless: headless,
      });

      if ('newContext' in instance) {
        this.browserInstance = instance;
        this.context = await this.browserInstance.newContext();
      } else {
        this.context = instance;
      }
    } else if (browserType === 'chrome') {
      // Use patchright for chrome
      this.browserInstance = await patchright.launch({
        headless: headless,
        args: [
          '--disable-blink-features=AutomationControlled'
        ]
      });
      this.context = await this.browserInstance.newContext();
    } else {
      throw new Error(`Unsupported browser: ${browserType}`);
    }

    if (this.context) {
      this.page = await this.context.newPage();
    }
  }

  async goto(url: string): Promise<void> {
    if (!this.page) await this.init();
    await this.page!.goto(url);
  }

  async close(): Promise<void> {
    if (this.context) await this.context.close();
    if (this.browserInstance) await this.browserInstance.close();
  }

  async delete(): Promise<void> {
    await this.close();
  }

  get html(): HTML {
    throw new Error("Use getHtml() in JS port or await response.text()");
  }

  async getHtml(): Promise<HTML> {
    if (!this.page) throw new Error("Page not initialized");
    const content = await this.page.content();
    const url = this.page.url();
    return new HTML(content, url);
  }

  async text(): Promise<string> {
    if (!this.page) throw new Error("Page not initialized");
    return await this.page.content();
  }

  async json(): Promise<unknown> {
    if (!this.page) throw new Error("Page not initialized");
    const content = await this.page.innerText('body');
    return JSON.parse(content);
  }

  async screenshot(path?: string): Promise<Buffer> {
    if (!this.page) throw new Error("Page not initialized");
    return await this.page.screenshot({ path });
  }

  async content(): Promise<string> {
    if (!this.page) throw new Error("Page not initialized");
    return await this.page.content();
  }

  async click(selector: string): Promise<void> {
    if (!this.page) throw new Error("Page not initialized");
    await this.page.click(selector);
  }

  async type(selector: string, text: string): Promise<void> {
    if (!this.page) throw new Error("Page not initialized");
    await this.page.type(selector, text);
  }

  async evaluate<T>(script: string | ((arg: any) => T), arg?: any): Promise<T> {
    if (!this.page) throw new Error("Page not initialized");
    return await this.page.evaluate(script, arg);
  }
}

export async function render(url: string, options: BrowserSessionOptions = {}): Promise<BrowserSession> {
  const session = new BrowserSession(options);
  await session.goto(url);
  return session;
}
