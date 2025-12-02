/**
 * Async request utilities for hrequests-js
 * Mirrors the Python hrequests reqs module
 */

import { Session, TLSSession, firefox, type Method, type RequestOptions, type TLSSessionOptions } from './session.js';
import { Response, FailedResponse } from './response.js';

// Session kwargs that should be passed to session constructor, not request
const SESSION_KWARGS = new Set([
  'browser',
  'version',
  'os',
  'ja3String',
  'h2Settings',
  'additionalDecode',
  'pseudoHeaderOrder',
  'priorityFrames',
  'headerOrder',
  'forceHttp1',
  'catchPanics',
  'debug',
  'proxy',
  'proxies',
  'certificatePinning',
  'disableIpv6',
  'detectEncoding',
]);

export interface TLSRequestOptions extends RequestOptions {
  /** Raise exceptions on error */
  raiseException?: boolean;
  /** Callback called on response */
  callback?: (response: Response) => void;
}

/**
 * Asynchronous request class
 * Accepts the same parameters as TLSSession.request
 */
export class TLSRequest {
  readonly method: Method;
  readonly url: string;
  readonly raiseException: boolean;
  readonly kwargs: RequestOptions;

  session: TLSSession | null;
  response: Response | null = null;
  exception?: Error;
  traceback?: string;

  private _close: boolean;
  private sessKwargs?: Partial<TLSSessionOptions>;

  constructor(
    method: Method,
    url: string,
    options: TLSRequestOptions & Partial<TLSSessionOptions> = {},
    session?: TLSSession
  ) {
    this.method = method;
    this.raiseException = options.raiseException ?? true;
    this.url = url;

    // Separate session kwargs from request kwargs
    const { raiseException, callback, ...restOptions } = options;

    if (callback) {
      (restOptions as any).hooks = { response: callback };
    }

    // Extract session-only kwargs
    const sessKwargs: Partial<TLSSessionOptions> = {};
    const requestKwargs: RequestOptions = {};

    for (const [key, value] of Object.entries(restOptions)) {
      if (SESSION_KWARGS.has(key)) {
        if (session && value !== undefined) {
          throw new TypeError(`Cannot pass parameter(s) to an existing session: ${key}`);
        }
        (sessKwargs as any)[key] = value;
      } else {
        (requestKwargs as any)[key] = value;
      }
    }

    this.sessKwargs = Object.keys(sessKwargs).length > 0 ? sessKwargs : undefined;
    this.kwargs = requestKwargs;
    this.session = null;
    this._close = false;

    this._buildSession(session);
  }

  private _buildSession(session?: TLSSession): void {
    if (!session) {
      if (this.sessKwargs) {
        // Configure a new session with the session kwargs
        this.session = new Session({ temp: true, ...this.sessKwargs });
      } else {
        // Use a preconfigured firefox session
        this.session = firefox.Session({ temp: true });
      }
      this._close = true;
    } else {
      this.session = session;
      this._close = false;
    }
  }

  /**
   * Send the request
   */
  async send(additionalKwargs: RequestOptions = {}): Promise<TLSRequest> {
    const mergedKwargs = { ...this.kwargs, ...additionalKwargs };

    // Rebuild session if it was closed
    if (this.session === null) {
      this._buildSession();
    }

    try {
      this.response = await this.session!.request(this.method, this.url, mergedKwargs);
    } catch (e) {
      if (this.raiseException) {
        throw e;
      }
      this.exception = e as Error;
      this.traceback = (e as Error).stack;
    } finally {
      this.closeSession();
    }

    return this;
  }

  /**
   * Close the session if it was created by this request
   */
  closeSession(): void {
    if (this._close && this.session !== null) {
      this.session.close();
      this.session = null;
    }
  }
}

/**
 * Lazy TLS Request - sends the request immediately but doesn't wait for response
 * until an attribute is accessed
 */
export class LazyTLSRequest {
  private request: TLSRequest;
  private _promise: Promise<TLSRequest>;
  private _complete: boolean = false;

  constructor(
    method: Method,
    url: string,
    options: TLSRequestOptions & Partial<TLSSessionOptions> = {},
    session?: TLSSession
  ) {
    this.request = new TLSRequest(method, url, { ...options, raiseException: false }, session);
    this._promise = this._send();
  }

  private async _send(): Promise<TLSRequest> {
    await this.request.send();
    this._complete = true;
    return this.request;
  }

  /**
   * Wait for the request to complete
   */
  async join(): Promise<void> {
    await this._promise;
  }

  /**
   * Check if the request is complete
   */
  get complete(): boolean {
    return this._complete;
  }

