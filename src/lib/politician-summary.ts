import type { PoliticianProfile } from "./types";

export interface PoliticianSummary {
  politicianId: string;
  displayName: string;
  party: string;
  district: string;
  discrepancyCount: number;
}

export function profileToSummary(profile: PoliticianProfile): PoliticianSummary {
  return {
    politicianId: profile.politicianId,
    displayName: profile.displayName,
    party: profile.party[0]?.value ?? "",
    district: profile.district[0]?.value ?? "",
    discrepancyCount: profile.discrepancies.length,
  };
}
