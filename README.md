# hrequests-js

WIP - NOT READY FOR PRODUCTION USE

TypeScript wrapper around the [hrequests](https://raw.githubusercontent.com/daijro/hrequests/main/README.md) Python library. Rather than re-implementing the scraper stack in JavaScript, the package spins up a persistent FastAPI microservice that keeps native `hrequests.Session` and `BrowserSession` objects in Python. The Node client communicates with that service over HTTP, returning lightweight metadata and streaming large bodies when needed.

## Prerequisites

- Python 3.8 – 3.13 with `pip`
- Node.js 18+
- Access to install the Python dependencies listed in `python_service/requirements.txt`

The first time the wrapper starts, it will automatically run:

```
pip install -U -r python_service/requirements.txt
python -m hrequests install
```

## Quick start

1. Install Node dependencies:

   ```bash
   npm install
   ```

2. Compile the TypeScript sources (optional in dev if you use ts-node):

   ```bash
   npm run build
   ```

3. Use the helper API:

   ```ts
   import {
     ensureService,
     createSession,
     sendRequest,
     getResponseText,
     deleteResponse,
     shutdown,
     get,
   } from "hrequests-js";

   await ensureService();

   const sessionId = await createSession({ browser: "firefox", version: 129 });
   const meta = await sendRequest("https://httpbin.org/get", { params: { hello: "world" } }, sessionId);

   const body = await getResponseText(meta.responseId);
   console.log(body);

   await deleteResponse(meta.responseId);
   await shutdown();
   ```

   Or use the higher-level helpers that mimic Python's interface:

   ```ts
   import hrequests from "hrequests-js";

   const response = await hrequests.get("https://httpbin.org/json");
   const payload = await response.json();
   console.log(payload.slideshow.title);
   await response.delete();
   ```

### Headless browser rendering

Pass `render` options to any request method to fetch a page through the hrequests headless browser. The response metadata and body resolve after the browser session closes, so you still interact with the result using the normal helpers:

```ts
const rendered = await hrequests.get("https://example.com", {
  render: { headless: true },
});
const html = await rendered.text();
await rendered.delete();
```

For advanced scenarios (custom ports, long-lived clients, etc.), instantiate your own manager:

```ts
import { HRequestsServiceManager } from "hrequests-js";

const manager = new HRequestsServiceManager({ port: 46543, logLevel: "debug" });
await manager.ensureService();
// ...
await manager.shutdown();
```

## How it works

- `src/serviceManager.ts` manages a singleton Python process. It installs Python dependencies on first run, then launches `python_service/main.py` with FastAPI + Uvicorn.
- The Python API keeps `Session` and `Response` instances in memory and returns opaque IDs so large payloads can be streamed via `/responses/{id}/content` without crossing the JS/Python boundary.
- The Node client exposes ergonomic utilities (`sendRequest`, `getResponseJson`, `saveResponseContent`, etc.) and high-level helpers (`get`, `post`, `put`, `patch`, `delete`, `head`, `options`) that mirror the Python API.

## Available endpoints

The FastAPI app exposes:

- `POST /sessions` → create a new `hrequests.Session`
- `DELETE /sessions/{id}` → close and remove a session
- `POST /requests` → perform an HTTP call using an existing session or one-off
- `GET /responses/{id}/text|json|content` → lazily retrieve response bodies
- `DELETE /responses/{id}` → discard cached responses
- `POST /shutdown` → signal the server to stop (the Node client normally just sends SIGTERM)

## Configuration

`HRequestsServiceManager` accepts the following options:

| Option | Default | Description |
| --- | --- | --- |
| `host` | `127.0.0.1` | Hostname the Python service binds to. |
| `port` | `39231` | TCP port for the service. |
| `pythonExecutable` | auto-detected | Override the Python binary (`python3`, virtualenv path, etc.). |
| `logLevel` | `critical` | Passed through to Uvicorn (`critical`, `error`, `warning`, `info`, `debug`, `trace`). |
| `startupTimeoutMs` | `20000` | How long to wait for the health check to succeed. |
| `installDependencies` | `true` | Skip automatic `pip install` if you manage dependencies yourself. |
| `extraEnv` | `{}` | Additional env vars for the Python process. |

You can also point to a specific interpreter via the `HREQUESTS_PYTHON` environment variable.

## Development

- `npm run dev` — Rebuild TypeScript on file changes.
- `npm run build` — Emit the JavaScript bundle in `dist/`.
- `node dist/examples/basic.js` — Run your own scripts against the built client (after `npm run build`).

The Python service lives under `python_service/`. You can run it directly for debugging:

```bash
python python_service/main.py --host 127.0.0.1 --port 39231 --log-level debug
```

Then hit it with any HTTP client (curl, Postman, etc.).

## Roadmap

- Expose browser automation endpoints (`render`, screenshots, etc.).
- Add pooling/reuse for multiple Node processes.
- Optional gRPC transport for lower overhead.
