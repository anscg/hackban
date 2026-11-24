"use client";

import {
  addMonths,
  differenceInCalendarDays,
  eachDayOfInterval,
  eachMonthOfInterval,
  endOfMonth,
  format,
  getDaysInMonth,
  isWeekend,
  max as maxDate,
  min as minDate,
  startOfDay,
  startOfMonth,
} from "date-fns";
import { useLayoutEffect, useMemo, useRef, useState } from "react";

import { Avatar, Icon, dueState, labelStyle } from "../ui";
import { type BoardData, type CardData, type ListData } from "./types";

type ViewProps = {
  board: BoardData;
  isVisible: (c: CardData) => boolean;
  onOpenCard: (id: string) => void;
  onHoverCard: (id: string | null) => void;
};

const fullDate = (d: Date) => format(d, d.getFullYear() === new Date().getFullYear() ? "MMM d" : "MMM d, yyyy");

// ---------- shared: GitHub Projects-style groups (one per list) ----------

function useGroups(board: BoardData, isVisible: (c: CardData) => boolean) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const groups = useMemo(() => board.lists.map((list) => ({ list, cards: list.cards.filter(isVisible) })), [board, isVisible]);
  const toggle = (id: string) =>
    setCollapsed((s) => {
      const n = new Set(s);
      if (!n.delete(id)) n.add(id);
      return n;
    });
  return { groups, collapsed, toggle };
}

function GroupHeader({ list, count, collapsed, onToggle }: { list: ListData; count: number; collapsed: boolean; onToggle: () => void }) {
  return (
    <button onClick={onToggle} aria-expanded={!collapsed} className="flex h-10 items-center gap-2 px-3 text-sm font-semibold whitespace-nowrap">
      <Icon name="chevronDown" size={16} className={`text-[var(--color-text-subtle)] transition-transform ${collapsed ? "-rotate-90" : ""}`} />
      <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: list.color ? labelStyle(list.color).background : "var(--color-text-subtlest)" }} />
      {list.name}
      <span className="rounded-full bg-[var(--color-neutral)] px-1.5 text-xs leading-5 font-medium text-[var(--color-text-subtle)]">{count}</span>
    </button>
  );
}

function StatusIcon({ card }: { card: CardData }) {
  return card.dueComplete ? (
    <span title="Complete" className="text-[var(--color-success)]"><Icon name="checkCircle" /></span>
  ) : (
    <span title="Open" className="text-[var(--color-text-subtle)]"><Icon name="issue" /></span>
  );
}

const cellCls = "border-r border-b border-[var(--color-border)] px-2 last:border-r-0";
const headCls = `${cellCls} h-9 bg-[var(--color-surface)] text-left text-xs font-semibold text-[var(--color-text-subtle)]`;

// ---------- Table ----------

type SortKey = "title" | "start" | "due";
const time = (d: Date | null) => d?.getTime() ?? null;

