import hrequests, { shutdown } from "../dist/index.js";

const TARGET_URL = "https://example.com";

async function main() {
  try {
    const response = await hrequests.get(TARGET_URL, {
      headers: { Accept: "text/html" },
      render: { headless: true },
    });

    const html = response.text;
    if (typeof html !== "string" || html.length === 0) {
      throw new Error("Expected non-empty HTML from headless render");
    }

    console.log(`Rendered HTML length: ${html.length}`);
    console.log(`Status code: ${response.statusCode}`);

    // Check we got valid HTML
    if (!html.includes("Example Domain")) {
      throw new Error("Expected rendered response to include 'Example Domain'");
    }

    console.log("Headless render test passed!");
  } finally {
    await shutdown().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
