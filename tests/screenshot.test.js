import hrequests, { render, shutdown } from "../dist/index.js";
import { existsSync, unlinkSync } from "fs";

async function testDirectRender() {
  console.log("Testing screenshot with direct render()...");

  // Python pattern: page = hrequests.render("https://example.com")
  const page = await render("https://example.com", {
    headless: true,
    browser: 'chrome'
  });

  try {
    const html = await page.html;
    console.log("Page loaded:", html.url);

    // Test screenshot to file
    const screenshotPath = "test-screenshot.png";
    await html.screenshot(screenshotPath);

    if (existsSync(screenshotPath)) {
      console.log("✓ Screenshot saved successfully to:", screenshotPath);
      unlinkSync(screenshotPath); // Clean up
    } else {
      throw new Error("Screenshot file was not created!");
    }

    // Test screenshot returning buffer
    const buffer = await html.screenshot();
    if (buffer && buffer.length > 0) {
      console.log("✓ Screenshot buffer returned successfully, size:", buffer.length, "bytes");
    } else {
      throw new Error("Screenshot buffer was not returned!");
    }
  } finally {
    await page.close();
  }
}

async function testResponseRender() {
  console.log("\nTesting screenshot with response.render()...");

  // Python pattern:
  //   response = hrequests.get("https://example.com")
  //   page = response.render()
  //   page.screenshot(path="screenshot.png")
  //   page.close()

  const response = await hrequests.get("https://example.com", {
    browser: "chrome"
  });

  console.log("Response status:", response.statusCode);

  // Render the response in a browser
  const page = await response.render({ headless: true });

  try {
    const html = await page.html;
    console.log("Page URL:", html.url);

    // Test screenshot to file
    const screenshotPath = "test-screenshot-render.png";
    await html.screenshot(screenshotPath);

    if (existsSync(screenshotPath)) {
      console.log("✓ Screenshot saved successfully to:", screenshotPath);
      unlinkSync(screenshotPath); // Clean up
    } else {
      throw new Error("Screenshot file was not created!");
    }

    // Test screenshot returning buffer
    const buffer = await html.screenshot();
    if (buffer && buffer.length > 0) {
      console.log("✓ Screenshot buffer returned successfully, size:", buffer.length, "bytes");
    } else {
      throw new Error("Screenshot buffer was not returned!");
    }
  } finally {
    await page.close();
  }
}

async function main() {
  try {
    await testDirectRender();
    await testResponseRender();
    console.log("\nAll screenshot tests passed!");
  } catch (e) {
    console.error("Test failed:", e);
    process.exitCode = 1;
  } finally {
    await shutdown();
  }
}

main();

