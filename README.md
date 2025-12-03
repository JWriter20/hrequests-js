# hrequests-js

TypeScript port of the [hrequests](https://github.com/daijro/hrequests) Python library.

`hrequests-js` is a powerful HTTP client that bridges the gap between simple HTTP requests and full browser automation. It features:

- **TLS Fingerprinting**: Mimic real browsers (Chrome, Firefox, etc.) to bypass anti-bot protections. Powered by a lightweight, native Go bridge.
- **Browser Automation**: Seamlessly switch to headless browsers (via Playwright, Camoufox, or Patchright) for JavaScript-heavy sites.
- **Requests-like API**: Familiar, ergonomic API for Python `requests` users.

Unlike previous versions, this is a **direct port** and does **not** require a separate Python installation or service.

## Prerequisites

- Node.js 18+
- **Go 1.21+** (Required for building the native bridge)
  - **macOS**: `brew install go`
  - **Windows**: [Download Installer](https://go.dev/dl/) or `winget install GoLang.Go`
  - **Linux**: Follow [Go Installation Instructions](https://go.dev/doc/install)
- Supported Platforms:
  - macOS (x64, arm64)
  - Linux (x64, arm64, arm-7)
  - Windows (x64)

## Installation

```bash
npm install hrequests-js
```

## Quick Start

### Basic Requests

```ts
import hrequests from "hrequests-js";

// Simple GET
const response = await hrequests.get("https://httpbin.org/json");
const payload = await response.json();
console.log(payload.slideshow.title);

// POST with data
await hrequests.post("https://httpbin.org/post", {
  data: { hello: "world" }
});
```

### TLS Fingerprinting

Easily impersonate different browsers to avoid detection.

```ts
// Create a session that mimics Firefox 120
const session = new hrequests.Session({
  browser: "firefox",
  version: 120
});

const resp = await session.get("https://tls.peet.ws/api/all");
console.log(await resp.json());
```

### Headless Browser Rendering

For pages that require JavaScript, use `hrequests.render`. This spins up a real browser (via Playwright) to execute scripts and retrieve the final DOM.

```ts
// Open a page in a headless browser
const session = await hrequests.render("https://example.com", {
  headless: true
});

// The content is now the fully rendered HTML
console.log(await session.text);

// Cleanup browser resources
await session.close();
```

## How It Works

`hrequests-js` uses a hybrid architecture to provide the best of both worlds:

1.  **TLS/HTTP Requests**: For standard requests, it uses a native Go bridge (via FFI) to handle low-level TLS handshakes. This allows it to modify JA3/JA4 fingerprints and header orders to exactly match real browsers. The bridge is **built locally** on first run (requires Go).
2.  **Browser Automation**: For `render` requests, it uses Playwright (with patches like Camoufox/Patchright) to execute JavaScript and retrieve the final DOM.

## Advanced Usage

### Sessions

Sessions persist cookies and connection pools.

```ts
import { Session } from "hrequests-js";

const session = new Session({ browser: "chrome" });

await session.get("https://httpbin.org/cookies/set/session/true");
const resp = await session.get("https://httpbin.org/cookies");

console.log(resp.json()); // Includes the cookie set above
```

### Custom TLS Configuration

You can fine-tune TLS settings if needed.

```ts
import { TLSClient } from "hrequests-js";

const client = new TLSClient({
  clientIdentifier: "chrome_120",
  randomTlsExtensionOrder: true
});
```

## Contributing

1.  Clone the repository
2.  Install dependencies: `npm install`
3.  Run tests: `npm test`
