import { describe, expect, it } from "vitest";
import { SMART_LIST_CRITERIA_MAX } from "@/lib/domain/smart-list";
import { parseSmartListDefinitionFormData } from "./smart-list-form";

function appendCriterion(
  data: FormData,
  index: number,
  field: string,
  operator: string,
  values: string | readonly string[],
) {
  data.set(`criteria.${index}.field`, field);
  data.set(`criteria.${index}.operator`, operator);
  for (const value of Array.isArray(values) ? values : [values]) {
    data.append(`criteria.${index}.value`, value);
  }
}

describe("Smart List form grammar", () => {
  it("parses the complete allowlisted v1 grammar and optional sort", () => {
    const data = new FormData();
    const inputs = [
      ["query", "contains", "north austin"],
      ["leadType", "in", ["hot", "warm"]],
      ["relationship", "eq", "active-client"],
      ["intent", "in", ["buyer", "investor"]],
      ["source", "eq", "referral"],
      ["pipelineStage", "in", ["new", "contacted"]],
      ["city", "contains", "Austin"],
      ["state", "eq", "TX"],
      ["postalCode", "contains", "787"],
      ["buyer.timeline", "contains", "90 days"],
      ["seller.timeline", "eq", "this spring"],
      ["buyer.priceMin", "min", "250000"],
      ["buyer.priceMax", "max", "900000"],
      ["tags", "all", "VIP, sphere"],
      ["nextTouchAt", "before", "2026-09-01"],
    ] as const;
    data.set("criteriaCount", String(inputs.length));
    inputs.forEach(([field, operator, values], index) => {
      appendCriterion(data, index, field, operator, values);
    });
    data.set("sort.field", "nextTouchAt");
    data.set("sort.direction", "asc");

    const result = parseSmartListDefinitionFormData(data);

    expect(result.criteria).toHaveLength(inputs.length);
    expect(result.criteria[1]).toEqual({
      field: "leadType",
      operator: "in",
      value: ["hot", "warm"],
    });
    expect(result.criteria[11]).toEqual({
      field: "buyer.priceMin",
      operator: "min",
      value: 250000,
    });
    expect(result.criteria[13]).toEqual({
      field: "tags",
      operator: "all",
      value: ["VIP", "sphere"],
    });
    expect(result.sort).toEqual({ field: "nextTouchAt", direction: "asc" });
  });

  it("supports an empty next-touch criterion without a value", () => {
    const data = new FormData();
    data.set("criteriaCount", "1");
    appendCriterion(data, 0, "nextTouchAt", "empty", "");

    expect(parseSmartListDefinitionFormData(data).criteria).toEqual([
      { field: "nextTouchAt", operator: "empty" },
    ]);
  });

  it("fails closed above 20 criteria and returns a field-level reason", () => {
    const data = new FormData();
    data.set("criteriaCount", String(SMART_LIST_CRITERIA_MAX + 1));

    expect(() => parseSmartListDefinitionFormData(data)).toThrowError(
      /20 criteria or fewer/i,
    );
    try {
      parseSmartListDefinitionFormData(data);
    } catch (error) {
      expect(error).toMatchObject({ fieldErrors: { criteria: "Use 0–20 criteria." } });
    }
  });

  it("rejects incompatible field/operator/value combinations through domain validation", () => {
    const data = new FormData();
    data.set("criteriaCount", "1");
    appendCriterion(data, 0, "buyer.priceMax", "contains", "not-a-number");

    expect(() => parseSmartListDefinitionFormData(data)).toThrowError(
      /definition is invalid/i,
    );
  });
});
