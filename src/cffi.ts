import koffi from 'koffi';
import { resolve, join, dirname } from 'node:path';
import { existsSync, mkdirSync, chmodSync, createWriteStream, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { fetch } from 'undici';
import { platform, arch } from 'node:os';

const BRIDGE_VERSION = '3.1';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const BIN_DIR = resolve(__dirname, '..', 'bin');

// Go String Struct Definition for FFI
const GoString = koffi.struct('GoString', {
  p: 'string',
  n: 'longlong' // Go's int is 64-bit on 64-bit systems. Use longlong to be safe for 64-bit targets which are the main ones.
});

export class BridgeManager {
  private binPath: string = '';
  private lib: any = null;
  private port: number = 0;

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
    // Use the exact naming convention from Python hrequests to match release assets
    // But we can simplify the local name if we want, or keep it same.
    // Let's resolve the full name dynamically if needed, but for checking existence:
    // We will check for any file starting with hrequests-cgo-{BRIDGE_VERSION} and matching arch/os.
    // But simplest is to just use the exact expected name.

    // However, finding the exact asset name requires listing them or guessing.
    // Python does `startswith` check.
    // I'll stick to searching in download.
    // Locally, I'll save it as `hrequests-cgo${ext}` to simplify?
    // No, versioning is important.
    return join(BIN_DIR, `hrequests-cgo-${BRIDGE_VERSION}-${this.getPlatformArch().os}-${this.getPlatformArch().arch}${this.getPlatformArch().ext}`);
  }

  async ensureBridge(): Promise<void> {
    // Check if we have a matching file in BIN_DIR
    // We'll use a simpler check: does current binPath exist?
    // Note: getBinPath constructs a "target" path, but the actual downloaded file might differ in name slightly if we used the asset name.
    // Let's enforce the name to be what we expect.

    if (existsSync(this.binPath)) return;
    await this.downloadBridge();
  }

  private async downloadBridge() {
    console.log('Downloading hrequests-cgo binary...');
    const releasesUrl = 'https://api.github.com/repos/daijro/hrequests/releases';
    const resp = await fetch(releasesUrl);
    if (!resp.ok) throw new Error(`Failed to fetch releases: ${resp.statusText}`);

    const releases = await resp.json() as any[];
    const { os, arch, ext } = this.getPlatformArch();

    let downloadUrl: string | undefined;

    // Logic to match the Python implementation's asset selection
    const filePref = `hrequests-cgo-${BRIDGE_VERSION}`;
    const fileCont = os; // 'darwin', 'windows-4.0', 'linux'

    for (const release of releases) {
      for (const asset of release.assets) {
        const name = asset.name as string;
        if (name.startsWith(filePref) &&
          name.includes(fileCont) &&
          name.endsWith(ext) &&
          name.includes(arch)) {
          downloadUrl = asset.browser_download_url;
          break;
        }
      }
      if (downloadUrl) break;
    }

    if (!downloadUrl) throw new Error(`No matching binary found for ${os}-${arch}`);

    const fileResp = await fetch(downloadUrl);
    if (!fileResp.ok) throw new Error(`Failed to download binary: ${fileResp.statusText}`);

    const fileStream = createWriteStream(this.binPath);
    await pipeline(fileResp.body as any, fileStream);

    if (platform() !== 'win32') {
      chmodSync(this.binPath, 0o755);
    }
  }

  async load(): Promise<void> {
    await this.ensureBridge();

    try {
      this.lib = koffi.load(this.binPath);
    } catch (e) {
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
    if (!this.port) throw new Error("Could not find an open port from Bridge");

    const portStr = String(this.port);
    StartServer({ p: portStr, n: portStr.length });

    // Wait for health check? Python doesn't seem to wait explicitly, but maybe we should.
    // We can assume it starts quickly.
    // Python code: calls StartServer(ref) then proceeds.

    console.log(`Bridge server started on port ${this.port}`);
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

