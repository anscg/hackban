"use client";

import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { useMemo, useState } from "react";

import { Avatar, Icon, dueState, dueStyles, labelStyle } from "../ui";
import { type BoardData, type CardData } from "./types";

type ViewProps = {
  board: BoardData;
  isVisible: (c: CardData) => boolean;
  onOpenCard: (id: string) => void;
  onHoverCard: (id: string | null) => void;
};

const shortDate = (d: Date) => format(d, d.getFullYear() === new Date().getFullYear() ? "MMM d" : "MMM d, yyyy");

// ---------- Table ----------

type SortKey = "list" | "title" | "due";
const COLS: [SortKey | null, string, string][] = [
  ["title", "Card", "w-[34%]"],
  ["list", "List", "w-[16%]"],
  [null, "Labels", "w-[20%]"],
  [null, "Members", "w-[14%]"],
  ["due", "Due", "w-[16%]"],
];

export function TableView({ board, isVisible, onOpenCard, onHoverCard }: ViewProps) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "list", dir: 1 });
  const rows = useMemo(() => {
    type Row = { c: CardData; list: string; li: number };
    const all: Row[] = board.lists.flatMap((l, li) => l.cards.filter(isVisible).map((c) => ({ c, list: l.name, li })));
    const { key, dir } = sort;
    return all.sort((a, b) => {
      if (key === "list") return (a.li - b.li) * dir;
      if (key === "title") return a.c.title.localeCompare(b.c.title, undefined, { numeric: true, sensitivity: "base" }) * dir;
      // undated cards always sink to the bottom, whichever way the dates run
      if (!a.c.due || !b.c.due) return Number(!a.c.due) - Number(!b.c.due);
      return (a.c.due.getTime() - b.c.due.getTime()) * dir;
    });
  }, [board, isVisible, sort]);

  return (
    <div className="min-h-0 flex-1 overflow-auto p-3">
      <div className="mx-auto max-w-6xl overflow-clip rounded-xl bg-[var(--color-surface)] shadow-[var(--shadow-card)]">
        <table className="w-full table-fixed text-sm">
          <thead className="sticky top-0 z-10 bg-[var(--color-surface)]">
            <tr className="border-b border-[var(--color-border)] text-left text-[11px] font-semibold tracking-wide text-[var(--color-text-subtle)] uppercase">
              {COLS.map(([key, label, w]) => (
                <th key={label} className={`${w} px-3 py-2.5 font-semibold`} aria-sort={key && sort.key === key ? (sort.dir === 1 ? "ascending" : "descending") : undefined}>
                  {key ? (
                    <button
                      onClick={() => setSort((s) => ({ key, dir: s.key === key ? (-s.dir as 1 | -1) : 1 }))}
                      className={`flex items-center gap-1 uppercase hover:text-[var(--color-text)] ${sort.key === key ? "text-[var(--color-text)]" : ""}`}
                    >
                      {label}
                      {sort.key === key && <Icon name="chevronDown" size={14} className={sort.dir === -1 ? "rotate-180" : ""} />}
                    </button>
                  ) : (
                    label
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ c, list }) => {
              const due = dueState(c.due, c.dueComplete);
              return (
                <tr
                  key={c.id}
                  data-card-id={c.id}
                  tabIndex={0}
                  onClick={() => onOpenCard(c.id)}
                  onKeyDown={(e) => e.key === "Enter" && e.currentTarget === e.target && onOpenCard(c.id)}
                  onMouseEnter={() => onHoverCard(c.id)}
                  onMouseLeave={() => onHoverCard(null)}
                  className="cursor-pointer border-b border-[var(--color-border)] transition-colors last:border-0 hover:bg-[var(--color-surface-hover)] focus-visible:bg-[var(--color-surface-hover)] focus-visible:outline-none"
                >
                  <td className={`truncate px-3 py-2.5 font-medium ${c.dueComplete ? "text-[var(--color-text-subtle)] line-through" : ""}`} title={c.title}>
                    {c.title}
                  </td>
                  <td className="truncate px-3 py-2.5 text-[var(--color-text-subtle)]">{list}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {c.labels.map(({ label }) => (
                        <span key={label.id} title={label.name} className="h-5 max-w-full min-w-8 truncate rounded-[3px] px-1.5 text-xs leading-5 font-medium" style={labelStyle(label.color)}>
                          {label.name}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex -space-x-1.5">
                      {c.members.slice(0, 4).map((m) => (
                        <Avatar key={m.userId} user={m.user} size={24} className="ring-2 ring-[var(--color-surface)]" />
                      ))}
                      {c.members.length > 4 && <span className="pl-2.5 text-xs leading-6 text-[var(--color-text-subtle)]">+{c.members.length - 4}</span>}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    {c.due && (
                      <span className={`inline-flex h-6 items-center gap-1 rounded-[3px] px-1.5 text-xs ${due ? dueStyles[due] : ""}`}>
                        <Icon name="clock" size={13} /> {shortDate(c.due)}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!rows.length && <p className="px-3 py-10 text-center text-sm text-[var(--color-text-subtle)]">No cards to show.</p>}
      </div>
    </div>
  );
}

// ---------- Calendar ----------

const dayKey = (d: Date) => format(d, "yyyy-MM-dd");

export function CalendarView({ board, isVisible, onOpenCard, onHoverCard }: ViewProps) {
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const days = useMemo(() => eachDayOfInterval({ start: startOfWeek(month), end: endOfWeek(endOfMonth(month)) }), [month]);
  // Cards land on their due date, or their start date when they have no due date.
  const { byDay, undated } = useMemo(() => {
    const byDay = new Map<string, CardData[]>();
    let undated = 0;
    for (const c of board.lists.flatMap((l) => l.cards).filter(isVisible)) {
      const d = c.due ?? c.start;
      if (!d) {
        undated++;
        continue;
      }
      const k = dayKey(d);
      byDay.set(k, [...(byDay.get(k) ?? []), c]);
    }
    for (const cards of byDay.values()) cards.sort((a, b) => (a.due ?? a.start)!.getTime() - (b.due ?? b.start)!.getTime());
    return { byDay, undated };
  }, [board, isVisible]);

  const navBtn = "flex h-8 items-center justify-center rounded-[3px] px-2.5 text-sm font-medium text-white transition-colors hover:bg-white/20";
  return (
    <div className="flex min-h-0 flex-1 flex-col p-3 pt-2">
      <div className="mb-2 flex items-center gap-1">
        <button onClick={() => setMonth((m) => addMonths(m, -1))} className={`${navBtn} w-8 px-0`} aria-label="Previous month">
          <Icon name="chevronLeft" />
        </button>
        <button onClick={() => setMonth((m) => addMonths(m, 1))} className={`${navBtn} w-8 px-0`} aria-label="Next month">
          <Icon name="chevronLeft" className="rotate-180" />
        </button>
        <h2 className="ml-1 text-lg font-bold text-white drop-shadow-sm">{format(month, "MMMM yyyy")}</h2>
        <button onClick={() => setMonth(startOfMonth(new Date()))} className={`${navBtn} ml-2 bg-white/20`}>
          Today
        </button>
        <div className="flex-1" />
        {undated > 0 && <span className="text-xs text-white/80">{undated} card{undated === 1 ? "" : "s"} without dates</span>}
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-auto rounded-xl bg-[var(--color-surface)] shadow-[var(--shadow-card)]">
        <div className="sticky top-0 z-10 grid grid-cols-7 border-b border-[var(--color-border)] bg-[var(--color-surface)]">
          {days.slice(0, 7).map((d) => (
            <div key={d.getDay()} className="px-2 py-2 text-[11px] font-semibold tracking-wide text-[var(--color-text-subtle)] uppercase">
              {format(d, "EEE")}
            </div>
          ))}
        </div>
        <div className="grid flex-1 grid-cols-7" style={{ gridTemplateRows: `repeat(${days.length / 7}, minmax(6rem, 1fr))` }}>
          {days.map((d, i) => {
            const cards = byDay.get(dayKey(d)) ?? [];
            const inMonth = isSameMonth(d, month);
            return (
              <div
                key={d.getTime()}
                className={`flex min-w-0 flex-col gap-1 overflow-y-auto p-1.5 ${i % 7 ? "border-l" : ""} ${i >= 7 ? "border-t" : ""} border-[var(--color-border)] ${inMonth ? "" : "bg-[var(--color-neutral)]/40"}`}
              >
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center self-end rounded-full text-xs font-medium ${
                    isToday(d) ? "bg-[var(--color-brand)] text-[var(--color-on-brand)]" : inMonth ? "text-[var(--color-text)]" : "text-[var(--color-text-subtlest)]"
                  }`}
                >
                  {format(d, "d")}
                </span>
                {cards.map((c) => {
                  const due = c.due && dueState(c.due, c.dueComplete);
                  const label = c.labels[0]?.label;
                  return (
                    <button
                      key={c.id}
                      data-card-id={c.id}
                      onClick={() => onOpenCard(c.id)}
                      onMouseEnter={() => onHoverCard(c.id)}
                      onMouseLeave={() => onHoverCard(null)}
                      title={c.title}
                      className={`flex shrink-0 items-center gap-1.5 truncate rounded-[3px] bg-[var(--color-neutral)] px-1.5 py-1 text-left text-xs font-medium transition-colors hover:bg-[var(--color-neutral-hover)] ${
                        c.dueComplete ? "text-[var(--color-text-subtle)] line-through" : ""
                      }`}
                    >
                      {/* first label's color as a dot; overdue cards get the due-state tint instead */}
                      <span
                        className={`h-2 w-2 shrink-0 rounded-full ${due && due !== "later" ? dueStyles[due] : ""}`}
                        style={due && due !== "later" ? undefined : label ? { background: labelStyle(label.color).background } : { background: "var(--color-text-subtlest)" }}
                      />
                      <span className="truncate">{c.title}</span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
