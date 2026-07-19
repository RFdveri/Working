import standardDoorSizesRaw from "../../config/standard-door-sizes.json" with { type: "json" };
import type { StandardDoorSizeReference } from "@ai-door-assistant/shared";

/**
 * Loads the standard interior-door leaf/opening size table (by room) the
 * business owner provided. This is advice/reference data only — it informs
 * what the sales agent recommends or asks about, it never overrides a size
 * the customer actually stated.
 */
export function loadStandardDoorSizes(): StandardDoorSizeReference {
  return standardDoorSizesRaw as unknown as StandardDoorSizeReference;
}

/** Renders the table compactly for groundedContext, e.g. for the LLM to cite when advising on sizes. */
export function formatStandardDoorSizesForPrompt(reference: StandardDoorSizeReference): string {
  const rows = reference.rows
    .map(
      (row) =>
        `${row.room}: полотно ${row.leafWidthMm}x${row.leafHeightMm} мм, проём ~${row.openingWidthMm[0]}-${row.openingWidthMm[1]}x${row.openingHeightMm[0]}-${row.openingHeightMm[1]} мм`
    )
    .join("; ");
  return (
    `Стандартные размеры по типу помещения (только справочно, если клиент ещё не определился): ${rows}. ` +
    `Правило запаса: проём делают шире полотна на ${reference.widthMarginMm[0]}-${reference.widthMarginMm[1]} мм и выше на ${reference.heightMarginMm[0]}-${reference.heightMarginMm[1]} мм.`
  );
}
