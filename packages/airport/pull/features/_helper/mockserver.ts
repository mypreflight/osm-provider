const MOCKSERVER_URL = new URL(process.env.OVERPASS_URL ?? "http://overpass-mock:1080/api/interpreter").origin;

export const OVERPASS_PATH = "/api/interpreter";

type Expectation = {
  /**
   * Substring the Overpass query must contain for this stub to answer, which is
   * how the area query and its `around` fallback get told apart.
   */
  queryContains?: string;
  status: number;
  body: string;
};

async function control(action: string, body: unknown, query = ""): Promise<Response> {
  return fetch(`${MOCKSERVER_URL}/mockserver/${action}${query}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function reset(): Promise<void> {
  await fetch(`${MOCKSERVER_URL}/mockserver/reset`, { method: "PUT" });
}

export async function expect(expectation: Expectation): Promise<void> {
  await control("expectation", {
    httpRequest: {
      method: "POST",
      path: OVERPASS_PATH,
      ...(expectation.queryContains
        ? { body: { type: "STRING", string: expectation.queryContains, subString: true } }
        : {}),
    },
    httpResponse: {
      statusCode: expectation.status,
      headers: { "Content-Type": ["application/json"] },
      body: expectation.body,
    },
  });
}

export async function callsTo(path = OVERPASS_PATH): Promise<number> {
  const response = await control("retrieve", { path }, "?type=REQUESTS&format=JSON");
  const recorded = (await response.json()) as unknown[];

  return recorded.length;
}

/** The bodies of every Overpass query recorded so far, oldest first. */
export async function queries(path = OVERPASS_PATH): Promise<string[]> {
  const response = await control("retrieve", { path }, "?type=REQUESTS&format=JSON");
  const recorded = (await response.json()) as { body?: { string?: string } | string }[];

  return recorded.map((request) => {
    const body = request.body;
    const raw = typeof body === "string" ? body : (body?.string ?? "");

    return decodeURIComponent(raw.replace(/^data=/, "").replace(/\+/g, " "));
  });
}

/**
 * Puts the `docker compose` fixtures back, so a functional run leaves the dev
 * environment as it found it.
 */
export async function restoreFixtures(): Promise<void> {
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const file = join(__dirname, "..", "..", "..", "..", "..", "docker", "mock", "overpass.json");
  const expectations = JSON.parse(readFileSync(file, "utf-8")) as unknown[];

  await reset();
  for (const expectation of expectations) {
    await control("expectation", expectation);
  }
}
