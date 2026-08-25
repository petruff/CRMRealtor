import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Phone,
  MessageSquare,
  Mail,
  Cake,
  Home,
  Pencil,
} from "lucide-react";
import {
  INTENT_LABEL,
  PIPELINE_LABEL,
  RELATIONSHIP_LABEL,
  SOURCE_LABEL,
  QUALIFICATION_STATUS_LABEL,
  displayName,
  initials,
} from "@/lib/domain/contact";
import { getRepository } from "@/lib/data";
import {
  effectiveCadenceDays,
  isDormant,
} from "@/lib/domain/cadence";
import {
  daysUntilAnniversary,
  anniversaryOrdinal,
  formatHuman,
  relativeDays,
  daysBetween,
  parseDateOnly,
} from "@/lib/domain/dates";
import { Avatar, GroupedSurface, LeadBadge } from "@/components/ui";
import { AddNoteForm, ArchiveNoteForm, RecordTouchForm, RestoreNoteForm } from "@/components/contact-mutations";
import {
  addContactNoteAction,
  archiveContactNoteAction,
  recordContactTouchAction,
  restoreContactNoteAction,
} from "@/app/contact-actions";
import { ContactActivityHistory } from "@/components/contact-activity-history";
import {
  listActivityEventsCommand,
  listTasksCommand,
} from "@/lib/application/activity-commands";
import {
  listAssignmentsCommand,
  listContactCustomFieldValuesCommand,
  listContactImportSourceFactsCommand,
  listContactPointsCommand,
  listCustomFieldDefinitionsCommand,
  listHouseholdMembersCommand,
  listHouseholdsCommand,
  listRelationshipsCommand,
} from "@/lib/application/rich-contact-commands";
import type { RichContactRepository } from "@/lib/data/rich-contact-repository";
import { RichContactWorkspace, type HouseholdView } from "@/components/rich-contact-workspace";
import { GoogleEmailComposer } from "@/components/google-email-composer";
import { TextingComposer } from "@/components/texting-composer";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  supabaseTwilioOperationRepository,
  type TwilioReadinessState,
} from "@/lib/data/twilio-operation-repository";

export const dynamic = "force-dynamic";

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-t border-line py-3 first:border-0 sm:border-0">
      <dt className="text-xs font-medium text-muted">{label}</dt>
      <dd className="mt-1 text-[15px] text-ink">{value}</dd>
    </div>
  );
}

function savedMessage(saved?: string): string | undefined {
  if (saved === "created")
    return "Contact created. Their first follow-up is ready.";
  if (saved === "updated") return "Contact updated.";
  if (saved === "note") return "Note saved to the activity history.";
  if (saved === "note-archived") return "Note archived. Its original text remains in history.";
  if (saved === "note-restored") return "Note restored to the active timeline.";
  if (saved === "touch")
    return "Contact recorded. The next follow-up is scheduled.";
  if (saved === "archived") return "Contact archived. History remains available here.";
  if (saved === "restored") return "Contact restored to active work surfaces.";
  return undefined;
}

