import hrequests, { shutdown } from "../dist/index.js";

const TARGET_URL = "https://www.google.com/search?q=capital+one+jobs+workday";

async function main() {
  let response = null;
  try {
    response = await hrequests.get(TARGET_URL, {
      headers: { Accept: "text/html" },
      render: { headless: true },
    });

    const html = await response.text();
    if (typeof html !== "string" || html.length === 0) {
      throw new Error("Expected non-empty HTML from headless render");
    }

    if (!/<!doctype html/i.test(html)) {
      throw new Error("Expected rendered response to include an HTML document");
    }
  } finally {
    if (response) {
      await response.delete().catch(() => undefined);
    }
    await shutdown().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

