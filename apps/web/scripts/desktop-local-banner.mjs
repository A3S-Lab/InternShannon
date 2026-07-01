export function formatDesktopLocalBanner(input) {
  const webPort = normalizeRequiredValue(input?.webPort, "webPort");
  const apiPort = normalizeRequiredValue(input?.apiPort, "apiPort");
  const dataDir = normalizeRequiredValue(input?.dataDir, "dataDir");
  const webUrl = `http://127.0.0.1:${webPort}`;
  const apiUrl = `http://127.0.0.1:${apiPort}/api/v1`;
  const gatewayUrl = `http://127.0.0.1:${apiPort}`;

  return [
    "",
    "desktop-local: 启动桌面本地闭环",
    `  Web      ${webUrl}`,
    `  API      ${apiUrl}`,
    `  Health   ${apiUrl}/health`,
    `  Data     ${dataDir}`,
    `  Smoke    PUBLIC_DESKTOP_URL=${webUrl} PUBLIC_DESKTOP_GATEWAY_URL=${gatewayUrl} just desktop-web-smoke`,
    "",
  ].join("\n");
}

function normalizeRequiredValue(value, name) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    throw new Error(`${name} is required`);
  }
  return normalized;
}

function main(argv) {
  const [webPort, apiPort, dataDir] = argv;
  process.stdout.write(formatDesktopLocalBanner({ webPort, apiPort, dataDir }));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2));
}
