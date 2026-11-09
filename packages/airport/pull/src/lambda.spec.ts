import { main } from "./function";
import { type FunctionUrlEvent, handler } from "./lambda";

jest.mock("./function", () => ({ main: jest.fn() }));

const mainMock = jest.mocked(main);

const SECRET = "0123456789abcdef0123456789abcdef";

const AIRPORT_BODY = { airport: { icaoCode: "EDDF", name: "Frankfurt", source: "OpenStreetMap via Overpass" } };

function event(overrides: Partial<FunctionUrlEvent> = {}): FunctionUrlEvent {
  return {
    rawPath: "/pull",
    headers: { "x-require-whisk-auth": SECRET },
    queryStringParameters: { icao: "EDDF" },
    requestContext: { http: { method: "GET" } },
    ...overrides,
  };
}

let originalSecret: string | undefined;

beforeEach(() => {
  originalSecret = process.env.OSM_FUNCTION_SECRET;
  process.env.OSM_FUNCTION_SECRET = SECRET;
  mainMock.mockReset();
  mainMock.mockResolvedValue({
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: AIRPORT_BODY,
  });
});

afterEach(() => {
  if (originalSecret === undefined) {
    delete process.env.OSM_FUNCTION_SECRET;
  } else {
    process.env.OSM_FUNCTION_SECRET = originalSecret;
  }
});

describe("the shared secret", () => {
  it("lets a request with the right secret through", async () => {
    const response = await handler(event());

    expect(response.statusCode).toBe(200);
    expect(mainMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["missing", {}],
    ["empty", { "x-require-whisk-auth": "" }],
    ["wrong but the same length", { "x-require-whisk-auth": "f".repeat(SECRET.length) }],
    ["a prefix of the secret", { "x-require-whisk-auth": SECRET.slice(0, 8) }],
    ["longer than the secret", { "x-require-whisk-auth": `${SECRET}0` }],
  ])("answers 401 when the header is %s", async (_label, headers) => {
    const response = await handler(event({ headers }));

    expect(response.statusCode).toBe(401);
    expect(response.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(response.body)).toEqual({
      error: { code: "UNAUTHORIZED", message: expect.any(String), status: 401 },
    });
    expect(mainMock).not.toHaveBeenCalled();
  });

  it("answers 401 when the event carries no headers at all", async () => {
    const response = await handler(event({ headers: undefined }));

    expect(response.statusCode).toBe(401);
    expect(mainMock).not.toHaveBeenCalled();
  });

  it("refuses every request when the secret is empty, even one sending an empty header", async () => {
    process.env.OSM_FUNCTION_SECRET = "";

    const response = await handler(event({ headers: { "x-require-whisk-auth": "" } }));

    expect(response.statusCode).toBe(401);
    expect(mainMock).not.toHaveBeenCalled();
  });

  it("refuses every request when the secret is unset", async () => {
    delete process.env.OSM_FUNCTION_SECRET;

    const response = await handler(event({ headers: { "x-require-whisk-auth": "undefined" } }));

    expect(response.statusCode).toBe(401);
    expect(mainMock).not.toHaveBeenCalled();
  });

  it("checks the secret before the path, so an unauthorised caller learns nothing about routes", async () => {
    const response = await handler(event({ rawPath: "/elsewhere", headers: {} }));

    expect(response.statusCode).toBe(401);
  });
});

describe("routing", () => {
  it.each(["/", "/pull/", "/PULL", "/pull/extra", "/airport/pull"])("answers 404 for %s", async (rawPath) => {
    const response = await handler(event({ rawPath }));

    expect(response.statusCode).toBe(404);
    expect(response.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(response.body)).toEqual({
      error: { code: "NOT_FOUND", message: expect.stringContaining(rawPath), status: 404 },
    });
    expect(mainMock).not.toHaveBeenCalled();
  });
});

describe("forwarding to the function", () => {
  it("passes the query parameters and the lowercased method", async () => {
    await handler(event({ queryStringParameters: { icao: "LIPZ", include: "runways,gates" } }));

    expect(mainMock).toHaveBeenCalledWith({ icao: "LIPZ", include: "runways,gates", __ow_method: "get" });
  });

  it.each(["POST", "DELETE"])("forwards %s for the function to judge", async (method) => {
    await handler(event({ requestContext: { http: { method } } }));

    expect(mainMock).toHaveBeenCalledWith({ icao: "EDDF", __ow_method: method.toLowerCase() });
  });

  it("copes with a request that has no query string", async () => {
    await handler(event({ queryStringParameters: undefined }));

    expect(mainMock).toHaveBeenCalledWith({ __ow_method: "get" });
  });

  it("never lets the query string override the real method", async () => {
    await handler(event({ queryStringParameters: { icao: "EDDF", __ow_method: "delete" } }));

    expect(mainMock).toHaveBeenCalledWith({ icao: "EDDF", __ow_method: "get" });
  });
});

describe("the response", () => {
  it("keeps the function's status and headers and serialises an object body", async () => {
    const response = await handler(event());

    expect(response).toEqual({
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(AIRPORT_BODY),
    });
  });

  it("serialises an error body the function answers with", async () => {
    const body = { error: { code: "AERODROME_NOT_FOUND", message: "none", status: 404 } };
    mainMock.mockResolvedValue({ statusCode: 404, headers: { "Content-Type": "application/json" }, body });

    const response = await handler(event());

    expect(response.statusCode).toBe(404);
    expect(JSON.parse(response.body)).toEqual(body);
  });

  it("passes a body that is already a string through untouched", async () => {
    mainMock.mockResolvedValue({
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: '{"ok":true}',
    });

    const response = await handler(event());

    expect(response.body).toBe('{"ok":true}');
  });
});