  /**
   * Get the response (waits if not complete)
   */
  async getResponse(): Promise<Response | null> {
    await this.join();
    return this.request.response;
  }

  /**
   * Get any exception that occurred
   */
  async getException(): Promise<Error | undefined> {
    await this.join();
    return this.request.exception;
  }

  toString(): string {
    if (this._complete && this.request.response) {
      return this.request.response.toString();
    }
    return '<LazyResponse[Pending]>';
  }
}

/**
 * Create an unsent request for use with map/imap
 */
export function asyncRequest(
  method: Method,
  url: string,
  options: TLSRequestOptions & Partial<TLSSessionOptions> = {}
): TLSRequest {
  return new TLSRequest(method, url, { ...options, raiseException: false });
}

// Async request shortcuts
export const asyncGet = (url: string, options?: TLSRequestOptions & Partial<TLSSessionOptions>) =>
  asyncRequest('GET', url, options);
export const asyncPost = (url: string, options?: TLSRequestOptions & Partial<TLSSessionOptions>) =>
  asyncRequest('POST', url, options);
export const asyncPut = (url: string, options?: TLSRequestOptions & Partial<TLSSessionOptions>) =>
  asyncRequest('PUT', url, options);
export const asyncPatch = (url: string, options?: TLSRequestOptions & Partial<TLSSessionOptions>) =>
  asyncRequest('PATCH', url, options);
export const asyncDelete = (url: string, options?: TLSRequestOptions & Partial<TLSSessionOptions>) =>
  asyncRequest('DELETE', url, options);
export const asyncHead = (url: string, options?: TLSRequestOptions & Partial<TLSSessionOptions>) =>
  asyncRequest('HEAD', url, options);
export const asyncOptions = (url: string, options?: TLSRequestOptions & Partial<TLSSessionOptions>) =>
  asyncRequest('OPTIONS', url, options);

/**
 * Send a request (sync-style API that returns a promise)
 */
export async function request(
  method: Method,
  url: string | string[],
  options: TLSRequestOptions & Partial<TLSSessionOptions> & { nohup?: boolean } = {}
): Promise<Response | (Response | FailedResponse)[] | LazyTLSRequest | LazyTLSRequest[]> {
  // If a list of URLs is passed, send requests concurrently
  if (Array.isArray(url)) {
    return requestList(method, url, options);
  }

  // If nohup is true, return a LazyTLSRequest
  if (options.nohup) {
    return new LazyTLSRequest(method, url, options);
  }

  const req = new TLSRequest(method, url, options);
  await req.send();
  return req.response!;
}

/**
 * Concurrently send requests given a list of URLs
 */
async function requestList(
  method: Method,
  urls: string[],
  options: TLSRequestOptions & Partial<TLSSessionOptions> & { nohup?: boolean } = {}
): Promise<(Response | FailedResponse)[] | LazyTLSRequest[]> {
  const { nohup, ...restOptions } = options;

  if (nohup) {
    // Return a list of LazyTLSRequests
    return urls.map(url => new LazyTLSRequest(method, url, { ...restOptions, raiseException: false }));
  }

  // Send requests concurrently
  const requests = urls.map(url => asyncRequest(method, url, restOptions));
  return map(requests);
}

// Request shortcuts
export const get = (url: string | string[], options?: TLSRequestOptions & Partial<TLSSessionOptions> & { nohup?: boolean }) =>
  request('GET', url, options);
export const post = (url: string | string[], options?: TLSRequestOptions & Partial<TLSSessionOptions> & { nohup?: boolean }) =>
  request('POST', url, options);
export const put = (url: string | string[], options?: TLSRequestOptions & Partial<TLSSessionOptions> & { nohup?: boolean }) =>
  request('PUT', url, options);
export const patch = (url: string | string[], options?: TLSRequestOptions & Partial<TLSSessionOptions> & { nohup?: boolean }) =>
  request('PATCH', url, options);
export const del = (url: string | string[], options?: TLSRequestOptions & Partial<TLSSessionOptions> & { nohup?: boolean }) =>
  request('DELETE', url, options);
export const head = (url: string | string[], options?: TLSRequestOptions & Partial<TLSSessionOptions> & { nohup?: boolean }) =>
  request('HEAD', url, options);
export const optionsReq = (url: string | string[], options?: TLSRequestOptions & Partial<TLSSessionOptions> & { nohup?: boolean }) =>
  request('OPTIONS', url, options);

/**
 * Concurrently converts a list of Requests to Responses
 */
