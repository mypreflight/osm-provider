import { Then, When } from "@cucumber/cucumber";
import expect from "expect";
import { type FunctionUrlEvent, handler, PULL_PATH } from "../../src/lambda";
import { deepCompare } from "../_helper/deep-compare";

let statusCode: number;
let body: unknown;

async function invoke(
  query: Record<string, string>,
  method = "GET",
  authorization: string | null = `Bearer ${process.env.OSM_FUNCTION_SECRET}`,
): Promise<void> {
  const event: FunctionUrlEvent = {
    rawPath: PULL_PATH,
    headers: authorization === null ? {} : { authorization },
    queryStringParameters: query,
    requestContext: { http: { method } },
  };

  const result = await handler(event);

  statusCode = result.statusCode;
  body = JSON.parse(result.body);
}

When("I request the airport {string}", async (icao: string) => {
  await invoke({ icao });
});

When("I request the airport {string} including {string}", async (icao: string, include: string) => {
  await invoke({ icao, include });
});

When("I request the airport {string} with the method {string}", async (icao: string, method: string) => {
  await invoke({ icao }, method.toUpperCase());
});

When("I request the airport {string} without the function secret", async (icao: string) => {
  await invoke({ icao }, "GET", null);
});

When("I request the airport {string} with the bearer token {string}", async (icao: string, token: string) => {
  await invoke({ icao }, "GET", `Bearer ${token}`);
});

When("I request no airport at all", async () => {
  await invoke({});
});

Then("the response status should be {int}", (expected: number) => {
  expect(statusCode).toBe(expected);
});

Then("the response body should contain:", (docString: string) => {
  deepCompare(body, JSON.parse(docString));
});

Then("the response body should have the property {string}", (property: string) => {
  expect(body).toHaveProperty(property);
});

Then("the response body should not have the property {string}", (property: string) => {
  expect(body).not.toHaveProperty(property);
});

Then("I dump response", () => {
  console.log(JSON.stringify(body, null, 2));
});
