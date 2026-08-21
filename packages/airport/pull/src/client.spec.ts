import { readFileSync } from "node:fs";
import { join } from "node:path";
import { areaQuery, aroundQuery, DEFAULT_OVERPASS_URLS, TIMING } from "./client";

const PROJECT_YML = join(__dirname, "..", "..", "..", "..", "project.yml");

describe("areaQuery", () => {
  const query = areaQuery("EDDF");

  it("keys the aerodrome on its ICAO tag", () => {
    expect(query).toContain('nwr["aeroway"="aerodrome"]["icao"="EDDF"]->.a');
  });

  it("asks for the boundary and its features in one round trip", () => {
    expect(query).toContain(".a map_to_area->.f");
    expect(query).toContain("(.a; .feat;);");
  });

  it.each(["runway", "terminal", "parking_position", "gate"])("collects aeroway=%s", (feature) => {
    expect(query).toContain(`nwr(area.f)["aeroway"="${feature}"];`);
  });

  it("asks for geometry, not bare references", () => {
    expect(query).toContain("out geom;");
  });
});

describe("aroundQuery", () => {
  const query = aroundQuery("EDDF");

  it("searches a radius instead of an enclosed area, for a node-only aerodrome", () => {
    expect(query).toContain("nwr(around.a:8000)");
    expect(query).not.toContain("map_to_area");
  });
});

describe("both queries", () => {
  it("give Overpass its own timeout so it fails the query rather than the connection", () => {
    expect(areaQuery("EDDF")).toContain("[out:json][timeout:60];");
    expect(aroundQuery("EDDF")).toContain("[out:json][timeout:60];");
  });
});

describe("mirrors", () => {
  it("lists more than one, so a single outage is survivable", () => {
    expect(DEFAULT_OVERPASS_URLS.length).toBeGreaterThan(1);
  });

  it.each(DEFAULT_OVERPASS_URLS)("%s is an absolute interpreter endpoint", (url) => {
    expect(() => new URL(url)).not.toThrow();
    expect(url).toMatch(/\/interpreter$/);
  });
});

describe("the retry budget", () => {
  /**
   * The whole point of the deadline: the platform kills the invocation at the
   * `timeout` in project.yml, and a retry loop that outlives it hands the caller
   * an opaque platform error instead of the 502 this function would have sent.
   * Lowering that timeout without lowering the deadline breaks the guarantee, so
   * read it from the deployment descriptor rather than restating it here.
   */
  const timeouts = [...readFileSync(PROJECT_YML, "utf-8").matchAll(/^\s*timeout:\s*(\d+)\s*$/gm)].map((match) =>
    Number(match[1]),
  );

  it("finds an explicit timeout in project.yml to measure against", () => {
    // The platform default is 3s, so an absent timeout is a deployment bug.
    expect(timeouts.length).toBeGreaterThan(0);
  });

  it("leaves room for one more full request inside the function timeout", () => {
    expect(TIMING.deadlineMs + TIMING.requestTimeoutMs).toBeLessThanOrEqual(Math.min(...timeouts));
  });
});
