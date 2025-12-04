/**
 * Browser module for hrequests-js
 * Mirrors hrequests/browser/__init__.py
 */

export { BrowserSession, render } from './browser.js';
export { Proxy } from './proxy.js';
export {
  BrowserFingerprint,
  fingerprint,
  getFingerprint,
  generateHeaders,
  getMajorVersion,
  getTlsVersion,
  getLatestVersion,
  OS_MAP,
  BROWSER_VERSIONS,
} from './fingerprint.js';

export type { BrowserSessionOptions, BrowserType } from './browser.js';
export type {
  FingerprintOptions,
  GeneratedFingerprint,
  BrowserName,
  OSName,
  DeviceType,
} from './fingerprint.js';