export function TableView({ board, isVisible, onOpenCard, onHoverCard }: ViewProps) {
  const { groups, collapsed, toggle } = useGroups(board, isVisible);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 } | null>(null);
  const sorted = (cards: CardData[]) => {
    if (!sort) return cards;
    const { key, dir } = sort;
    return [...cards].sort((a, b) => {
      if (key === "title") return a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: "base" }) * dir;
      const x = time(a[key]);
      const y = time(b[key]);
      // undated cards sink to the bottom whichever way the dates run
      if (x === null || y === null) return Number(x === null) - Number(y === null);
      return (x - y) * dir;
    });
  };
  // ascending, descending, then back to board order
  const cycle = (key: SortKey) => setSort((s) => (s?.key !== key ? { key, dir: 1 } : s.dir === 1 ? { key, dir: -1 } : null));
  const sortHead = (k: SortKey, label: string) => (
    <button onClick={() => cycle(k)} className="flex w-full items-center gap-1 hover:text-[var(--color-text)]">
      {label}
      {sort?.key === k && <Icon name="sort" size={12} className={sort.dir === -1 ? "rotate-180" : ""} />}
    </button>
  );
  const ariaSort = (k: SortKey) => (sort?.key === k ? (sort.dir === 1 ? "ascending" : "descending") : undefined);
  let n = 0;

  return (
    <div className="min-h-0 flex-1 overflow-auto bg-[var(--color-surface)] text-[var(--color-text)]">
      <table className="w-full min-w-[900px] table-fixed border-separate border-spacing-0 text-sm">
        <colgroup>
          <col className="w-12" />
          <col />
          <col className="w-[180px]" />
          <col className="w-[220px]" />
          <col className="w-[120px]" />
          <col className="w-[120px]" />
        </colgroup>
        <thead className="sticky top-0 z-10">
          <tr>
            <th className={headCls} />
            <th className={headCls} aria-sort={ariaSort("title")}>{sortHead("title", "Title")}</th>
            <th className={headCls}>Assignees</th>
            <th className={headCls}>Labels</th>
            <th className={headCls} aria-sort={ariaSort("start")}>{sortHead("start", "Start date")}</th>
            <th className={headCls} aria-sort={ariaSort("due")}>{sortHead("due", "Due date")}</th>
          </tr>
        </thead>
        {groups.map(({ list, cards }) => (
          <tbody key={list.id}>
            <tr>
              <td colSpan={6} className="border-b border-[var(--color-border)] bg-[var(--color-surface)] p-0">
                <GroupHeader list={list} count={cards.length} collapsed={collapsed.has(list.id)} onToggle={() => toggle(list.id)} />
              </td>
            </tr>
            {!collapsed.has(list.id) &&
              sorted(cards).map((c) => {
                const overdue = dueState(c.due, c.dueComplete);
                return (
                  <tr
                    key={c.id}
                    data-card-id={c.id}
                    onMouseEnter={() => onHoverCard(c.id)}
                    onMouseLeave={() => onHoverCard(null)}
                    className="h-9 hover:bg-[var(--color-surface-hover)]"
                  >
                    <td className={`${cellCls} text-right text-xs text-[var(--color-text-subtlest)] tabular-nums`}>{++n}</td>
                    <td className={cellCls}>
                      <div className="flex min-w-0 items-center gap-2">
                        <StatusIcon card={c} />
                        <button onClick={() => onOpenCard(c.id)} title={c.title} className="truncate text-left hover:text-[var(--color-brand)] hover:underline">
                          {c.title}
                        </button>
                      </div>
                    </td>
                    <td className={cellCls}>
                      <div className="flex min-w-0 items-center gap-1.5">
                        <span className="flex shrink-0 -space-x-1.5">
                          {c.members.slice(0, 3).map((m) => (
                            <Avatar key={m.userId} user={m.user} size={20} className="ring-2 ring-[var(--color-surface)]" />
                          ))}
                        </span>
                        <span className="truncate text-xs text-[var(--color-text-subtle)]">
                          {c.members.length === 1 ? c.members[0]!.user.name : c.members.length > 3 ? `+${c.members.length - 3}` : ""}
                        </span>
                      </div>
                    </td>
                    <td className={cellCls}>
                      <div className="flex min-w-0 gap-1 overflow-hidden">
                        {c.labels.map(({ label }) => (
                          <span key={label.id} title={label.name} className="h-5 max-w-[120px] min-w-6 shrink-0 truncate rounded-full px-2 text-xs leading-5 font-medium" style={labelStyle(label.color)}>
                            {label.name}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className={`${cellCls} text-[var(--color-text-subtle)]`}>{c.start && fullDate(c.start)}</td>
                    <td className={`${cellCls} ${overdue === "late" || overdue === "overdue" ? "font-medium text-[var(--color-danger)]" : "text-[var(--color-text-subtle)]"}`}>
                      {c.due && fullDate(c.due)}
                    </td>
                  </tr>
                );
              })}
          </tbody>
        ))}
      </table>
      {!groups.some((g) => g.cards.length) && <p className="py-10 text-center text-sm text-[var(--color-text-subtle)]">No cards match these filters.</p>}
    </div>
  );
}

// ---------- Roadmap ----------

const ZOOMS = { Month: 32, Quarter: 10, Year: 3 } as const;
type Zoom = keyof typeof ZOOMS;
const TITLE_W = 300;

export function RoadmapView({ board, isVisible, onOpenCard, onHoverCard }: ViewProps) {
  const { groups, collapsed, toggle } = useGroups(board, isVisible);
  const [zoom, setZoom] = useState<Zoom>("Quarter");
  const dw = ZOOMS[zoom];
  const scroller = useRef<HTMLDivElement>(null);

  // A month of padding before the earliest date, a few after the latest, and always today.
  const { from, days } = useMemo(() => {
    const today = new Date();
    const dates = board.lists.flatMap((l) => l.cards.flatMap((c) => [c.start, c.due].filter((d): d is Date => !!d)));
    const from = startOfMonth(addMonths(minDate([today, ...dates]), -1));
    const to = endOfMonth(addMonths(maxDate([today, ...dates]), 3));
    return { from, days: eachDayOfInterval({ start: from, end: to }) };
  }, [board]);
  const months = useMemo(() => eachMonthOfInterval({ start: from, end: days[days.length - 1]! }), [from, days]);
  const idx = (d: Date) => differenceInCalendarDays(d, from);
  const todayX = idx(new Date()) * dw;
  const width = days.length * dw;

  const scrollToToday = () => {
    const el = scroller.current;
    if (el) el.scrollLeft = todayX - (el.clientWidth - TITLE_W) / 3;
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(scrollToToday, [zoom]);

  const zoomBtn = "flex h-7 items-center rounded-[3px] px-2.5 text-xs font-medium transition-colors";
  let n = 0;
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[var(--color-surface)] text-[var(--color-text)]">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-[var(--color-border)] px-3">
        <button onClick={scrollToToday} className={`${zoomBtn} border border-[var(--color-border)] hover:bg-[var(--color-neutral)]`}>
          Today
        </button>
        <div className="flex-1" />
        <div role="group" aria-label="Zoom" className="flex rounded-[4px] border border-[var(--color-border)] p-0.5">
          {(Object.keys(ZOOMS) as Zoom[]).map((z) => (
            <button key={z} aria-pressed={zoom === z} onClick={() => setZoom(z)} className={`${zoomBtn} ${zoom === z ? "bg-[var(--color-neutral)]" : "text-[var(--color-text-subtle)] hover:text-[var(--color-text)]"}`}>
              {z}
            </button>
          ))}
        </div>
      </div>

      <div ref={scroller} className="min-h-0 flex-1 overflow-auto">
        <div className="relative min-h-full text-sm" style={{ width: TITLE_W + width }}>
          {/* header: months, then day numbers (Month) or week starts (Quarter) */}
          <div className="sticky top-0 z-20 flex border-b border-[var(--color-border)] bg-[var(--color-surface)]">
            <div className="sticky left-0 z-10 flex shrink-0 items-end border-r border-[var(--color-border)] bg-[var(--color-surface)] px-3 pb-2 text-xs font-semibold text-[var(--color-text-subtle)]" style={{ width: TITLE_W }}>
              Title
            </div>
            <div className="relative h-14" style={{ width }}>
              {months.map((m) => (
                <div
                  key={m.getTime()}
                  className="absolute top-0 h-7 truncate border-l border-[var(--color-border)] px-2 text-xs leading-7 font-semibold"
                  style={{ left: idx(m) * dw, width: getDaysInMonth(m) * dw }}
                >
                  {format(m, zoom === "Year" ? "MMM yyyy" : "MMMM yyyy")}
                </div>
              ))}
              {zoom !== "Year" &&
                days.map((d, i) =>
                  zoom === "Month" || d.getDay() === 1 ? (
                    <span
                      key={i}
                      className={`absolute top-7 h-7 text-center text-xs leading-7 ${differenceInCalendarDays(d, new Date()) === 0 ? "font-bold text-[var(--color-brand)]" : "text-[var(--color-text-subtle)]"}`}
                      style={{ left: i * dw, width: zoom === "Month" ? dw : dw * 7 }}
                    >
                      {format(d, "d")}
                    </span>
                  ) : null,
                )}
            </div>
          </div>

          {/* body: weekend shading and today line sit behind the rows */}
          <div className="relative">
            <div className="pointer-events-none absolute inset-y-0" style={{ left: TITLE_W, width }}>
              {zoom === "Month" && days.map((d, i) => (isWeekend(d) ? <div key={i} className="absolute inset-y-0 bg-[var(--color-neutral)] opacity-50" style={{ left: i * dw, width: dw }} /> : null))}
              <div className="absolute inset-y-0 w-0.5 bg-[var(--color-brand)]" style={{ left: todayX + dw / 2 }} />
            </div>

            {groups.map(({ list, cards }) => (
              <div key={list.id}>
                <div className="border-b border-[var(--color-border)]">
                  <div className="sticky left-0 inline-block bg-[var(--color-surface)]">
                    <GroupHeader list={list} count={cards.length} collapsed={collapsed.has(list.id)} onToggle={() => toggle(list.id)} />
                  </div>
                </div>
                {!collapsed.has(list.id) &&
                  cards.map((c) => {
                    const start = c.start ?? c.due;
                    const end = c.due ?? c.start;
                    const s = start && idx(startOfDay(start));
                    const span = start && end ? Math.max(1, differenceInCalendarDays(end, start) + 1) : 0;
                    const style = labelStyle(c.labels[0]?.label.color);
                    return (
                      <div
                        key={c.id}
                        data-card-id={c.id}
                        onMouseEnter={() => onHoverCard(c.id)}
                        onMouseLeave={() => onHoverCard(null)}
                        className="group flex h-9 border-b border-[var(--color-border)] hover:bg-[var(--color-surface-hover)]/60"
                      >
                        <div className="sticky left-0 z-10 flex shrink-0 items-center gap-2 border-r border-[var(--color-border)] bg-[var(--color-surface)] px-2 group-hover:bg-[var(--color-surface-hover)]" style={{ width: TITLE_W }}>
                          <span className="w-7 shrink-0 text-right text-xs text-[var(--color-text-subtlest)] tabular-nums">{++n}</span>
                          <StatusIcon card={c} />
                          <button onClick={() => onOpenCard(c.id)} title={c.title} className="truncate text-left hover:text-[var(--color-brand)] hover:underline">
                            {c.title}
                          </button>
                        </div>
                        <div className="relative" style={{ width }}>
                          {s !== null && (
                            <button
                              onClick={() => onOpenCard(c.id)}
                              title={`${c.title}${start ? ` · ${fullDate(start)}` : ""}${end && end !== start ? ` – ${fullDate(end)}` : ""}`}
                              className={`absolute top-1.5 flex h-6 items-center truncate rounded-full px-2 text-xs font-medium shadow-[var(--shadow-card)] transition-[filter] hover:brightness-95 ${c.dueComplete ? "opacity-60" : ""}`}
                              style={{ ...style, left: s * dw + 1, width: Math.max(span * dw - 2, 12) }}
                            >
                              {/* the label sits outside bars too narrow to hold it */}
                              {span * dw >= 60 && <span className="truncate">{c.title}</span>}
                            </button>
                          )}
                          {s !== null && span * dw < 60 && (
                            <span className="pointer-events-none absolute top-1.5 truncate pl-2 text-xs leading-6 text-[var(--color-text-subtle)]" style={{ left: (s + span) * dw, maxWidth: 240 }}>
                              {c.title}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
              </div>
            ))}
            {!groups.some((g) => g.cards.length) && <p className="sticky left-0 py-10 text-center text-sm text-[var(--color-text-subtle)]" style={{ width: TITLE_W }}>No cards match these filters.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
