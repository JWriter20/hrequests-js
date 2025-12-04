/**
 * Fingerprint generation and injection for hrequests-js
 * Uses fingerprint-suite from Apify (https://github.com/apify/fingerprint-suite)
 * This is the JavaScript equivalent of Python's browserforge
 */

import type { BrowserContext, Page } from 'playwright';
// Type-only imports are erased at compile time - no runtime loading
import type { FingerprintGenerator } from 'fingerprint-generator';
import type { FingerprintInjector } from 'fingerprint-injector';

export type BrowserName = 'firefox' | 'chrome';
export type OSName = 'windows' | 'macos' | 'linux';
export type DeviceType = 'desktop' | 'mobile';

export interface FingerprintOptions {
  browsers?: BrowserName[];
  operatingSystems?: OSName[];
  devices?: DeviceType[];
  locales?: string[];
  minVersion?: number;
  maxVersion?: number;
}

export interface GeneratedFingerprint {
  fingerprint: any;
  headers: Record<string, string>;
  userAgent: string;
}

// Cached constructor references for lazy loading (actual runtime imports)
let _FingerprintGeneratorCtor: typeof FingerprintGenerator | null = null;
let _FingerprintInjectorCtor: typeof FingerprintInjector | null = null;

async function loadFingerprintGenerator(): Promise<typeof FingerprintGenerator> {
  if (!_FingerprintGeneratorCtor) {
    const mod = await import('fingerprint-generator');
    _FingerprintGeneratorCtor = mod.FingerprintGenerator;
  }
  return _FingerprintGeneratorCtor;
}

async function loadFingerprintInjector(): Promise<typeof FingerprintInjector> {
  if (!_FingerprintInjectorCtor) {
    const mod = await import('fingerprint-injector');
    _FingerprintInjectorCtor = mod.FingerprintInjector;
  }
  return _FingerprintInjectorCtor;
}

/**
 * Browser fingerprint generator
 * Generates realistic browser fingerprints for anti-detection
 */
export class BrowserFingerprint {
  private generator: FingerprintGenerator | null = null;
  private injector: FingerprintInjector | null = null;
  private _initPromise: Promise<void> | null = null;

  private async ensureInitialized(): Promise<void> {
    if (this.generator && this.injector) return;

    if (!this._initPromise) {
      this._initPromise = (async () => {
        const [GeneratorCtor, InjectorCtor] = await Promise.all([
          loadFingerprintGenerator(),
          loadFingerprintInjector(),
        ]);
        this.generator = new GeneratorCtor();
        this.injector = new InjectorCtor();
      })();
    }

    await this._initPromise;
  }

  /**
   * Generate a fingerprint with the given options
   */
  async generate(options: FingerprintOptions = {}): Promise<GeneratedFingerprint> {
    await this.ensureInitialized();

    const browserSpec: Record<string, unknown> = {};

    if (options.browsers) {
      browserSpec.browsers = options.browsers;
    }
    if (options.operatingSystems) {
      browserSpec.operatingSystems = options.operatingSystems;
    }
    if (options.devices) {
      browserSpec.devices = options.devices;
    }
    if (options.minVersion !== undefined) {
      browserSpec.minVersion = options.minVersion;
    }
    if (options.maxVersion !== undefined) {
      browserSpec.maxVersion = options.maxVersion;
    }

    const result = this.generator!.getFingerprint(browserSpec as any);
    const fingerprint = result.fingerprint || result;
    const headers = result.headers || {};

    return {
      fingerprint,
      headers,
      userAgent: headers['user-agent'] || (fingerprint as any).navigator?.userAgent || '',
    };
  }

  /**
   * Generate a fingerprint for a specific browser
   */
  async generateForBrowser(
    browser: BrowserName,
    os?: OSName,
    version?: number
  ): Promise<GeneratedFingerprint> {
    const options: FingerprintOptions = {
      browsers: [browser],
      devices: ['desktop'],
    };

    if (os) {
      options.operatingSystems = [os];
    }

    if (version) {
      options.minVersion = version;
      options.maxVersion = version + 10; // Allow some version range
    }

    return this.generate(options);
  }

