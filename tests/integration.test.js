import hrequests, { shutdown } from "../dist/index.js";

const IP_ENDPOINT = "https://httpbin.org/headers";

function isValidIpString(ip) {
  const ipv4Pattern = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
  const ipv6Pattern = /^[0-9a-fA-F:]+$/;
  return ipv4Pattern.test(ip) || ipv6Pattern.test(ip);
}

async function testBridgeRequest(browser, expectedUserAgentPart) {
    console.log(`Testing Bridge Request with ${browser}...`);
    const resp = await hrequests.get(IP_ENDPOINT, { browser });
    const json = await resp.json();
    const ua = json.headers['User-Agent'];
    console.log(`User-Agent: ${ua}`);
    
    if (!ua.includes(expectedUserAgentPart)) {
        throw new Error(`Expected User-Agent to contain ${expectedUserAgentPart}, got ${ua}`);
    }
}

async function testRotation() {
    console.log('Testing User-Agent Rotation...');
    const uaSet = new Set();
    // Make 3 requests, should likely get different UAs if stateless requests generate new sessions
    for (let i = 0; i < 3; i++) {
        const resp = await hrequests.get(IP_ENDPOINT, { browser: 'chrome' });
        const json = await resp.json();
        uaSet.add(json.headers['User-Agent']);
    }
    console.log(`Unique User-Agents over 3 requests: ${uaSet.size}`);
    // Note: With a small set of mock devices/header-generator, collision is possible, but unlikely for 3 if pool is large.
    // If it's always the same, rotation might not be working or pool is 1.
}

async function testRender(browser, expectedTitlePart) {
    console.log(`Testing Render with ${browser}...`);
    // Using a simpler page for speed
    const url = "https://example.com";
    const resp = await hrequests.get(url, {
        render: {
            browser,
            headless: true
        }
    });
    
    const title = await resp.page.title();
    console.log(`Page Title: ${title}`);
    
    if (!title.includes("Example Domain")) {
        throw new Error(`Expected title 'Example Domain', got '${title}'`);
    }
    
    await resp.close();
}

async function main() {
    try {
        await testBridgeRequest('chrome', 'Chrome');
        await testBridgeRequest('firefox', 'Firefox');
        await testRotation();
        
        await testRender('chrome', 'Example Domain');
        await testRender('firefox', 'Example Domain');
        
        console.log("All tests passed!");
    } catch (e) {
        console.error("Test failed:", e);
        process.exitCode = 1;
    } finally {
        await shutdown();
    }
}

main();

