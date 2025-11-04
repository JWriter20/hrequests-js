import { spawn, spawnSync, type ChildProcess, type SpawnOptionsWithoutStdio } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { dirname, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { ReadableStream as NodeReadableStream } from "node:stream/web";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { fetch, type Response } from "undici";

import { ResponseHandle } from "./responseHandle.js";
import type { HResponse, RequestOptions, ResponseMetadata, ServiceConfig, SessionOptions } from "./types.js";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 39231;
const DEFAULT_STARTUP_TIMEOUT_MS = 20_000;
const HEALTH_ENDPOINT = "/health";
const SESSION_ENDPOINT = "/sessions";
const REQUEST_ENDPOINT = "/requests";
const RESPONSES_ENDPOINT = "/responses";
const SHUTDOWN_ENDPOINT = "/shutdown";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, "..");
const PYTHON_SERVICE_PATH = resolve(PROJECT_ROOT, "python_service", "main.py");
const REQUIREMENTS_PATH = resolve(PROJECT_ROOT, "python_service", "requirements.txt");
const CACHE_DIR = resolve(PROJECT_ROOT, "python_service", ".hrequests-cache");
const VENV_DIR = resolve(CACHE_DIR, "venv");
const VENV_PYTHON_PATH = process.platform === "win32"
  ? resolve(VENV_DIR, "Scripts", "python.exe")
  : resolve(VENV_DIR, "bin", "python");
const SETUP_MARKER_PATH = resolve(CACHE_DIR, "setup.json");

