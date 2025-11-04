import hrequests, { shutdown } from "../dist/index.js";

const IP_ENDPOINT = "https://api.ipify.org?format=json";

function extractIp(data) {
  if (!data || typeof data !== "object") {
    return null;
  }

  for (const key of ["ip", "clientIp", "ipAddress", "ip_address", "query"]) {
    const value = data[key];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }

  return null;
}

function isValidIpString(ip) {
  const ipv4Pattern = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
  const ipv6Pattern = /^[0-9a-fA-F:]+$/;
  return ipv4Pattern.test(ip) || ipv6Pattern.test(ip);
}

async function main() {
  let response = null;
  try {
    response = await hrequests.get(IP_ENDPOINT, { headers: { Accept: "application/json" } });
    const payload = await response.json();
    const ip = extractIp(payload);

    if (typeof ip !== "string" || !isValidIpString(ip)) {
      throw new Error(`Expected IP string from ipify, got: ${JSON.stringify(payload)}`);
    }

    console.log(`ipify reported public IP: ${ip}`);
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
