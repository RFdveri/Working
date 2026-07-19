export type OpeningSizeKind = "leaf" | "opening" | "unspecified";

/** One group of identical doors in a bulk order (e.g. "3 doors at 700mm"). */
export interface OrderDoorGroup {
  quantity: number;
  widthMm: number;
  /** Whether widthMm is the door leaf's own width or the rough wall opening — ambiguous unless the customer said which. */
  widthKind: OpeningSizeKind;
  heightMm?: number;
  heightKind?: OpeningSizeKind;
}

/** Persistent per-conversation order parameters — quantities/sizes/wall thickness, tracked like focusProduct so they survive across turns. */
export interface OrderSpec {
  doorGroups: OrderDoorGroup[];
  wallThicknessMm?: number;
}

export interface StandardDoorSizeRow {
  room: string;
  leafWidthMm: number;
  leafHeightMm: number;
  openingWidthMm: [number, number];
  openingHeightMm: [number, number];
}

export interface StandardDoorSizeReference {
  rows: StandardDoorSizeRow[];
  /** Recommended opening-vs-leaf margin, width then height, in mm. */
  widthMarginMm: [number, number];
  heightMarginMm: [number, number];
}
