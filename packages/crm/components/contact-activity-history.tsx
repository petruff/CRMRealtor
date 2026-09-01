import Link from "next/link";
import type { ReactNode } from "react";
import { Activity, CheckCircle2, Clock3, Globe2, Home, Mail, MessageSquare, Route, ShieldCheck } from "lucide-react";
import type { ActivityEvent, CrmTask } from "@/lib/domain/activity";
import type { OmnichannelTimeline } from "@/lib/application/omnichannel-timeline";
import { GroupedSurface } from "@/components/ui";

export function ContactActivityHistory({
  events,
  tasks,
  timeline,
}: {
  events: readonly ActivityEvent[];
  tasks: readonly CrmTask[];
  timeline?: OmnichannelTimeline;
}) {
  const ChannelIcon = ({channel}:{channel:'crm'|'email'|'text'|'website'|'property'}) => channel === 'email' ? <Mail className="size-4" aria-hidden/> : channel === 'text' ? <MessageSquare className="size-4" aria-hidden/> : channel === 'website' ? <Globe2 className="size-4" aria-hidden/> : channel === 'property' ? <Home className="size-4" aria-hidden/> : <Activity className="size-4" aria-hidden/>;
  return (
    <section className="mt-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="eyebrow">Relationship timeline</p>
          <h2 className="mt-1 font-display text-3xl text-ink">
            Every meaningful touch, in order
          </h2>
          <p className="mt-1 text-sm text-muted">
            Human-readable CRM and connected-channel evidence. Provider secrets and internal receipts stay hidden.
          </p>
        </div>
        <Link href="/activities" className="sk-text-action">
          Open work queue
        </Link>
      </div>
      {timeline ? <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><TimelineFact icon={<Route className="size-4"/>} label="Pipeline stage" value={`${timeline.stageAging.label} · ${timeline.stageAging.days} day(s)`} detail={timeline.stageAging.authority}/><TimelineFact icon={<Clock3 className="size-4"/>} label="Response" value={timeline.response.label} detail="Website response evidence" tone={timeline.response.tone}/><TimelineFact icon={<Globe2 className="size-4"/>} label="Converted from" value={timeline.sourceConversion.label} detail={timeline.sourceConversion.authority}/><TimelineFact icon={<ShieldCheck className="size-4"/>} label="Channel consent" value={timeline.consents.length?timeline.consents.map((item)=>`${item.channel.toUpperCase()}: ${item.state}`).join(' · '):'No website consent evidence'} detail="Each channel remains independent"/></div> : null}
      {tasks.length ? (
        <GroupedSurface className="mt-4">
          <ul className="grid gap-px">
            {tasks.map((task) => (
              <li
                key={task.id}
                className="flex items-start gap-3 bg-surface p-4"
              >
                <CheckCircle2
                  className={`mt-0.5 size-4 shrink-0 ${task.status === "completed" ? "text-nurture" : "text-accent"}`}
                  aria-hidden
                />
                <div>
                  <p className="text-sm font-medium text-ink">{task.title}</p>
                  <p className="mt-1 text-xs text-muted">
                    {task.status} · due{" "}
                    <time dateTime={task.dueAt}>
                      {new Intl.DateTimeFormat("en-US", {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      }).format(new Date(task.dueAt))}
                    </time>
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </GroupedSurface>
      ) : null}
      {timeline?.entries.length ? (
        <GroupedSurface className="mt-4">
          <ol className="grid gap-px" aria-label="Omnichannel relationship evidence">
            {timeline.entries.map((entry) => (
              <li
                key={entry.id}
                className="flex items-start gap-3 bg-surface p-4"
              >
                <span className={`mt-0.5 grid size-8 shrink-0 place-items-center rounded-xl ${entry.tone==='attention'?'bg-hot-soft text-hot':entry.tone==='positive'?'bg-nurture-soft text-nurture':'bg-accent-soft text-accent'}`}><ChannelIcon channel={entry.channel}/></span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-start justify-between gap-2"><p className="text-sm font-medium text-ink">{entry.title}</p><span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted">{entry.channel}</span></div>
                  <p className="mt-1 text-xs text-muted">{entry.detail}</p>
                  <p className="mt-1 text-[11px] text-muted">Evidence: {entry.authority}</p>
                  <time
                    className="mt-1 block text-xs text-muted"
                    dateTime={entry.occurredAt}
                  >
                    {new Intl.DateTimeFormat("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    }).format(new Date(entry.occurredAt))}
                  </time>
                </div>
              </li>
            ))}
          </ol>
        </GroupedSurface>
      ) : null}
      {!events.length && !tasks.length && !timeline?.entries.length ? (
        <p className="mt-4 rounded-xl border border-dashed border-line bg-surface-2/40 px-4 py-5 text-center text-sm text-subtle">
          No linked activities or tasks yet. Notes remain in their own history
          below.
        </p>
      ) : null}
    </section>
  );
}

function TimelineFact({icon,label,value,detail,tone='neutral'}:{icon:ReactNode;label:string;value:string;detail:string;tone?:'neutral'|'positive'|'attention'}){return <article className={`rounded-2xl border p-4 ${tone==='attention'?'border-hot-border bg-hot-soft':tone==='positive'?'border-nurture-border bg-nurture-soft':'border-line bg-surface'}`}><div className="flex items-center gap-2 text-muted">{icon}<span className="text-xs font-semibold uppercase tracking-[0.1em]">{label}</span></div><strong className="mt-3 block text-sm text-ink">{value}</strong><p className="mt-1 text-xs text-muted">{detail}</p></article>}