  /**
   * Inject fingerprint into a Playwright browser context
   */
  async injectContext(context: BrowserContext, fingerprint?: GeneratedFingerprint): Promise<void> {
    await this.ensureInitialized();
    const fp = fingerprint || await this.generate();
    await this.injector!.attachFingerprintToPlaywright(context, {
      fingerprint: fp.fingerprint,
      headers: fp.headers,
    });
  }

  /**
   * Inject fingerprint into a Playwright page
   */
  async injectPage(page: Page, fingerprint?: GeneratedFingerprint): Promise<void> {
    const fp = fingerprint || await this.generate();

    // Set extra HTTP headers
    await page.setExtraHTTPHeaders(fp.headers);

    // Inject fingerprint via evaluate
    await page.addInitScript((fpData) => {
      // Override navigator properties
      if (fpData.navigator) {
        for (const [key, value] of Object.entries(fpData.navigator)) {
          try {
            Object.defineProperty(navigator, key, {
              get: () => value,
              configurable: true,
            });
          } catch {
            // Some properties can't be overridden
          }
        }
      }

      // Override screen properties
      if (fpData.screen) {
        for (const [key, value] of Object.entries(fpData.screen)) {
          try {
            Object.defineProperty(screen, key, {
              get: () => value,
              configurable: true,
            });
          } catch {
            // Some properties can't be overridden
          }
        }
      }
    }, fp.fingerprint);
  }
}

// Lazy singleton instance - avoids loading Bayesian network JSON at module load time
let _fingerprint: BrowserFingerprint | null = null;

export function getFingerprint(): BrowserFingerprint {
  if (!_fingerprint) {
    _fingerprint = new BrowserFingerprint();
  }
  return _fingerprint;
}

// For backwards compatibility - lazy proxy that defers instantiation until first access
// Note: Methods are now async, so callers should await the results
export const fingerprint: BrowserFingerprint = new Proxy({} as BrowserFingerprint, {
  get(_, prop: keyof BrowserFingerprint) {
    return (getFingerprint() as any)[prop];
  },
});

/**
 * Generate headers for a specific browser configuration
 * Compatible with Python hrequests generate_headers function
 */
export async function generateHeaders(
  browser: BrowserName,
  options: {
    version?: number;
    os?: OSName;
    locales?: string[];
  } = {}
): Promise<Record<string, string>> {
  const fp = await fingerprint.generateForBrowser(
    browser,
    options.os,
    options.version
  );
  return fp.headers;
}

/**
 * Get the major version from a User-Agent string
 */
export function getMajorVersion(headers: Record<string, string>): number | undefined {
  const userAgent = headers['User-Agent'] || headers['user-agent'];
  if (!userAgent) return undefined;

  // Try to extract Chrome version
  const chromeMatch = userAgent.match(/Chrome\/(\d+)/);
  if (chromeMatch) return parseInt(chromeMatch[1], 10);

  // Try to extract Firefox version
  const firefoxMatch = userAgent.match(/Firefox\/(\d+)/);
  if (firefoxMatch) return parseInt(firefoxMatch[1], 10);

  // Try to extract Safari version
  const safariMatch = userAgent.match(/Version\/(\d+)/);
  if (safariMatch) return parseInt(safariMatch[1], 10);

  return undefined;
}

/**
 * Map short OS names to full names
 */
export const OS_MAP: Record<string, OSName> = {
  'win': 'windows',
  'mac': 'macos',
  'lin': 'linux',
};

/**
 * Supported browser versions (matching Python hrequests)
 */
export const BROWSER_VERSIONS = {
  firefox: [102, 104, 105, 106, 108, 110, 117, 120, 123, 132] as const,
  chrome: [103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 117, 120, 124, 131] as const,
};

/**
 * Get the TLS version identifier for a browser version
 */
export function getTlsVersion(browser: BrowserName, version: number): number {
  const versions = BROWSER_VERSIONS[browser];
  // Find the minimum corresponding TLS version
  for (let i = versions.length - 1; i >= 0; i--) {
    if (version >= versions[i]) {
      return versions[i];
    }
  }
  throw new Error(`No supported TLS version found for ${browser}: ${version}`);
}

/**
 * Get the latest supported version for a browser
 */
export function getLatestVersion(browser: BrowserName): number {
  const versions = BROWSER_VERSIONS[browser];
  return versions[versions.length - 1];
}