export async function map(
  requests: TLSRequest[],
  options: {
    size?: number;
    exceptionHandler?: (request: TLSRequest, exception: Error) => Response | null;
  } = {}
): Promise<(Response | FailedResponse)[]> {
  const { size, exceptionHandler } = options;
  const allResponses: (Response | FailedResponse)[] = [];
  const requestList = [...requests];

  // Default increment size to total if not specified
  const batchSize = size || requestList.length;

  for (let i = 0; i < requestList.length; i += batchSize) {
    const batch = requestList.slice(i, Math.min(i + batchSize, requestList.length));

    // Send all requests in batch concurrently
    const promises = batch.map(async (req) => {
      // Build session if needed
      if (req.session === null) {
        (req as any)._buildSession();
      }

      try {
        await req.send();
        return req.response;
      } catch (e) {
        const error = e as Error;
        if (req.raiseException) {
          throw error;
        }

        if (exceptionHandler) {
          return exceptionHandler(req, error);
        }

        return new FailedResponse(error);
      } finally {
        req.closeSession();
      }
    });

    const results = await Promise.all(promises);
    allResponses.push(...(results.filter(r => r !== null) as (Response | FailedResponse)[]));
  }

  return allResponses;
}

/**
 * Async generator that yields responses as they complete
 */
export async function* imap(
  requests: TLSRequest[],
  options: {
    size?: number;
    enumerate?: boolean;
    exceptionHandler?: (request: TLSRequest, exception: Error) => Response | null;
  } = {}
): AsyncGenerator<Response | FailedResponse | [number, Response | FailedResponse | null]> {
  const { size = 2, enumerate = false, exceptionHandler } = options;

  if (enumerate) {
    yield* imapEnum(requests, { size, exceptionHandler });
    return;
  }

  // Create a pool of concurrent requests
  const pending: Promise<{ request: TLSRequest; response: Response | FailedResponse | null }>[] = [];
  let index = 0;

  const processRequest = async (req: TLSRequest) => {
    if (req.session === null) {
      (req as any)._buildSession();
    }

    try {
      await req.send();
      return { request: req, response: req.response };
    } catch (e) {
      const error = e as Error;
      if (exceptionHandler) {
        const result = exceptionHandler(req, error);
        return { request: req, response: result };
      }
      return { request: req, response: new FailedResponse(error) };
    } finally {
      req.closeSession();
    }
  };

  // Start initial batch
  while (index < requests.length && pending.length < size) {
    pending.push(processRequest(requests[index++]));
  }

  // Process as they complete
  while (pending.length > 0) {
    const result = await Promise.race(pending.map((p, i) => p.then(r => ({ ...r, index: i }))));
    pending.splice(result.index, 1);

    if (result.response !== null) {
      yield result.response;
    }

    // Add more requests if available
    if (index < requests.length) {
      pending.push(processRequest(requests[index++]));
    }
  }
}

/**
 * Like imap, but yields tuple of original request index and response
 */
export async function* imapEnum(
  requests: TLSRequest[],
  options: {
    size?: number;
    exceptionHandler?: (request: TLSRequest, exception: Error) => Response | null;
  } = {}
): AsyncGenerator<[number, Response | FailedResponse | null]> {
  const { size = 2, exceptionHandler } = options;

  // Add index to each request
  const indexedRequests = requests.map((req, i) => ({ req, originalIndex: i }));

  const pending: Promise<{ originalIndex: number; response: Response | FailedResponse | null; promiseIndex: number }>[] = [];
  let index = 0;

  const processRequest = async (item: { req: TLSRequest; originalIndex: number }, promiseIndex: number) => {
    const { req, originalIndex } = item;

    if (req.session === null) {
      (req as any)._buildSession();
    }

    try {
      await req.send();
      return { originalIndex, response: req.response, promiseIndex };
    } catch (e) {
      const error = e as Error;
      if (exceptionHandler) {
        const result = exceptionHandler(req, error);
        return { originalIndex, response: result, promiseIndex };
      }
      return { originalIndex, response: new FailedResponse(error), promiseIndex };
    } finally {
      req.closeSession();
    }
  };

  // Start initial batch
  while (index < indexedRequests.length && pending.length < size) {
    pending.push(processRequest(indexedRequests[index], pending.length));
    index++;
  }

  // Process as they complete
  while (pending.length > 0) {
    const result = await Promise.race(pending);

    // Remove the completed promise
    const completedIndex = pending.findIndex(async (p) => {
      const r = await p;
      return r.promiseIndex === result.promiseIndex;
    });
    if (completedIndex !== -1) {
      pending.splice(completedIndex, 1);
    }

    yield [result.originalIndex, result.response];

    // Add more requests if available
    if (index < indexedRequests.length) {
      pending.push(processRequest(indexedRequests[index], pending.length));
      index++;
    }
  }
}

