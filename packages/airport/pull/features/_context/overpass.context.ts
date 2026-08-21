import { AfterAll, Before, Given, Then } from "@cucumber/cucumber";
import expect from "expect";
import { resetClient } from "../../src/function";
import { callsTo, queries, reset, restoreFixtures, expect as stub } from "../_helper/mockserver";
import {
  aerodrome,
  aerodromeNode,
  completeAirport,
  gates,
  overpassResponse,
  resetIds,
  runway,
  stands,
  terminal,
} from "../_helper/overpass.fixture";

/**
 * Tells the enclosed-area query apart from its radius fallback. Both markers have
 * to survive form-urlencoding, since that is how the query reaches Overpass and
 * how mockserver matches on it — `around.a:8000` arrives as `around.a%3A8000`.
 */
const AREA_QUERY = "map_to_area";
const AROUND_QUERY = "around.a";

Before(async () => {
  await reset();
  resetIds();
  resetClient();
});

Given("OpenStreetMap holds a complete airport", async () => {
  await stub({ status: 200, body: overpassResponse(completeAirport()) });
});

Given("OpenStreetMap holds an aerodrome with the runway {string}", async (ref: string) => {
  await stub({ status: 200, body: overpassResponse([aerodrome("Venice Marco Polo"), runway(ref)]) });
});

Given("OpenStreetMap holds the stands {string} and the gates {string}", async (standRefs: string, gateRefs: string) => {
  const split = (value: string) => value.split(",").map((entry) => entry.trim());

  await stub({
    status: 200,
    body: overpassResponse([
      aerodrome("Venice Marco Polo"),
      terminal("T1", "Passenger Terminal"),
      ...stands(split(standRefs)),
      ...gates(split(gateRefs)),
    ]),
  });
});

Given("OpenStreetMap holds nothing", async () => {
  await stub({ status: 200, body: overpassResponse([]) });
});

Given("OpenStreetMap maps the aerodrome as a bare node, with its features nearby", async () => {
  // The enclosed-area query can only find the node itself, so the client has to
  // fall back to searching a radius around it.
  await stub({ queryContains: AREA_QUERY, status: 200, body: overpassResponse([aerodromeNode("Venice Marco Polo")]) });
  await stub({
    queryContains: AROUND_QUERY,
    status: 200,
    body: overpassResponse([aerodromeNode("Venice Marco Polo"), runway("04R/22L")]),
  });
});

Given("Overpass is unavailable", async () => {
  await stub({ status: 500, body: "runtime error: Query timed out" });
});

Given("Overpass answers with something that is not JSON", async () => {
  await stub({ status: 200, body: "<html>rate limited</html>" });
});

Then("Overpass should have been queried {int} time(s)", async (count: number) => {
  expect(await callsTo()).toBe(count);
});

Then("Overpass should have been asked for the enclosed area", async () => {
  expect((await queries()).some((query) => query.includes(AREA_QUERY))).toBe(true);
});

Then("Overpass should have been asked for a radius around the aerodrome", async () => {
  expect((await queries()).some((query) => query.includes(AROUND_QUERY))).toBe(true);
});

AfterAll(async () => {
  await restoreFixtures();
});
