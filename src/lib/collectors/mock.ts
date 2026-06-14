import { politicians } from "../mock-data";
import type { PoliticianProfile } from "../types";
import type { Collector } from "./types";

export class MockCollector implements Collector<PoliticianProfile> {
  sourceName = "mock-politician-fixture";

  async collect(): Promise<PoliticianProfile[]> {
    return politicians;
  }
}
