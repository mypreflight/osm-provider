export type OsmTags = Record<string, string>;

export interface OsmGeometryPoint {
  lat: number;
  lon: number;
}

export interface OsmMember {
  type: "node" | "way" | "relation";
  ref: number;
  role: string;
  geometry?: OsmGeometryPoint[];
}

export interface OsmElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  geometry?: OsmGeometryPoint[];
  members?: OsmMember[];
  tags?: OsmTags;
}

export interface OverpassResponse {
  elements: OsmElement[];
}
