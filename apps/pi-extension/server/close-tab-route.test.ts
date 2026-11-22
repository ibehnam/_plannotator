/**
 * Pi's POST /api/close-tab (handlers.ts handleCloseTabRoute): the Bun servers' own close-tab
 * handler (packages/server/close-tab.ts, vendored), reached through Pi's node:http request. The
 * session here is remote (PLANNOTATOR_REMOTE=1), so no AppleScript runs and no browser is asked.
 *
 * What regresses if this fails: a done screen served by Pi gets no close answer (the route parity
 * of tests/parity/route-parity.test.ts holds the route's name, not its answer), or another site's
 * page may ask Pi to close tabs.
 */
import { afterAll, beforeAll, expect, test } from "bun:test";
import { createServer, type Server } from "node:http";
import { handleCloseTabRoute } from "./handlers.ts";

let server: Server;
let port = 0;
let savedRemote: string | undefined;

beforeAll(async () => {
	savedRemote = process.env.PLANNOTATOR_REMOTE;
	process.env.PLANNOTATOR_REMOTE = "1";
	server = createServer((req, res) => void handleCloseTabRoute(req, res));
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	port = (server.address() as { port: number }).port;
});

afterAll(() => {
	server.close();
	if (savedRemote === undefined) delete process.env.PLANNOTATOR_REMOTE;
	else process.env.PLANNOTATOR_REMOTE = savedRemote;
});

test("a request from the session's own page gets the Bun servers' answer: a remote session closes no tab", async () => {
	const res = await fetch(`http://127.0.0.1:${port}/api/close-tab`, {
		method: "POST",
		headers: { "content-type": "application/json", origin: `http://127.0.0.1:${port}` },
		body: JSON.stringify({ afterMs: 0 }),
	});
	expect(res.status).toBe(200);
	expect(await res.json()).toEqual({ closed: 0, reason: "remote", browsers: [] });
});

test("another site's page is refused before anything is closed", async () => {
	const res = await fetch(`http://127.0.0.1:${port}/api/close-tab`, {
		method: "POST",
		headers: { "content-type": "application/json", origin: "https://example.com" },
		body: JSON.stringify({ afterMs: 0 }),
	});
	expect(res.status).toBe(403);
});
