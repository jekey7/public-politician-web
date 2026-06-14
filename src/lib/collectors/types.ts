export interface Collector<TRecord> {
  sourceName: string;
  collect(): Promise<TRecord[]>;
}

export interface CollectorConfigStatus {
  ready: boolean;
  missing: string[];
}
