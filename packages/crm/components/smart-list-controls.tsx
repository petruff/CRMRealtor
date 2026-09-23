"use client";

import { useActionState, useId, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import {
  Archive,
  ListFilter,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
} from "lucide-react";
import {
  INTENT_LABEL,
  LEAD_TYPE_LABEL,
  PIPELINE_LABEL,
  RELATIONSHIP_LABEL,
  SOURCE_LABEL,
  type LeadType,
} from "@/lib/domain/contact";
import {
  SMART_LIST_CRITERIA_MAX,
  type SmartList,
  type SmartListCriterion,
  type SmartListDefinitionV1,
} from "@/lib/domain/smart-list";
import {
  saveSmartListAction,
  setSmartListStatusAction,
} from "@/app/contacts/actions";
import {
  INITIAL_WORK_QUEUE_ACTION_STATE,
  type WorkQueueActionState,
} from "@/app/contacts/action-state";
import type { ContactScope } from "@/lib/application/contact-query";
import { contactViewHref } from "@/lib/application/contact-view-state";

type CriterionField = SmartListCriterion["field"];
type EditorKind = "text" | "enum" | "number" | "tags" | "date";

interface EditorCriterion {
  readonly key: string;
  readonly field: CriterionField;
  readonly operator: string;
  readonly value: string | readonly string[];
}

interface FieldConfig {
  readonly label: string;
  readonly kind: EditorKind;
  readonly operators: readonly { value: string; label: string }[];
  readonly options?: readonly { value: string; label: string }[];
}

const TEXT_OPERATORS = [
  { value: "contains", label: "contains" },
  { value: "eq", label: "is exactly" },
] as const;
const ENUM_OPERATORS = [
  { value: "eq", label: "is" },
  { value: "in", label: "is any of" },
] as const;
const PRICE_OPERATORS = [
  { value: "min", label: "is at least" },
  { value: "max", label: "is at most" },
] as const;

function labelOptions(labels: Readonly<Record<string, string>>) {
  return Object.entries(labels).map(([value, label]) => ({ value, label }));
}

const FIELD_CONFIG: Record<CriterionField, FieldConfig> = {
  query: { label: "Any contact detail", kind: "text", operators: TEXT_OPERATORS },
  leadType: {
    label: "Follow-up group",
    kind: "enum",
    operators: ENUM_OPERATORS,
    options: labelOptions(LEAD_TYPE_LABEL),
  },
  relationship: {
    label: "Relationship",
    kind: "enum",
    operators: ENUM_OPERATORS,
    options: labelOptions(RELATIONSHIP_LABEL),
  },
  intent: {
    label: "Looking to",
    kind: "enum",
    operators: ENUM_OPERATORS,
    options: labelOptions(INTENT_LABEL),
  },
  source: {
    label: "Source",
    kind: "enum",
    operators: ENUM_OPERATORS,
    options: labelOptions(SOURCE_LABEL),
  },
  pipelineStage: {
    label: "Pipeline stage",
    kind: "enum",
    operators: ENUM_OPERATORS,
    options: labelOptions(PIPELINE_LABEL),
  },
  city: { label: "City", kind: "text", operators: TEXT_OPERATORS },
  state: { label: "State", kind: "text", operators: TEXT_OPERATORS },
  postalCode: { label: "Postal code", kind: "text", operators: TEXT_OPERATORS },
  "buyer.timeline": { label: "Buyer timeline", kind: "text", operators: TEXT_OPERATORS },
  "seller.timeline": { label: "Seller timeline", kind: "text", operators: TEXT_OPERATORS },
  "buyer.priceMin": { label: "Buyer minimum price", kind: "number", operators: PRICE_OPERATORS },
  "buyer.priceMax": { label: "Buyer maximum price", kind: "number", operators: PRICE_OPERATORS },
  tags: {
    label: "Tags",
    kind: "tags",
    operators: [
      { value: "any", label: "includes any" },
      { value: "all", label: "includes all" },
    ],
  },
  nextTouchAt: {
    label: "Next touch",
    kind: "date",
    operators: [
      { value: "before", label: "is before" },
      { value: "on", label: "is on" },
      { value: "after", label: "is after" },
      { value: "empty", label: "is not scheduled" },
    ],
  },
};

function defaultCriterion(key: string, field: CriterionField = "query"): EditorCriterion {
  const config = FIELD_CONFIG[field];
  return { key, field, operator: config.operators[0]?.value ?? "eq", value: "" };
}

function editableCriterion(criterion: SmartListCriterion, key: string): EditorCriterion {
  return {
    key,
    field: criterion.field,
    operator: criterion.operator,
    value: "value" in criterion
      ? Array.isArray(criterion.value)
        ? [...criterion.value]
        : String(criterion.value)
      : "",
  };
}

function Submit({
  children,
  className = "sk-primary-button",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className={className}
      disabled={pending}
      aria-busy={pending}
    >
      {pending ? "Saving…" : children}
    </button>
  );
}

function Notice({ message, status }: { message?: string; status: string }) {
  if (!message) return null;
  return (
    <p
      role={status === "error" ? "alert" : "status"}
      className={`mt-3 text-sm ${status === "error" ? "text-hot" : "text-nurture"}`}
    >
      {message}
    </p>
  );
}

function fieldError(
  errors: Readonly<Record<string, string>> | undefined,
  ...paths: string[]
) {
  return paths.map((path) => errors?.[path]).find(Boolean);
}

function DefinitionFields({
  definition,
  errors,
}: {
  definition: SmartListDefinitionV1;
  errors?: Readonly<Record<string, string>>;
}) {
  const id = useId();
  const nextKey = useRef(definition.criteria.length);
  const [criteria, setCriteria] = useState<EditorCriterion[]>(() =>
    definition.criteria.map((item, index) => editableCriterion(item, `${id}-${index}`)),
  );

  function update(index: number, patch: Partial<EditorCriterion>) {
    setCriteria((current) => current.map((item, itemIndex) =>
      itemIndex === index ? { ...item, ...patch } : item,
    ));
  }

  function changeField(index: number, field: CriterionField) {
    const current = criteria[index];
    if (!current) return;
    update(index, defaultCriterion(current.key, field));
  }

  const criteriaError = errors?.criteria;
  return (
    <div className="mt-5 border-t border-line pt-5">
      <input type="hidden" name="criteriaCount" value={criteria.length} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold text-ink">Criteria</h4>
          <p className="mt-1 text-xs text-muted">
            Every criterion must match. {criteria.length} of {SMART_LIST_CRITERIA_MAX} used.
          </p>
        </div>
        <button
          type="button"
          className="sk-text-action"
          disabled={criteria.length >= SMART_LIST_CRITERIA_MAX}
          aria-disabled={criteria.length >= SMART_LIST_CRITERIA_MAX}
          onClick={() => setCriteria((current) => [
            ...current,
            defaultCriterion(`${id}-${nextKey.current++}`),
          ])}
        >
          <Plus className="size-4" aria-hidden /> Add criterion
        </button>
      </div>
      {criteriaError ? <p role="alert" className="sk-error mt-2">{criteriaError}</p> : null}

      {criteria.length ? (
        <div className="mt-4 grid gap-3">
          {criteria.map((criterion, index) => {
            const config = FIELD_CONFIG[criterion.field];
            const error = fieldError(
              errors,
              `criteria.${index}`,
              `criteria.${index}.field`,
              `criteria.${index}.operator`,
              `criteria.${index}.value`,
            );
            const errorId = `${id}-criterion-${index}-error`;
            const valueName = `criteria.${index}.value`;
            return (
              <fieldset
                key={criterion.key}
                className="grid gap-3 rounded-2xl bg-surface-2 p-3 sm:grid-cols-[minmax(0,1fr)_10rem_minmax(0,1fr)_auto] sm:items-end"
              >
                <legend className="sr-only">Criterion {index + 1}</legend>
                <label className="sk-field">
                  <span className="sk-label">Field</span>
                  <select
                    name={`criteria.${index}.field`}
                    className="sk-input"
                    value={criterion.field}
                    onChange={(event) => changeField(index, event.target.value as CriterionField)}
                  >
                    {Object.entries(FIELD_CONFIG).map(([value, option]) => (
                      <option key={value} value={value}>{option.label}</option>
                    ))}
                  </select>
                </label>
                <label className="sk-field">
                  <span className="sk-label">Condition</span>
                  <select
                    name={`criteria.${index}.operator`}
                    className="sk-input"
                    value={criterion.operator}
                    onChange={(event) => {
                      const operator = event.target.value;
                      const value = operator === "in"
                        ? Array.isArray(criterion.value) ? criterion.value : criterion.value ? [criterion.value] : []
                        : Array.isArray(criterion.value) ? criterion.value[0] ?? "" : criterion.value;
                      update(index, { operator, value });
                    }}
                  >
                    {config.operators.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
                <label className="sk-field">
                  <span className="sk-label">Value</span>
                  {criterion.operator === "empty" ? (
                    <span className="flex min-h-11 items-center rounded-xl px-3 text-sm text-muted">
                      No value needed
                    </span>
                  ) : config.kind === "enum" ? (
                    <select
                      name={valueName}
                      className="sk-input"
                      multiple={criterion.operator === "in"}
                      size={criterion.operator === "in" ? Math.min(config.options?.length ?? 2, 5) : 1}
                      required
                      value={criterion.operator === "in"
                        ? Array.isArray(criterion.value) ? [...criterion.value] : [criterion.value]
                        : Array.isArray(criterion.value) ? criterion.value[0] ?? "" : criterion.value}
                      onChange={(event) => update(index, {
                        value: criterion.operator === "in"
                          ? Array.from(event.target.selectedOptions, (option) => option.value)
                          : event.target.value,
                      })}
                      aria-invalid={error ? true : undefined}
                      aria-describedby={error ? errorId : undefined}
                    >
                      {criterion.operator !== "in" ? <option value="">Choose a value</option> : null}
                      {config.options?.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      name={valueName}
                      type={config.kind === "number" ? "number" : config.kind === "date" ? "date" : "text"}
                      min={config.kind === "number" ? 0 : undefined}
                      step={config.kind === "number" ? "0.01" : undefined}
                      maxLength={config.kind === "text" || config.kind === "tags" ? 200 : undefined}
                      required
                      className="sk-input"
                      value={Array.isArray(criterion.value) ? criterion.value.join(", ") : criterion.value}
                      placeholder={config.kind === "tags" ? "VIP, sphere, investor" : undefined}
                      onChange={(event) => update(index, { value: event.target.value })}
                      aria-invalid={error ? true : undefined}
                      aria-describedby={error ? errorId : undefined}
                    />
                  )}
                  {config.kind === "tags" ? (
                    <span className="sk-help">Separate tags with commas.</span>
                  ) : null}
                  {config.kind === "enum" && criterion.operator === "in" ? (
                    <span className="sk-help">Use Ctrl or Command to choose multiple values.</span>
                  ) : null}
                  {error ? <span id={errorId} className="sk-error">{error}</span> : null}
                </label>
                <button
                  type="button"
                  className="sk-icon-button"
                  aria-label={`Remove criterion ${index + 1}`}
                  onClick={() => setCriteria((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                >
                  <Trash2 className="size-4" aria-hidden />
                </button>
              </fieldset>
            );
          })}
        </div>
      ) : (
        <p className="mt-4 rounded-xl border border-dashed border-line px-4 py-4 text-sm text-muted">
          No criteria means the list includes every contact.
        </p>
      )}

      <fieldset className="mt-5 grid gap-3 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold text-ink">Sort results (optional)</legend>
        <label className="sk-field">
          <span className="sk-label">Sort by</span>
          <select name="sort.field" className="sk-input" defaultValue={definition.sort?.field ?? ""}>
            <option value="">Default: hottest first</option>
            <option value="priority">Follow-up priority</option>
            <option value="name">Name</option>
            <option value="nextTouchAt">Next touch</option>
            <option value="createdAt">Date added</option>
          </select>
        </label>
        <label className="sk-field">
          <span className="sk-label">Direction</span>
          <select name="sort.direction" className="sk-input" defaultValue={definition.sort?.direction ?? "asc"}>
            <option value="asc">Ascending</option>
            <option value="desc">Descending</option>
          </select>
        </label>
        {errors?.sort ? <p role="alert" className="sk-error sm:col-span-2">{errors.sort}</p> : null}
      </fieldset>
    </div>
  );
}

function DefinitionForm({
  list,
  action,
  state,
}: {
  list?: SmartList;
  action: (payload: FormData) => void;
  state?: WorkQueueActionState;
}) {
  const definition = list?.definition ?? {
    schemaVersion: "smart-list-filter.v1",
    criteria: [],
  };
  const nameError = state?.fieldErrors?.name;
  return (
    <form action={action} className={list ? "mt-3 border-t border-line pt-4" : ""}>
      {list ? <input type="hidden" name="id" value={list.id} /> : null}
      <label className="sk-field max-w-xl">
        <span className="sk-label">List name</span>
        <input
          required
          name="name"
          autoComplete="off"
          maxLength={80}
          defaultValue={list?.name}
          className="sk-input"
          placeholder="e.g. Hot buyers"
          aria-invalid={nameError ? true : undefined}
          aria-describedby={nameError ? `${list?.id ?? "new"}-name-error` : undefined}
        />
        {nameError ? <span id={`${list?.id ?? "new"}-name-error`} className="sk-error">{nameError}</span> : null}
      </label>
      <DefinitionFields definition={definition} errors={state?.fieldErrors} />
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Submit>
          {list ? <Pencil className="size-4" aria-hidden /> : <Plus className="size-4" aria-hidden />}
          {list ? "Save definition" : "Create Smart List"}
        </Submit>
        <p className="text-xs text-muted">Definitions are validated before they are saved or applied.</p>
      </div>
      {state ? <Notice {...state} /> : null}
    </form>
  );
}

export function SmartListControls({
  lists,
  activeId,
  query,
  leadType,
  scope,
}: {
  lists: readonly SmartList[];
  activeId?: string;
  query?: string;
  leadType?: LeadType;
  scope: ContactScope;
}) {
  const [saveState, saveAction] = useActionState(
    saveSmartListAction,
    INITIAL_WORK_QUEUE_ACTION_STATE,
  );
  const [statusState, statusAction] = useActionState(
    setSmartListStatusAction,
    INITIAL_WORK_QUEUE_ACTION_STATE,
  );
  return (
    <details className="sk-form-section mb-7">
      <summary className="flex items-center gap-2">
        <ListFilter className="size-4 text-accent" aria-hidden /> Smart Lists
      </summary>
      <div className="border-t border-line bg-surface p-4 sm:p-5">
        <section aria-labelledby="create-smart-list-heading">
          <h3 id="create-smart-list-heading" className="font-display text-xl text-ink">Create a reusable view</h3>
          <p className="mt-1 text-sm text-muted">Combine up to 20 validated criteria and choose how matching contacts are ordered.</p>
          <DefinitionForm
            action={saveAction}
            state={saveState.targetId === "new" ? saveState : undefined}
          />
        </section>

        {lists.length ? (
          <ul className="mt-7 grid gap-3 border-t border-line pt-5" aria-label="Saved Smart Lists">
            {lists.map((list) => (
              <li key={list.id} className="rounded-2xl bg-surface-2 px-4 py-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-ink">{list.name}</p>
                    <p className="text-xs text-muted">
                      {list.definition.criteria.length} criterion
                      {list.definition.criteria.length === 1 ? "" : "s"} · {list.status}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {list.status === "active" ? (
                      <Link
                        href={contactViewHref({
                          scope,
                          ...(query ? { query } : {}),
                          ...(leadType ? { leadType } : {}),
                        }, { smartList: list.id })}
                        className={activeId === list.id ? "sk-primary-button" : "sk-text-action"}
                      >
                        Apply
                      </Link>
                    ) : (
                      <span className="px-2 text-xs text-subtle">Restore to apply</span>
                    )}
                    <form action={statusAction}>
                      <input type="hidden" name="id" value={list.id} />
                      <input type="hidden" name="intent" value={list.status === "archived" ? "restore" : "archive"} />
                      <Submit className="sk-icon-button">
                        {list.status === "archived" ? (
                          <RotateCcw className="size-4" aria-label={`Restore ${list.name}`} />
                        ) : (
                          <Archive className="size-4" aria-label={`Archive ${list.name}`} />
                        )}
                      </Submit>
                    </form>
                  </div>
                </div>
                <details className="mt-3">
                  <summary className="sk-text-action cursor-pointer list-none">
                    <Pencil className="size-4" aria-hidden /> Edit definition
                  </summary>
                  <DefinitionForm
                    list={list}
                    action={saveAction}
                    state={saveState.targetId === list.id ? saveState : undefined}
                  />
                </details>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-6 border-t border-line pt-5 text-sm text-muted">
            No saved Smart Lists yet. Create one to reuse a focused follow-up view.
          </p>
        )}
        <Notice {...statusState} />
      </div>
    </details>
  );
}
