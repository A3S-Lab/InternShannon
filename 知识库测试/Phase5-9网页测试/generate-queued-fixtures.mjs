import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const targetBytes = 2 * 1024 * 1024;
const sourceDirectory = fileURLToPath(new URL("./sources/", import.meta.url));

for (const suffix of ["a", "b"]) {
  const marker = `QUEUE-${suffix.toUpperCase()}-0714`;
  const line = `${marker} 客户续费任务排队测试，包含中文知识检索内容和可追溯唯一标识。\n`;
  const content = line.repeat(Math.ceil(targetBytes / Buffer.byteLength(line, "utf8")));
  writeFileSync(`${sourceDirectory}/queued-ingest-${suffix}.txt`, content, "utf8");
}
