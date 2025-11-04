export interface SessionOptions {
  browser?: string;
  version?: number;
  proxy?: unknown;
  headers?: Record<string, string>;
  cookies?: Record<string, unknown>;
  timeout?: number;
  verify?: boolean;
  [key: string]: unknown;
}

export interface RenderOptions {
  headless?: boolean;
  mockHuman?: boolean;
  extensions?: string | string[];
  engine?: unknown;
  [key: string]: unknown;
}

export interface RequestOptions {
  method?: string;
  params?: Record<string, unknown>;
  headers?: Record<string, string>;
  data?: unknown;
  json?: unknown;
  files?: unknown;
  cookies?: Record<string, unknown>;
  timeout?: number;
  allowRedirects?: boolean;
  history?: boolean;
  proxy?: string;
  render?: boolean | RenderOptions;
  [key: string]: unknown;
}

export interface RequestArgs extends RequestOptions {
  sessionId?: string | null;
}

export interface ResponseMetadata {
  responseId: string;
  status: number;
  reason: string;
  ok: boolean;
  url: string;
  headers: Record<string, string>;
  cookies: Record<string, unknown>;
  elapsedMs: number | null;
  encoding: string | null;
  httpVersion: string | null;
  history: Array<{ status: number; url: string }>;
}

export interface ServiceConfig {
  host?: string;
  port?: number;
  pythonExecutable?: string;
  logLevel?: "critical" | "error" | "warning" | "info" | "debug" | "trace";
  startupTimeoutMs?: number;
  installDependencies?: boolean;
  extraEnv?: Record<string, string>;
}

export interface HResponse {
  readonly responseId: string;
  readonly status: number;
  readonly reason: string;
  readonly ok: boolean;
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly cookies: Record<string, unknown>;
  readonly elapsedMs: number | null;
  readonly encoding: string | null;
  readonly httpVersion: string | null;
  readonly history: Array<{ status: number; url: string }>;
  text(): Promise<string>;
  json<T = unknown>(): Promise<T>;
  stream(): Promise<NodeJS.ReadableStream>;
  saveToFile(destinationPath: string): Promise<void>;
  delete(): Promise<void>;
  metadata(): ResponseMetadata;
}
