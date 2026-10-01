import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

if (process.env.NODE_ENV === "production") {
  console.error("El modo DEMO UI está prohibido en production.");
  process.exit(1);
}

const webRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const child = spawn("pnpm", ["exec", "next", "dev", "--port", "3000"], {
  cwd: webRoot,
  env: {
    ...process.env,
    NODE_ENV: "development",
    NEXT_PUBLIC_DEMO_UI: "true",
  },
  stdio: "inherit",
  shell: true,
});

child.on("exit", (code) => {
  process.exit(code ?? 0);
});
