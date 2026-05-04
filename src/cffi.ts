import koffi from 'koffi';
import { createRequire } from 'node:module';
import { platform, arch } from 'node:os';
import { MissingLibraryException } from './exceptions.js';

const require = createRequire(import.meta.url);

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

  private resolveBinPath(): string {
    // Node reports Windows as "win32" but the npm package is "windows" —
    // npm's spam-detection heuristic blocks the literal "win32" token.
    const osKey = platform() === 'win32' ? 'windows' : platform();
    const pkgName = `hrequests-${osKey}-${arch()}`;
    try {
      return require.resolve(pkgName);
    } catch {
      throw new MissingLibraryException(
        `Could not find prebuilt bridge for ${platform()}-${arch()}. ` +
        `The optional dependency "${pkgName}" was not installed. ` +
        `If you ran "npm install --no-optional" or "--ignore-scripts", retry without those flags. ` +
        `If your platform isn't supported, file an issue at https://github.com/JWriter20/hrequests-js/issues.`
      );
    }
  }

  async load(): Promise<void> {
    // Prevent multiple concurrent loads
    if (this.loadPromise) return this.loadPromise;

    this.loadPromise = (async () => {
      this.binPath = this.resolveBinPath();

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
