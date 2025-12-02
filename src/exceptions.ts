/**
 * Exception hierarchy for hrequests-js
 * Mirrors the Python hrequests exceptions
 */

/** Error with the TLS client */
export class ClientException extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClientException';
  }
}

/** Base exceptions for render instances */
export class BrowserException extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BrowserException';
  }
}

/** Exception raised when mock human is disabled, but captcha is called */
export class EnableMockHumanException extends BrowserException {
  constructor(message: string = 'Mock human mode is not enabled') {
    super(message);
    this.name = 'EnableMockHumanException';
  }
}

/** Exception raised when playwright throws a timeout error */
export class BrowserTimeoutException extends BrowserException {
  constructor(message: string = 'Browser operation timed out') {
    super(message);
    this.name = 'BrowserTimeoutException';
  }
}

/** Raise when the user tries to interact with an element that is not in a BrowserSession */
export class NotRenderedException extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotRenderedException';
  }
}

/** Exception raised when a javascript error occurs */
export class JavascriptException extends BrowserException {
  constructor(message: string = 'Javascript eval exception') {
    super(message);
    this.name = 'JavascriptException';
  }
}

/** Tried to go back when cache was disabled */
export class CacheDisabledError extends BrowserException {
  constructor(message: string = 'When `enable_cache` is False, you cannot go back or forward.') {
    super(message);
    this.name = 'CacheDisabledError';
  }
}

/** Exception raised when a css selector is not found */
export class SelectorNotFoundException extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SelectorNotFoundException';
  }
}

/** Exception raised when no encoding is detected */
export class EncodingNotFoundException extends Error {
  constructor(message: string = 'Response does not have a valid encoding.') {
    super(message);
    this.name = 'EncodingNotFoundException';
  }
}

/** Exception raised when a proxy format is not supported */
export class ProxyFormatException extends ClientException {
  constructor(message: string) {
    super(message);
    this.name = 'ProxyFormatException';
  }
}

/** Exception raised when the browsing libraries are not installed */
export class MissingLibraryException extends ClientException {
  constructor(message: string = 'Required browsing libraries are not installed') {
    super(message);
    this.name = 'MissingLibraryException';
  }
}

