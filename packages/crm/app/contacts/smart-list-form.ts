import {
  SMART_LIST_CRITERIA_MAX,
  SMART_LIST_SCHEMA_VERSION,
  SmartListValidationError,
  parseSmartListDefinition,
  type SmartListCriterion,
  type SmartListDefinitionV1,
} from "@/lib/domain/smart-list";

const ENUM_FIELDS = new Set([
  "leadType",
  "relationship",
  "intent",
  "source",
  "pipelineStage",
]);

const NUMBER_FIELDS = new Set(["buyer.priceMin", "buyer.priceMax"]);

function scalar(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function boundedCriteriaCount(formData: FormData): number {
  const raw = scalar(formData, "criteriaCount");
  const count = Number(raw);
  if (!Number.isInteger(count) || count < 0 || count > SMART_LIST_CRITERIA_MAX) {
    throw new SmartListValidationError(
      `Use ${SMART_LIST_CRITERIA_MAX} criteria or fewer.`,
      { criteria: `Use 0–${SMART_LIST_CRITERIA_MAX} criteria.` },
    );
  }
  return count;
}

function criterion(formData: FormData, index: number): unknown {
  const prefix = `criteria.${index}`;
  const field = scalar(formData, `${prefix}.field`);
  const operator = scalar(formData, `${prefix}.operator`);

  if (field === "nextTouchAt" && operator === "empty") {
    return { field, operator };
  }

  if (field === "tags") {
    const value = scalar(formData, `${prefix}.value`)
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
    return { field, operator, value };
  }

  if (ENUM_FIELDS.has(field) && operator === "in") {
    const value = formData
      .getAll(`${prefix}.value`)
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter(Boolean);
    return { field, operator, value };
  }

  const rawValue = scalar(formData, `${prefix}.value`);
  if (NUMBER_FIELDS.has(field)) {
    return { field, operator, value: rawValue === "" ? Number.NaN : Number(rawValue) };
  }

  return { field, operator, value: rawValue };
}

/** Converts the bounded form grammar into the same validated v1 definition used by CLI and repositories. */
export function parseSmartListDefinitionFormData(formData: FormData): SmartListDefinitionV1 {
  const criteriaCount = boundedCriteriaCount(formData);
  const criteria = Array.from(
    { length: criteriaCount },
    (_, index) => criterion(formData, index),
  ) as SmartListCriterion[];
  const sortField = scalar(formData, "sort.field");
  const sortDirection = scalar(formData, "sort.direction");

  return parseSmartListDefinition({
    schemaVersion: SMART_LIST_SCHEMA_VERSION,
    criteria,
    ...(sortField
      ? { sort: { field: sortField, direction: sortDirection } }
      : {}),
  });
}