export default async function ContactDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; view?: string }>;
}) {
  const { id } = await params;
  const { saved, view } = await searchParams;
  const now = new Date();

  const repositoryContext = await getRepository();
  const { repository, activityRepository, workspaceScope, workspaceRepository } = repositoryContext;
  const contact = await repository.get(id);
  if (!contact) notFound();
  const archived = Boolean(contact.archivedAt);
  if (archived && view !== "archived") redirect(`/contacts/${encodeURIComponent(id)}?view=archived`);
  if (!archived && view === "archived") redirect(`/contacts/${encodeURIComponent(id)}`);

  const richContactRepository = "richContactRepository" in repositoryContext
    ? repositoryContext.richContactRepository as RichContactRepository | undefined
    : undefined;

  // Repository returns newest-first already.
  const [notes, archivedNotes] = await Promise.all([
    repository.notesFor(id),
    repository.notesFor(id, { archivedOnly: true }),
  ]);
  const [events, tasks, allContacts, members] = await Promise.all([
    listActivityEventsCommand(activityRepository, workspaceScope, {
      contactId: id,
      limit: 100,
    }),
    listTasksCommand(activityRepository, workspaceScope, {
      contactId: id,
      status: "all",
      limit: 100,
    }),
    repository.list({ includeArchived: true }),
    workspaceRepository.listMemberships(workspaceScope),
  ]);
  const richData = richContactRepository ? await Promise.all([
    listContactPointsCommand(richContactRepository, workspaceScope, id, true),
    listHouseholdsCommand(richContactRepository, workspaceScope, true),
    listRelationshipsCommand(richContactRepository, workspaceScope, id, true),
    listAssignmentsCommand(richContactRepository, workspaceScope, id, true),
    listCustomFieldDefinitionsCommand(richContactRepository, workspaceScope, true),
    listContactCustomFieldValuesCommand(richContactRepository, workspaceScope, id),
    listContactImportSourceFactsCommand(richContactRepository, workspaceScope, id),
  ]) : undefined;
  const googleConnection = repositoryContext.isLive
    ? (await repositoryContext.connectorRepository.listConnections(workspaceScope, { provider: "google", limit: 10 }))
      .find((connection) => ["active", "degraded"].includes(connection.status)
        && connection.grantedScopes.includes("https://www.googleapis.com/auth/gmail.send"))
    : undefined;
  const googleEmailPoint = richData?.[0].find((point) => point.type === "email" && !point.archivedAt);
  const twilioConnection = repositoryContext.isLive
    ? (await repositoryContext.connectorRepository.listConnections(workspaceScope, { provider: "twilio", limit: 10 }))
      .find((connection) => ["active", "degraded", "authorizing", "reauthorization-required"].includes(connection.status))
    : undefined;
  const twilioPhonePoint = richData?.[0].find((point) => point.type === "phone" && !point.archivedAt);
  let textingSummary: Awaited<ReturnType<ReturnType<typeof supabaseTwilioOperationRepository>["readContactSummary"]>> | undefined;
  let textingReadiness: TwilioReadinessState | undefined;
  if (twilioConnection && twilioPhonePoint) {
    try {
      const textingRepository = supabaseTwilioOperationRepository(await createSupabaseServerClient());
      [textingReadiness, textingSummary] = await Promise.all([
        textingRepository.readReadiness(workspaceScope, twilioConnection.id),
        textingRepository.readContactSummary(workspaceScope, twilioConnection.id, id, twilioPhonePoint.id),
      ]);
    } catch {
      textingReadiness = undefined;
      textingSummary = undefined;
    }
  }
  let householdViews: HouseholdView[] = [];
  if (richContactRepository && richData) {
    householdViews = await Promise.all(richData[1].map(async (household) => ({
      ...household,
      memberContactIds: (await listHouseholdMembersCommand(richContactRepository, workspaceScope, household.id)).map((membership) => membership.contactId),
    })));
  }

  const name = displayName(contact);
  const money = (n?: number) =>
    n === undefined ? undefined : `$${n.toLocaleString("en-US")}`;

  const facts: { label: string; value: string }[] = [
    { label: "Relationship", value: RELATIONSHIP_LABEL[contact.relationship] },
    { label: "Looking to", value: INTENT_LABEL[contact.intent] },
    { label: "Stage", value: PIPELINE_LABEL[contact.pipelineStage] },
    { label: "Came from", value: SOURCE_LABEL[contact.source] },
    { label: "Qualification", value: QUALIFICATION_STATUS_LABEL[contact.qualificationStatus ?? "qualified"] },
  ];

  if (contact.phone) facts.push({ label: "Phone", value: contact.phone });
  if (contact.email) facts.push({ label: "Email", value: contact.email });
  if (contact.city)
    facts.push({
      label: "Area",
      value: [contact.city, contact.state].filter(Boolean).join(", "),
    });

  const cadenceDays = isDormant(contact)
    ? null
    : effectiveCadenceDays(contact, now);
  const notice = savedMessage(saved);
  const noteAction = addContactNoteAction.bind(null, id);
  const touchAction = recordContactTouchAction.bind(null, id);

  return (
    <div>
      <Link href={archived ? "/contacts?view=archived" : "/"} className="sk-text-action mb-6">
        <ArrowLeft className="size-4" />
        {archived ? "Back to archived contacts" : "Back to today"}
      </Link>

      {notice ? (
        <p
          role="status"
          className="mb-5 rounded-2xl border border-nurture-border bg-nurture-soft px-4 py-3 text-sm text-nurture"
        >
          {notice}
        </p>
      ) : null}

      {archived ? (
        <p role="status" className="mb-5 rounded-2xl border border-warm-border bg-warm-soft px-4 py-3 text-sm text-warm">
          Explicit archived view · This record and its history are read only until restored.
        </p>
      ) : null}

      <header className="flex items-start gap-4 md:items-center">
        <Avatar initials={initials(contact)} leadType={contact.leadType} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-display text-3xl leading-tight text-ink md:text-5xl">
              {name}
            </h1>
            <LeadBadge leadType={contact.leadType} />
          </div>
          <p className="mt-1 text-sm text-muted">
            {RELATIONSHIP_LABEL[contact.relationship]} ·{" "}
            {INTENT_LABEL[contact.intent]}
          </p>
        </div>
      </header>

      {/* Actions kept large and thumb-reachable — this is the mobile lookup case she described. */}
      {!archived ? <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-1">
        {contact.phone && (
          <>
            <a href={`tel:${contact.phone}`} className="sk-primary-button">
              <Phone className="size-4" /> Call
            </a>
            <a href={`sms:${contact.phone}`} className="sk-text-action">
              <MessageSquare className="size-4" /> Text
            </a>
          </>
        )}
        {contact.email && (
          <a href={`mailto:${contact.email}`} className="sk-text-action">
            <Mail className="size-4" /> Email
          </a>
        )}
        <Link href={`/contacts/${id}/edit`} className="sk-text-action">
          <Pencil className="size-4" /> Edit
        </Link>
      </div> : null}

      {!archived && googleConnection?.remoteAccountLabel && googleEmailPoint ? (
        <GoogleEmailComposer contactId={id} connectionId={googleConnection.id}
          contactPointId={googleEmailPoint.id} from={googleConnection.remoteAccountLabel}
          to={googleEmailPoint.normalizedValue} />
      ) : null}

      {!archived && twilioConnection && twilioPhonePoint && textingReadiness?.enabled
        && (textingReadiness.readiness === "active" || textingReadiness.realNumberUatRequired) ? (
        <TextingComposer contactId={id} connectionId={twilioConnection.id}
          contactPointId={twilioPhonePoint.id} recipientPhone={twilioPhonePoint.normalizedValue}
          useCase={textingReadiness.useCase ?? "realtor.follow-up"}
          disclosureVersion={textingReadiness.disclosureVersion ?? "omnix-texting-disclosure.v1"}
          consentStatus={textingSummary?.consent?.status}
          recipientTimeZone={textingSummary?.consent?.recipientTimeZone}
          realNumberUatRequired={textingReadiness.realNumberUatRequired}
          messages={textingSummary?.messages} />
      ) : !archived && twilioConnection && twilioPhonePoint ? (
        <p role="status" className="mt-6 rounded-2xl border border-warm-border bg-warm-soft px-4 py-3 text-sm text-warm">
          Business texting is not ready yet. The workspace owner still needs to finish carrier registration and one final delivery test. Device Messages remains available separately.
        </p>
      ) : null}

      {/* Cadence */}
      <GroupedSurface className="mt-10">
        <section className="bg-surface p-5 sm:p-6">
          <h2 className="font-display text-2xl text-ink">Follow-up</h2>
          <dl className="mt-3 grid gap-x-8 sm:grid-cols-3">
            <Fact
              label="Last spoke"
              value={
                contact.lastContactedAt
                  ? relativeDays(
                      -daysBetween(parseDateOnly(contact.lastContactedAt), now),
                    )
                  : "Never"
              }
            />
            <Fact
              label="Next touch"
              value={
                contact.nextTouchAt
                  ? `${formatHuman(contact.nextTouchAt)} · ${relativeDays(daysBetween(now, parseDateOnly(contact.nextTouchAt)))}`
                  : "Not scheduled"
              }
            />
            <Fact
              label="Rhythm"
              value={
                cadenceDays === null
                  ? "Dormant"
                  : cadenceDays === 30
                    ? "Monthly follow-up"
                    : `Every ${cadenceDays} days`
              }
            />
          </dl>
          {!archived ? <RecordTouchForm action={touchAction} /> : null}
        </section>
      </GroupedSurface>

      {/* Dates worth remembering */}
      {(contact.birthdate || contact.homePurchaseDate) && (
        <GroupedSurface className="mt-4 grid gap-px sm:grid-cols-2">
          {contact.birthdate && (
            <div className="flex items-center gap-3 bg-surface p-4 sm:p-5">
              <Cake className="size-[18px] shrink-0 text-nurture" />
              <div>
                <p className="text-sm font-medium text-ink">
                  {formatHuman(contact.birthdate)}
                </p>
                <p className="text-xs text-muted">
                  Birthday ·{" "}
                  {relativeDays(daysUntilAnniversary(contact.birthdate, now))}
                </p>
              </div>
            </div>
          )}
          {contact.homePurchaseDate && (
            <div className="flex items-center gap-3 bg-surface p-4 sm:p-5">
              <Home className="size-[18px] shrink-0 text-nurture" />
              <div>
                <p className="text-sm text-ink">
                  {anniversaryOrdinal(contact.homePurchaseDate, now)} year
                  homeaversary
                </p>
                <p className="text-xs text-muted">
                  Bought {formatHuman(contact.homePurchaseDate)} ·{" "}
                  {relativeDays(
                    daysUntilAnniversary(contact.homePurchaseDate, now),
                  )}
                </p>
              </div>
            </div>
          )}
        </GroupedSurface>
      )}

      {/* Criteria */}
      {(contact.buyer || contact.seller) && (
        <GroupedSurface className="mt-4">
          <section className="bg-surface p-5 sm:p-6">
            <h2 className="font-display text-2xl text-ink">
              {contact.seller && !contact.buyer ? "Selling" : "What they want"}
            </h2>
            <dl className="mt-2 grid gap-x-6 sm:grid-cols-3">
              {contact.buyer?.priceMax && (
                <Fact
                  label="Budget"
                  value={[
                    money(contact.buyer.priceMin),
                    money(contact.buyer.priceMax),
                  ]
                    .filter(Boolean)
                    .join(" – ")}
                />
              )}
              {contact.buyer?.areas?.length ? (
                <Fact label="Areas" value={contact.buyer.areas.join(", ")} />
              ) : null}
              {contact.buyer?.beds && (
                <Fact label="Beds" value={String(contact.buyer.beds)} />
              )}
              {contact.buyer?.timeline && (
                <Fact label="Timeline" value={contact.buyer.timeline} />
              )}
              {contact.buyer?.preApproved !== undefined && (
                <Fact
                  label="Pre-approved"
                  value={
                    contact.buyer.preApproved
                      ? `Yes${contact.buyer.lender ? ` · ${contact.buyer.lender}` : ""}`
                      : "Not yet"
                  }
                />
              )}
              {contact.buyer?.mortgageType && contact.buyer.mortgageType !== "unknown" && <Fact label="Mortgage" value={contact.buyer.mortgageType.toUpperCase()} />}
              {contact.buyer?.desiredPropertyType && <Fact label="Property type" value={contact.buyer.desiredPropertyType} />}
              {contact.buyer?.currentTenure && contact.buyer.currentTenure !== "unknown" && <Fact label="Current housing" value={contact.buyer.currentTenure} />}
              {contact.seller?.propertyAddress && (
                <Fact label="Property" value={contact.seller.propertyAddress} />
              )}
              {contact.seller?.targetPrice && (
                <Fact
                  label="Target price"
                  value={money(contact.seller.targetPrice) ?? "—"}
                />
              )}
              {contact.seller?.timeline && (
                <Fact label="Timeline" value={contact.seller.timeline} />
              )}
              {contact.seller?.motivation && (
                <Fact label="Why" value={contact.seller.motivation} />
              )}
              {contact.seller?.hasPropertyToSell && contact.seller.hasPropertyToSell !== "unknown" && <Fact label="Property to sell" value={contact.seller.hasPropertyToSell} />}
              {contact.seller?.propertyType && <Fact label="Property type" value={contact.seller.propertyType} />}
              {contact.seller?.bedrooms !== undefined && <Fact label="Bedrooms" value={String(contact.seller.bedrooms)} />}
              {contact.seller?.bathrooms !== undefined && <Fact label="Bathrooms" value={String(contact.seller.bathrooms)} />}
              {contact.seller?.basement && <Fact label="Basement" value={contact.seller.basement} />}
              {contact.seller?.parking && <Fact label="Parking" value={contact.seller.parking} />}
              {contact.seller?.condition && <Fact label="Condition" value={contact.seller.condition} />}
              {contact.seller?.listingStatus && <Fact label="Listing status" value={contact.seller.listingStatus} />}
            </dl>
          </section>
        </GroupedSurface>
      )}

      {richContactRepository && richData ? (
        <RichContactWorkspace
          contact={contact}
          points={richData[0]}
          households={householdViews}
          relationships={richData[2]}
          assignments={richData[3]}
          members={members}
          contacts={allContacts}
          definitions={richData[4]}
          customValues={richData[5]}
          importedFacts={richData[6]}
          archived={archived}
          isOwner={workspaceScope.role === "owner"}
        />
      ) : (
        <p role="status" className="mt-8 rounded-2xl bg-surface-2 px-4 py-3 text-sm text-muted">Rich relationship data is not available in this workspace yet.</p>
      )}

      <ContactActivityHistory events={events} tasks={tasks} />

      {/* Notes — she said this was her favourite thing about the old CRM. */}
      <section id="notes" className="mt-10 scroll-mt-24">
        <h2 className="mb-4 font-display text-2xl text-ink">Notes</h2>
        {!archived ? <AddNoteForm action={noteAction} /> : null}
        {notes.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line bg-surface-2/40 px-4 py-5 text-center text-[13px] text-subtle">
            Nothing written down yet.
          </p>
        ) : (
          <GroupedSurface>
            <ol className="grid gap-px">
              {notes.map((note) => (
                <li key={note.id} className="bg-surface p-4 sm:p-5">
                  <p className="text-sm leading-relaxed text-ink">
                    {note.body}
                  </p>
                  <p className="mt-2 text-[11px] text-subtle">
                    {formatHuman(note.createdAt)}
                  </p>
                  {!archived ? <details className="mt-3"><summary className="cursor-pointer text-sm font-medium text-muted">Archive this note</summary>
                    <ArchiveNoteForm action={archiveContactNoteAction.bind(null, id, note.id)} />
                  </details> : null}
                </li>
              ))}
            </ol>
          </GroupedSurface>
        )}
        {archivedNotes.length ? <details className="mt-5 rounded-xl border border-line bg-surface-2 p-4">
          <summary className="cursor-pointer font-medium text-ink">Archived notes ({archivedNotes.length})</summary>
          <ol className="mt-4 grid gap-3">
            {archivedNotes.map((note) => <li key={note.id} className="rounded-xl border border-line bg-surface p-4">
              <p className="text-sm leading-relaxed text-ink">{note.body}</p>
              <p className="mt-2 text-xs text-muted">Archived {note.archivedAt ? formatHuman(note.archivedAt) : "previously"} · {note.archiveReason}</p>
              {!archived ? <RestoreNoteForm action={restoreContactNoteAction.bind(null, id, note.id)} /> : null}
            </li>)}
          </ol>
        </details> : null}
      </section>
    </div>
  );
}
