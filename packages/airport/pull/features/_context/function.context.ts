import { Then, When } from "@cucumber/cucumber";
import expect from "expect";
import { main } from "../../src/function";
import { deepCompare } from "../_helper/deep-compare";

let statusCode: number;
let body: unknown;

async function invoke(params: Record<string, string>): Promise<void> {
  const result = await main(params);

  statusCode = result.statusCode;
  body = result.body;
}

When("I request the airport {string}", async (icao: string) => {
  await invoke({ icao });
});

When("I request the airport {string} including {string}", async (icao: string, include: string) => {
  await invoke({ icao, include });
});

When("I request the airport {string} with the method {string}", async (icao: string, method: string) => {
  await invoke({ icao, __ow_method: method });
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
