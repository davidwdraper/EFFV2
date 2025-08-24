// /backend/tests/e2e/helpers/ports.ts
import net from "node:net";

export async function waitForPort(
  port: number,
  timeoutMs = 60_000,
  host = "127.0.0.1"
) {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const ok = await new Promise<boolean>((resolve) => {
      const socket = new net.Socket();

      socket
        .setTimeout(2000)
        .once("connect", () => {
          socket.destroy();
          resolve(true);
        })
        .once("timeout", () => {
          socket.destroy();
          resolve(false);
        })
        .once("error", () => {
          socket.destroy();
          resolve(false);
        })
        .connect(port, host);
    });

    if (ok) return;
    await new Promise((r) => setTimeout(r, 300));
  }

  throw new Error(`Port ${host}:${port} not reachable within ${timeoutMs}ms`);
}
