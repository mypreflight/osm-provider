import { handleRequest } from "./handler";
import { type FunctionUrlEvent, handler } from "./lambda";

jest.mock("./handler", () => ({ handleRequest: jest.fn() }));

const handleRequestMock = jest.mocked(handleRequest);

const SECRET = "0123456789abcdef0123456789abcdef";

const AIRPORT_BODY = { airport: { icaoCode: "EDDF", name: "Frankfurt", source: "OpenStreetMap via Overpass" } };

function event(overrides: Partial<FunctionUrlEvent> = {}): FunctionUrlEvent {
  return {
    rawPath: "/pull",
    headers: { authorization: `Bearer ${SECRET}` },
    queryStringParameters: { icao: "EDDF" },
    requestContext: { http: { method: "GET" } },
    ...overrides,
  };
}

let originalSecret: string | undefined;

beforeEach(() => {
  originalSecret = process.env.OSM_FUNCTION_SECRET;
  process.env.OSM_FUNCTION_SECRET = SECRET;
  handleRequestMock.mockReset();
  handleRequestMock.mockResolvedValue({ statusCode: 200, body: AIRPORT_BODY });
});

afterEach(() => {
  if (originalSecret === undefined) {
    delete process.env.OSM_FUNCTION_SECRET;
  } else {
    process.env.OSM_FUNCTION_SECRET = originalSecret;
  }
});

describe("the bearer secret", () => {
  it("lets a request with the right secret through", async () => {
    const response = await handler(event());

    expect(response.statusCode).toBe(200);
    expect(handleRequestMock).toHaveBeenCalledTimes(1);
  });

  it("accepts the scheme in any case", async () => {
    const response = await handler(event({ headers: { authorization: `bearer ${SECRET}` } }));

    expect(response.statusCode).toBe(200);
  });

  it.each([
    ["missing", {}],
    ["empty", { authorization: "" }],
    ["the bare secret, without the scheme", { authorization: SECRET }],
    ["a different scheme", { authorization: `Basic ${SECRET}` }],
    ["the scheme alone", { authorization: "Bearer " }],
    ["wrong but the same length", { authorization: `Bearer ${"f".repeat(SECRET.length)}` }],
    ["a prefix of the secret", { authorization: `Bearer ${SECRET.slice(0, 8)}` }],
    ["longer than the secret", { authorization: `Bearer ${SECRET}0` }],
  ])("answers 401 when the header is %s", async (_label, headers) => {
    const response = await handler(event({ headers }));

    expect(response.statusCode).toBe(401);
    expect(response.headers).toEqual({ "Content-Type": "application/json", "WWW-Authenticate": "Bearer" });
    expect(JSON.parse(response.body)).toEqual({
      error: { code: "UNAUTHORIZED", message: "The Authorization header is missing or wrong.", status: 401 },
    });
    expect(handleRequestMock).not.toHaveBeenCalled();
  });

  it("answers 401 when the event carries no headers at all", async () => {
    const response = await handler(event({ headers: undefined }));

    expect(response.statusCode).toBe(401);
    expect(handleRequestMock).not.toHaveBeenCalled();
  });

  it("refuses every request when the secret is empty, even one sending an empty token", async () => {
    process.env.OSM_FUNCTION_SECRET = "";

    const response = await handler(event({ headers: { authorization: "Bearer " } }));

    expect(response.statusCode).toBe(401);
    expect(handleRequestMock).not.toHaveBeenCalled();
  });

  it("refuses every request when the secret is unset", async () => {
    delete process.env.OSM_FUNCTION_SECRET;

    const response = await handler(event({ headers: { authorization: "Bearer undefined" } }));

    expect(response.statusCode).toBe(401);
    expect(handleRequestMock).not.toHaveBeenCalled();
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
    expect(handleRequestMock).not.toHaveBeenCalled();
  });
});

describe("forwarding to the handler", () => {
  it("passes the method and the query parameters", async () => {
    await handler(event({ queryStringParameters: { icao: "LIPZ", include: "runways,gates" } }));

    expect(handleRequestMock).toHaveBeenCalledWith(expect.anything(), {
      method: "GET",
      query: { icao: "LIPZ", include: "runways,gates" },
    });
  });

  it.each(["POST", "DELETE"])("forwards %s for the handler to judge", async (method) => {
    await handler(event({ requestContext: { http: { method } } }));

    expect(handleRequestMock).toHaveBeenCalledWith(expect.anything(), { method, query: { icao: "EDDF" } });
  });

  it("copes with a request that has no query string", async () => {
    await handler(event({ queryStringParameters: undefined }));

    expect(handleRequestMock).toHaveBeenCalledWith(expect.anything(), { method: "GET", query: {} });
  });

  it("takes the method from the request, never from the query string", async () => {
    await handler(event({ queryStringParameters: { icao: "EDDF", method: "DELETE" } }));

    expect(handleRequestMock).toHaveBeenCalledWith(expect.anything(), {
      method: "GET",
      query: { icao: "EDDF", method: "DELETE" },
    });
  });
});

describe("the response", () => {
  it("keeps the handler's status and serialises its body as JSON", async () => {
    const response = await handler(event());

    expect(response).toEqual({
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(AIRPORT_BODY),
    });
  });

  it("serialises an error body the handler answers with", async () => {
    const body = { error: { code: "AERODROME_NOT_FOUND", message: "none", status: 404 } };
    handleRequestMock.mockResolvedValue({ statusCode: 404, body });

    const response = await handler(event());

    expect(response.statusCode).toBe(404);
    expect(JSON.parse(response.body)).toEqual(body);
  });
});
