import koffi from 'koffi';
import { resolve, join, dirname } from 'node:path';
import { existsSync, mkdirSync, chmodSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { platform, arch } from 'node:os';
import { execSync } from 'node:child_process';
import { MissingLibraryException } from './exceptions.js';

const BRIDGE_VERSION = '3.1';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const BIN_DIR = resolve(__dirname, '..', 'bin');
const BRIDGE_SRC_DIR = resolve(__dirname, '..', 'bridge');

// Go String Struct Definition for FFI
const GoString = koffi.struct('GoString', {
  p: 'string',
  n: 'longlong' // Go's int is 64-bit on 64-bit systems. Use longlong to be safe for 64-bit targets which are the main ones.
});

export class BridgeManager {
  private binPath: string = '';
  private lib: any = null;
  private port: number = 0;
  private loadPromise: Promise<void> | null = null;

  constructor() {
    this.ensureBinDir();
    this.binPath = this.getBinPath();
  }

  private ensureBinDir() {
    if (!existsSync(BIN_DIR)) {
      mkdirSync(BIN_DIR, { recursive: true });
    }
  }

  private getPlatformArch(): { os: string; arch: string; ext: string } {
    const p = platform();
    const a = arch();

    let osStr = '';
    let ext = '';
    if (p === 'darwin') {
      osStr = 'darwin';
      ext = '.dylib';
    } else if (p === 'win32') {
      osStr = 'windows-4.0';
      ext = '.dll';
    } else {
      osStr = 'linux';
      ext = '.so';
    }

    const archMap: Record<string, string> = {
      'x64': 'amd64',
      'arm64': 'arm64',
      'ia32': '386',
      'arm': 'arm-7'
    };

    return { os: osStr, arch: archMap[a] || a, ext };
  }

  private getBinPath(): string {
    const { os, arch, ext } = this.getPlatformArch();
    return join(BIN_DIR, `hrequests-cgo-${BRIDGE_VERSION}-${os}-${arch}${ext}`);
  }

  async ensureBridge(): Promise<void> {
    if (existsSync(this.binPath)) return;

    if (!existsSync(join(BRIDGE_SRC_DIR, 'server.go'))) {
      throw new MissingLibraryException(
        'Go bridge source code not found in "bridge/" directory. Please ensure the repository is complete.'
      );
    }

    try {
      // Check if go is installed
      execSync('go version', { stdio: 'ignore' });
    } catch (e) {
      const p = platform();
      let installCmd = '';
      if (p === 'darwin') {
        installCmd = ' (brew install go)';
      } else if (p === 'linux') {
        installCmd = ' (sudo apt install golang)';
      } else if (p === 'win32') {
        installCmd = ' (winget install GoLang.Go)';
      }
      throw new MissingLibraryException(
        `Go 1.21+ is required to build the hrequests bridge. Please install it${installCmd} or visit https://go.dev/dl/`
      );
    }

    try {
      console.log('Building hrequests-cgo binary locally...');
      execSync(`go build -buildmode=c-shared -o "${this.binPath}" server.go`, {
        cwd: BRIDGE_SRC_DIR,
        stdio: 'inherit'
      });
    } catch (e) {
      throw new Error(
        `Failed to build hrequests bridge locally: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }

  async load(): Promise<void> {
    // Prevent multiple concurrent loads
    if (this.loadPromise) return this.loadPromise;

    this.loadPromise = (async () => {
      await this.ensureBridge();

      try {
        this.lib = koffi.load(this.binPath);
      } catch (e) {
        this.loadPromise = null;
        console.error("Failed to load library at", this.binPath);
        throw e;
      }

      // Bind functions
      const GetOpenPort = this.lib.func('GetOpenPort', 'int', []);
      const StartServer = this.lib.func('StartServer', 'void', [GoString]);
      const StopServer = this.lib.func('StopServer', 'void', []);
      const DestroySession = this.lib.func('DestroySession', 'void', [GoString]);
      const DestroyAll = this.lib.func('DestroyAll', 'void', []);

      this.lib.functions = {
        GetOpenPort,
        StartServer,
        StopServer,
        DestroySession,
        DestroyAll
      };

      // Start Server
      this.port = GetOpenPort();
      if (!this.port) {
        this.loadPromise = null;
        throw new Error("Could not find an open port from Bridge");
      }

      const portStr = String(this.port);
      StartServer({ p: portStr, n: portStr.length });

      console.log(`Bridge server started on port ${this.port}`);
    })();

    return this.loadPromise;
  }

  getPort(): number {
    return this.port;
  }

  stop() {
    if (this.lib && this.lib.functions) {
      this.lib.functions.StopServer();
      // koffi.unload(this.lib); // Koffi doesn't support full unload usually, but we can stop the server.
    }
  }

  destroySession(sessionId: string) {
    if (this.lib) {
      this.lib.functions.DestroySession({ p: sessionId, n: sessionId.length });
    }
  }
}

// Singleton instance
export const bridge = new BridgeManager();