interface SetupMarkerData {
  requirementsHash: string | null;
  installedAt: string;
  pythonPath?: string | null;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function readJsonFile<T>(path: string): Promise<T | null> {
  try {
    const data = await readFile(path, "utf8");
    return JSON.parse(data) as T;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function writeJsonFile<T>(path: string, payload: T): Promise<void> {
  await writeFile(path, JSON.stringify(payload, null, 2), "utf8");
}

async function computeFileHash(path: string): Promise<string | null> {
  try {
    const data = await readFile(path);
    return createHash("sha256").update(data).digest("hex");
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export class HRequestsServiceManager {
  private readonly host: string;
  private readonly port: number;
  private readonly logLevel: string;
  private readonly startupTimeoutMs: number;
  private readonly installDependencies: boolean;
  private readonly extraEnv: Record<string, string>;
  private serviceProcess: ChildProcess | null = null;
  private readyPromise: Promise<void> | null = null;
  private shuttingDown = false;
  private exitHandlersRegistered = false;
  private pythonExecutable: string | null = null;
  private basePythonExecutable: string | null = null;

  constructor(private readonly config: ServiceConfig = {}) {
    this.host = config.host ?? DEFAULT_HOST;
    this.port = config.port ?? DEFAULT_PORT;
    this.logLevel = config.logLevel ?? "info";
    this.startupTimeoutMs = config.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS;
    this.installDependencies = config.installDependencies ?? true;
    this.extraEnv = config.extraEnv ?? {};
  }

  get baseUrl(): string {
    return `http://${this.host}:${this.port}`;
  }

  async ensureService(): Promise<void> {
    if (await this.isHealthy()) {
      return;
    }

    if (this.readyPromise) {
      return this.readyPromise;
    }

    this.readyPromise = this.startService();
    try {
      await this.readyPromise;
    } finally {
      this.readyPromise = null;
    }
  }

  async createSession(options: SessionOptions = {}): Promise<string> {
    await this.ensureService();
    const response = await fetch(`${this.baseUrl}${SESSION_ENDPOINT}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(options),
    });

    if (!response.ok) {
      await this.raiseServiceError("create session", response);
    }

    const json = (await response.json()) as { sessionId: string };
    return json.sessionId;
  }

  async closeSession(sessionId: string): Promise<void> {
    await this.ensureService();
    const response = await fetch(`${this.baseUrl}${SESSION_ENDPOINT}/${sessionId}`, {
      method: "DELETE",
    });

    if (!response.ok) {
      await this.raiseServiceError("delete session", response);
    }
  }

  async sendRequest(url: string, options: RequestOptions = {}, sessionId?: string | null): Promise<ResponseMetadata> {
    await this.ensureService();
    const { method = "get", ...rest } = options;
    const payload: Record<string, unknown> = { method, url, ...rest };
    if (sessionId) {
      payload.sessionId = sessionId;
    }

    const response = await fetch(`${this.baseUrl}${REQUEST_ENDPOINT}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      await this.raiseServiceError("execute request", response);
    }

    return (await response.json()) as ResponseMetadata;
  }

  async getResponseText(responseId: string): Promise<string> {
    await this.ensureService();
    const response = await fetch(`${this.baseUrl}${RESPONSES_ENDPOINT}/${responseId}/text`);
    if (!response.ok) {
      await this.raiseServiceError("read response text", response);
    }
    return await response.text();
  }

  async getResponseJson<T = unknown>(responseId: string): Promise<T> {
    await this.ensureService();
    const response = await fetch(`${this.baseUrl}${RESPONSES_ENDPOINT}/${responseId}/json`);
    if (!response.ok) {
      await this.raiseServiceError("read response json", response);
    }
    return (await response.json()) as T;
  }

  async streamResponseContent(responseId: string): Promise<Readable> {
    await this.ensureService();
    const response = await fetch(`${this.baseUrl}${RESPONSES_ENDPOINT}/${responseId}/content`);
    if (!response.ok) {
      await this.raiseServiceError("stream response content", response);
    }
    if (!response.body) {
      throw new Error("Response body stream is unavailable");
    }
    return Readable.fromWeb(response.body as unknown as NodeReadableStream<Uint8Array>);
  }

  async saveResponseContent(responseId: string, destinationPath: string): Promise<void> {
    const readable = await this.streamResponseContent(responseId);
    await pipeline(readable, createWriteStream(destinationPath));
  }

  async deleteResponse(responseId: string): Promise<void> {
    await this.ensureService();
    const response = await fetch(`${this.baseUrl}${RESPONSES_ENDPOINT}/${responseId}`, {
      method: "DELETE",
    });

    if (!response.ok) {
      await this.raiseServiceError("delete response", response);
    }
  }

  async request(
    method: string,
    url: string,
    options: RequestOptions = {},
    sessionId?: string | null,
  ): Promise<ResponseHandle> {
    const metadata = await this.sendRequest(url, { ...options, method }, sessionId);
    return new ResponseHandle(this, metadata);
  }

  async get(url: string, options: RequestOptions = {}, sessionId?: string | null): Promise<HResponse> {
    return await this.request("get", url, options, sessionId);
  }

  async post(url: string, options: RequestOptions = {}, sessionId?: string | null): Promise<HResponse> {
    return await this.request("post", url, options, sessionId);
  }

  async put(url: string, options: RequestOptions = {}, sessionId?: string | null): Promise<HResponse> {
    return await this.request("put", url, options, sessionId);
  }

  async patch(url: string, options: RequestOptions = {}, sessionId?: string | null): Promise<HResponse> {
    return await this.request("patch", url, options, sessionId);
  }

  async delete(url: string, options: RequestOptions = {}, sessionId?: string | null): Promise<HResponse> {
    return await this.request("delete", url, options, sessionId);
  }

  async head(url: string, options: RequestOptions = {}, sessionId?: string | null): Promise<HResponse> {
    return await this.request("head", url, options, sessionId);
  }

  async options(url: string, options: RequestOptions = {}, sessionId?: string | null): Promise<HResponse> {
    return await this.request("options", url, options, sessionId);
  }

  async shutdown(): Promise<void> {
    if (this.shuttingDown) {
      return;
    }

    this.shuttingDown = true;
    try {
      if (await this.isHealthy()) {
        await fetch(`${this.baseUrl}${SHUTDOWN_ENDPOINT}`, { method: "POST" }).catch(() => undefined);
        await delay(200);
      }
    } finally {
      if (this.serviceProcess) {
        this.serviceProcess.kill();
        this.serviceProcess = null;
      }
      this.shuttingDown = false;
    }
  }

  private async startService(): Promise<void> {
    if (!(await fileExists(PYTHON_SERVICE_PATH))) {
      throw new Error(`Missing Python service entry point at ${PYTHON_SERVICE_PATH}`);
    }

    if (!this.exitHandlersRegistered) {
      this.registerExitHandlers();
    }

    const python = await this.getOrPreparePythonExecutable();
    await this.spawnServiceProcess(python);
    await this.waitForHealth();
  }

  private async getOrPreparePythonExecutable(): Promise<string> {
    const basePython = await this.resolvePythonExecutable();
    const runtimePython = await this.ensureDependencyInstallation(basePython);
    this.pythonExecutable = runtimePython;
    return runtimePython;
  }

  private async resolvePythonExecutable(): Promise<string> {
    const override = this.config.pythonExecutable ?? process.env.HREQUESTS_PYTHON;
    if (override) {
      return override;
    }

    if (this.basePythonExecutable) {
      return this.basePythonExecutable;
    }

    for (const candidate of ["python3", "python"]) {
      const result = spawnSync(candidate, ["--version"], { stdio: "ignore" });
      if (result.status === 0) {
        this.basePythonExecutable = candidate;
        return candidate;
      }
    }

    throw new Error("Unable to locate a Python interpreter. Set config.pythonExecutable or HREQUESTS_PYTHON.");
  }

  private async ensureDependencyInstallation(basePython: string): Promise<string> {
    await mkdir(CACHE_DIR, { recursive: true });

    const overrideProvided = Boolean(this.config.pythonExecutable ?? process.env.HREQUESTS_PYTHON);
    let pythonToUse = basePython;

    if (!overrideProvided) {
      pythonToUse = await this.ensureVirtualEnv(basePython);
    }

    if (!this.installDependencies) {
      return pythonToUse;
    }

    if (!(await fileExists(REQUIREMENTS_PATH))) {
      throw new Error(`Missing Python requirements file at ${REQUIREMENTS_PATH}`);
    }

    const requirementsHash = await computeFileHash(REQUIREMENTS_PATH);
    const marker = await readJsonFile<SetupMarkerData>(SETUP_MARKER_PATH);
    const needsInstall =
      !marker || marker.requirementsHash !== requirementsHash || marker.pythonPath !== pythonToUse;

    if (needsInstall) {
      await this.runCommand(pythonToUse, ["-m", "pip", "install", "--upgrade", "pip"], {
        cwd: PROJECT_ROOT,
      });
      await this.runCommand(pythonToUse, ["-m", "pip", "install", "-U", "-r", REQUIREMENTS_PATH], {
        cwd: PROJECT_ROOT,
      });

      // Some features in hrequests require the post-install bootstrap step.
      await this.runCommand(pythonToUse, ["-m", "hrequests", "install"], { cwd: PROJECT_ROOT });

      const payload: SetupMarkerData = {
        requirementsHash,
        installedAt: new Date().toISOString(),
        pythonPath: pythonToUse,
      };
      await writeJsonFile(SETUP_MARKER_PATH, payload);
    }

    return pythonToUse;
  }

  private async ensureVirtualEnv(basePython: string): Promise<string> {
    if (!(await fileExists(VENV_PYTHON_PATH))) {
      await this.runCommand(basePython, ["-m", "venv", VENV_DIR], { cwd: PROJECT_ROOT });
    }
    return VENV_PYTHON_PATH;
  }

  private async spawnServiceProcess(python: string): Promise<void> {
    if (this.serviceProcess) {
      return;
    }

    const args = [
      PYTHON_SERVICE_PATH,
      "--host",
      this.host,
      "--port",
      String(this.port),
      "--log-level",
      this.logLevel,
    ];

    const env = {
      ...process.env,
      PYTHONUNBUFFERED: "1",
      ...this.extraEnv,
    };

    const child = spawn(python, args, {
      cwd: PROJECT_ROOT,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout?.on("data", (chunk) => {
      const message = chunk.toString();
      if (message.trim()) {
        console.log(`[hrequests] ${message.trimEnd()}`);
      }
    });

    child.stderr?.on("data", (chunk) => {
      const message = chunk.toString();
      if (message.trim()) {
        console.error(`[hrequests:error] ${message.trimEnd()}`);
      }
    });

    child.on("exit", (code, signal) => {
      this.serviceProcess = null;
      if (!this.shuttingDown) {
        const suffix = code !== null ? `code ${code}` : `signal ${signal}`;
        console.warn(`hrequests Python service exited unexpectedly (${suffix}).`);
      }
    });

    child.on("error", (error) => {
      console.error("Failed to start hrequests Python service", error);
    });

    this.serviceProcess = child;
  }

  private async waitForHealth(): Promise<void> {
    const deadline = Date.now() + this.startupTimeoutMs;
    const healthUrl = `${this.baseUrl}${HEALTH_ENDPOINT}`;
    let attempt = 0;

    while (Date.now() < deadline) {
      attempt += 1;
      if (await this.ping(healthUrl)) {
        return;
      }
      await delay(Math.min(500, 50 * attempt));
    }

    throw new Error(`Timed out waiting for hrequests service to become ready at ${healthUrl}`);
  }

  private async ping(url: string): Promise<boolean> {
    try {
      const response = await fetch(url, { method: "GET" });
      return response.ok;
    } catch {
      return false;
    }
  }

  private async isHealthy(): Promise<boolean> {
    return await this.ping(`${this.baseUrl}${HEALTH_ENDPOINT}`);
  }

  private async raiseServiceError(action: string, response: Response): Promise<never> {
    let body: unknown = null;
    const text = await response.text().catch(() => "");
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    throw new Error(
      `Failed to ${action}: ${response.status} ${response.statusText} - ${typeof body === "string" ? body : JSON.stringify(body)}`,
    );
  }

  private runCommand(command: string, args: string[], options: SpawnOptionsWithoutStdio = {}): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        stdio: "inherit",
        ...options,
      });

      child.on("error", (error) => reject(error));
      child.on("exit", (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`${command} exited with code ${code}`));
        }
      });
    });
  }

  private registerExitHandlers(): void {
    const teardown = (): void => {
      if (this.serviceProcess) {
        this.serviceProcess.kill();
        this.serviceProcess = null;
      }
    };

    process.on("exit", () => {
      teardown();
    });
    process.on("SIGINT", () => {
      teardown();
      process.exit(0);
    });
    process.on("SIGTERM", () => {
      teardown();
      process.exit(0);
    });

    this.exitHandlersRegistered = true;
  }
}
