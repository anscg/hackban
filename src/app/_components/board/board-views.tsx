"use client";

import {
  addDays,
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
  startOfMonth,
} from "date-fns";
import { useLayoutEffect, useMemo, useRef, useState } from "react";

import { api } from "~/trpc/react";

import { Avatar, Icon, dueState, labelStyle } from "../ui";
import { REPEAT_SHOW_DONE_MS } from "./card-front";
import { CardPopover, type PopKind } from "./card-popovers";
import { useCreateCard } from "./list-column";
import { fieldsPatch, usePatchCard } from "./optimistic";
import { type BoardData, type CardData, type ListData } from "./types";

type ViewProps = {
  board: BoardData;
  isVisible: (c: CardData) => boolean;
  onOpenCard: (id: string) => void;
  onHoverCard: (id: string | null) => void;
  readOnly: boolean;
};

const fullDate = (d: Date) => format(d, d.getFullYear() === new Date().getFullYear() ? "MMM d" : "MMM d, yyyy");

// ---------- shared ----------

type Fields = Partial<Pick<CardData, "title" | "start" | "due" | "dueComplete">>;

/** Optimistic card edits: the view updates at once and the server confirms in the background. */
function useUpdateCard(boardId: string) {
  const utils = api.useUtils();
  const patch = usePatchCard(boardId);
  const m = api.card.update.useMutation({
    onSettled: (_d, _e, v) =>
      // repeating cards read as done for a beat before rolling to their next date
      setTimeout(() => {
        void utils.board.get.invalidate({ id: boardId });
        void utils.card.get.invalidate({ id: v.id });
      }, v.dueComplete ? REPEAT_SHOW_DONE_MS : 0),
  });
  return (id: string, fields: Fields) => {
    patch(id, fieldsPatch(fields));
    m.mutate({ id, ...fields });
  };
}

/** One shared popover (members, labels, dates, move) for whichever cell was clicked. */
type Pop = { id: string; kind: PopKind; el: HTMLElement } | null;
function CellPopover({ pop, board, onClose }: { pop: Pop; board: BoardData; onClose: () => void }) {
  const { data } = api.card.get.useQuery({ id: pop?.id ?? "" }, { enabled: !!pop });
  if (!pop || data?.id !== pop.id) return null;
  return <CardPopover kind={pop.kind} anchor={{ el: pop.el }} onClose={onClose} card={data} board={board} />;
}

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

const listDot = (color: string | null) => ({ background: color ? labelStyle(color).background : "var(--color-text-subtlest)" });

function GroupHeader({ list, count, collapsed, onToggle }: { list: ListData; count: number; collapsed: boolean; onToggle: () => void }) {
  return (
    <button onClick={onToggle} aria-expanded={!collapsed} className="flex h-10 items-center gap-2 px-3 text-sm font-semibold whitespace-nowrap">
      <Icon name="chevronDown" size={16} className={`text-[var(--color-text-subtle)] transition-transform ${collapsed ? "-rotate-90" : ""}`} />
      <span className="h-3 w-3 shrink-0 rounded-full" style={listDot(list.color)} />
      {list.name}
      <span className="rounded-full bg-[var(--color-neutral)] px-1.5 text-xs leading-5 font-medium text-[var(--color-text-subtle)]">{count}</span>
    </button>
  );
}

function StatusToggle({ card, readOnly, onToggle }: { card: CardData; readOnly: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      disabled={readOnly}
      aria-label={card.dueComplete ? "Mark incomplete" : "Mark complete"}
      title={card.dueComplete ? "Complete" : "Open"}
      className={`shrink-0 rounded-full transition-transform enabled:hover:scale-110 ${card.dueComplete ? "text-[var(--color-success)]" : "text-[var(--color-text-subtle)] enabled:hover:text-[var(--color-success)]"}`}
    >
      <Icon name={card.dueComplete ? "checkCircle" : "issue"} />
    </button>
  );
}

// ---------- Table ----------

type SortKey = "title" | "start" | "due";
const time = (d: Date | null) => d?.getTime() ?? null;
const cellCls = "border-r border-b border-[var(--color-border)] p-0 last:border-r-0";
const headCls = `${cellCls} h-9 bg-[var(--color-surface)] px-2 text-left text-xs font-semibold text-[var(--color-text-subtle)]`;
// Cells are buttons that fill the cell, like GitHub's: click (or Enter) to edit.
const cellBtn = "flex h-9 w-full min-w-0 items-center gap-1.5 px-2 text-left outline-none enabled:hover:bg-[var(--color-neutral)] focus-visible:shadow-[inset_0_0_0_2px_var(--color-focus)]";

export function TableView({ board, isVisible, onOpenCard, onHoverCard, readOnly }: ViewProps) {
  const { groups, collapsed, toggle } = useGroups(board, isVisible);
  const update = useUpdateCard(board.id);
  const [pop, setPop] = useState<Pop>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
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
  const openPop = (id: string, kind: PopKind) => (e: React.MouseEvent<HTMLElement>) => setPop({ id, kind, el: e.currentTarget });
  const listOf = new Map(board.lists.map((l) => [l.id, l]));
  let n = 0;

  return (
    <div className="min-h-0 flex-1 overflow-auto bg-[var(--color-surface)] text-[var(--color-text)]">
      <table className="w-full min-w-[1000px] table-fixed border-separate border-spacing-0 text-sm">
        <colgroup>
          <col className="w-12" />
          <col />
          <col className="w-[180px]" />
          <col className="w-[160px]" />
          <col className="w-[200px]" />
          <col className="w-[120px]" />
          <col className="w-[120px]" />
        </colgroup>
        <thead className="sticky top-0 z-10">
          <tr>
            <th className={headCls} />
            <th className={headCls} aria-sort={ariaSort("title")}>{sortHead("title", "Title")}</th>
            <th className={headCls}>Assignees</th>
            <th className={headCls}>List</th>
            <th className={headCls}>Labels</th>
            <th className={headCls} aria-sort={ariaSort("start")}>{sortHead("start", "Start date")}</th>
            <th className={headCls} aria-sort={ariaSort("due")}>{sortHead("due", "Due date")}</th>
          </tr>
        </thead>
        {groups.map(({ list, cards }) => (
          <tbody key={list.id}>
            <tr>
              <td colSpan={7} className="border-b border-[var(--color-border)] bg-[var(--color-surface)] p-0">
                <GroupHeader list={list} count={cards.length} collapsed={collapsed.has(list.id)} onToggle={() => toggle(list.id)} />
              </td>
            </tr>
            {!collapsed.has(list.id) &&
              sorted(cards).map((c) => {
                const late = ["late", "overdue"].includes(dueState(c.due, c.dueComplete) ?? "");
                const cardList = listOf.get(c.listId) ?? list;
                return (
                  <tr key={c.id} data-card-id={c.id} onMouseEnter={() => onHoverCard(c.id)} onMouseLeave={() => onHoverCard(null)} className="group hover:bg-[var(--color-surface-hover)]">
                    <td className={`${cellCls} px-2 text-right text-xs text-[var(--color-text-subtlest)] tabular-nums`}>{++n}</td>
                    <td className={cellCls}>
                      <div className="flex h-9 min-w-0 items-center gap-2 px-2">
                        <StatusToggle card={c} readOnly={readOnly} onToggle={() => update(c.id, { dueComplete: !c.dueComplete })} />
                        {editing === c.id ? (
                          <TitleInput
                            initial={c.title}
                            onDone={(t) => {
                              setEditing(null);
                              if (t && t !== c.title) update(c.id, { title: t });
                            }}
                          />
                        ) : (
                          <>
                            <button onClick={() => onOpenCard(c.id)} title={c.title} className={`truncate text-left hover:text-[var(--color-brand)] hover:underline ${c.dueComplete ? "text-[var(--color-text-subtle)]" : ""}`}>
                              {c.title}
                            </button>
                            {!readOnly && (
                              <button onClick={() => setEditing(c.id)} aria-label="Edit title" className="ml-auto shrink-0 rounded p-1 text-[var(--color-text-subtle)] opacity-0 group-hover:opacity-100 hover:bg-[var(--color-neutral)] focus-visible:opacity-100">
                                <Icon name="edit" size={14} />
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                    <td className={cellCls}>
                      <button disabled={readOnly} onClick={openPop(c.id, "members")} className={cellBtn} aria-label="Edit assignees">
                        <span className="flex shrink-0 -space-x-1.5">
                          {c.members.slice(0, 3).map((m) => (
                            <Avatar key={m.userId} user={m.user} size={20} className="ring-2 ring-[var(--color-surface)]" />
                          ))}
                        </span>
                        <span className="truncate text-xs text-[var(--color-text-subtle)]">
                          {c.members.length === 1 ? c.members[0]!.user.name : c.members.length > 3 ? `+${c.members.length - 3}` : ""}
                        </span>
                      </button>
                    </td>
                    <td className={cellCls}>
                      <button disabled={readOnly} onClick={openPop(c.id, "move")} className={cellBtn} aria-label="Move to list">
                        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={listDot(cardList.color)} />
                        <span className="truncate">{cardList.name}</span>
                      </button>
                    </td>
                    <td className={cellCls}>
                      <button disabled={readOnly} onClick={openPop(c.id, "labels")} className={`${cellBtn} overflow-hidden`} aria-label="Edit labels">
                        {c.labels.map(({ label }) => (
                          <span key={label.id} title={label.name} className="h-5 max-w-[120px] min-w-6 shrink-0 truncate rounded-full px-2 text-xs leading-5 font-medium" style={labelStyle(label.color)}>
                            {label.name}
                          </span>
                        ))}
                      </button>
                    </td>
                    <td className={cellCls}>
                      <button disabled={readOnly} onClick={openPop(c.id, "dates")} className={`${cellBtn} text-[var(--color-text-subtle)]`} aria-label="Edit start date">
                        {c.start && fullDate(c.start)}
                      </button>
                    </td>
                    <td className={cellCls}>
                      <button disabled={readOnly} onClick={openPop(c.id, "dates")} className={`${cellBtn} ${late ? "font-medium text-[var(--color-danger)]" : "text-[var(--color-text-subtle)]"}`} aria-label="Edit due date">
                        {c.due && fullDate(c.due)}
                      </button>
                    </td>
                  </tr>
                );
              })}
            {!collapsed.has(list.id) && !readOnly && (
              <tr>
                <td className={cellCls} />
                <td colSpan={6} className={cellCls}>
                  {adding === list.id ? (
                    <AddItem listId={list.id} boardId={board.id} onClose={() => setAdding(null)} />
                  ) : (
                    <button onClick={() => setAdding(list.id)} className={`${cellBtn} text-[var(--color-text-subtle)] hover:text-[var(--color-text)]`}>
                      <Icon name="plus" size={14} /> Add item
                    </button>
                  )}
                </td>
              </tr>
            )}
          </tbody>
        ))}
      </table>
      {!groups.some((g) => g.cards.length) && <p className="py-10 text-center text-sm text-[var(--color-text-subtle)]">No cards match these filters.</p>}
      <CellPopover pop={pop} board={board} onClose={() => setPop(null)} />
    </div>
  );
}

const inlineInput = "h-7 w-full min-w-0 rounded-[3px] bg-[var(--color-surface)] px-1.5 text-sm shadow-[inset_0_0_0_2px_var(--color-focus)] outline-none";

function TitleInput({ initial, onDone }: { initial: string; onDone: (title: string | null) => void }) {
  const [v, setV] = useState(initial);
  return (
    <input
      autoFocus
      onFocus={(e) => e.currentTarget.select()}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => onDone(v.trim() || null)}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") onDone(null);
      }}
      className={inlineInput}
    />
  );
}

/** GitHub's "+ Add item": type a title, Enter adds it and keeps the row open for the next one. */
function AddItem({ listId, boardId, onClose }: { listId: string; boardId: string; onClose: () => void }) {
  const [title, setTitle] = useState("");
  const create = useCreateCard(listId, boardId, "bottom");
  return (
    <div className="flex h-9 items-center px-2">
      <input
        autoFocus
        value={title}
        placeholder="Type a title and press Enter"
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => !title.trim() && onClose()}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
          if (e.key === "Enter" && title.trim()) {
            create.mutate({ listId, title: title.trim() });
            setTitle("");
          }
        }}
        className={inlineInput}
      />
    </div>
  );
}

// ---------- Roadmap ----------

const ZOOMS = { Month: 32, Quarter: 10, Year: 3 } as const;
type Zoom = keyof typeof ZOOMS;
const TITLE_W = 320;

/** New due dates use the time picked last in the dates popover (see card-popovers), else noon. */
function withDueTime(d: Date) {
  let hm = "12:00";
  try {
    hm = localStorage.getItem("hackban:due-time") ?? hm;
  } catch {}
  const [h, m] = hm.split(":").map(Number);
  const r = new Date(d);
  r.setHours(h ?? 12, m ?? 0, 0, 0);
  return r;
}

type Drag = { id: string; mode: "move" | "start" | "end"; x0: number; days: number; moved: boolean };

export function RoadmapView({ board, isVisible, onOpenCard, onHoverCard, readOnly }: ViewProps) {
  const { groups, collapsed, toggle } = useGroups(board, isVisible);
  const update = useUpdateCard(board.id);
  const [zoom, setZoom] = useState<Zoom>("Quarter");
  const dw = ZOOMS[zoom];
  const scroller = useRef<HTMLDivElement>(null);
  const [port, setPort] = useState({ left: 0, width: 0 });
  const [drag, setDrag] = useState<Drag | null>(null);
  const [ghost, setGhost] = useState<{ id: string; day: number } | null>(null);

  // Plenty of room either side of the dated cards and today, so you can scroll around freely.
  const { from, days } = useMemo(() => {
    const today = new Date();
    const dates = board.lists.flatMap((l) => l.cards.flatMap((c) => [c.start, c.due].filter((d): d is Date => !!d)));
    const from = startOfMonth(addMonths(minDate([today, ...dates]), -3));
    const to = endOfMonth(addMonths(maxDate([today, ...dates]), 9));
    return { from, days: eachDayOfInterval({ start: from, end: to }) };
  }, [board]);
  const months = useMemo(() => eachMonthOfInterval({ start: from, end: days[days.length - 1]! }), [from, days]);
  const idx = (d: Date) => differenceInCalendarDays(d, from);
  const todayX = idx(new Date()) * dw;
  const width = days.length * dw;
  const lane = Math.max(0, port.width - TITLE_W); // visible timeline width

  const scrollTo = (x: number, smooth = true) => scroller.current?.scrollTo({ left: x - lane / 3, behavior: smooth ? "smooth" : "auto" });
  const syncPort = () => {
    const el = scroller.current;
    if (el) setPort({ left: el.scrollLeft, width: el.clientWidth });
  };
  // Keep today in view when zooming (and on first paint).
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    el.scrollLeft = todayX - (el.clientWidth - TITLE_W) / 3;
    syncPort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom]);

  // Header drag pans the timeline.
  const pan = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = scroller.current;
    if (!el || e.button !== 0) return;
    const x0 = e.clientX;
    const left0 = el.scrollLeft;
    const move = (ev: PointerEvent) => (el.scrollLeft = left0 - (ev.clientX - x0));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  /** Shift a card's dates by the drag, keeping start <= due. */
  const commit = (c: CardData, d: Drag) => {
    const start = c.start ?? c.due!;
    const end = c.due ?? c.start!;
    if (d.mode === "move") return update(c.id, { ...(c.start && { start: addDays(c.start, d.days) }), ...(c.due && { due: addDays(c.due, d.days) }) });
    if (d.mode === "start") return update(c.id, { start: addDays(start, d.days) });
    update(c.id, { due: c.due ? addDays(c.due, d.days) : withDueTime(addDays(end, d.days)) });
  };

  const zoomBtn = "flex h-7 items-center rounded-[3px] px-2.5 text-xs font-medium transition-colors";
  let n = 0;
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[var(--color-surface)] text-[var(--color-text)]">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-[var(--color-border)] px-3">
        <button onClick={() => scrollTo(todayX)} className={`${zoomBtn} border border-[var(--color-border)] hover:bg-[var(--color-neutral)]`}>
          Today
        </button>
        <button onClick={() => scroller.current?.scrollBy({ left: -lane / 2, behavior: "smooth" })} className={`${zoomBtn} px-1.5 hover:bg-[var(--color-neutral)]`} aria-label="Scroll back">
          <Icon name="chevronLeft" />
        </button>
        <button onClick={() => scroller.current?.scrollBy({ left: lane / 2, behavior: "smooth" })} className={`${zoomBtn} px-1.5 hover:bg-[var(--color-neutral)]`} aria-label="Scroll forward">
          <Icon name="chevronLeft" className="rotate-180" />
        </button>
        {!readOnly && <span className="ml-2 hidden text-xs text-[var(--color-text-subtle)] lg:inline">Drag a bar to move its dates, drag its ends to resize, or click an empty row to schedule it.</span>}
        <div className="flex-1" />
        <div role="group" aria-label="Zoom" className="flex rounded-[4px] border border-[var(--color-border)] p-0.5">
          {(Object.keys(ZOOMS) as Zoom[]).map((z) => (
            <button key={z} aria-pressed={zoom === z} onClick={() => setZoom(z)} className={`${zoomBtn} ${zoom === z ? "bg-[var(--color-neutral)]" : "text-[var(--color-text-subtle)] hover:text-[var(--color-text)]"}`}>
              {z}
            </button>
          ))}
        </div>
      </div>

      <div ref={scroller} onScroll={syncPort} className="min-h-0 flex-1 overflow-auto overscroll-x-contain">
        <div className="relative min-h-full text-sm" style={{ width: TITLE_W + width }}>
          {/* header: months (labels stick to the left edge while you scroll), then days or week starts */}
          <div className="sticky top-0 z-20 flex border-b border-[var(--color-border)] bg-[var(--color-surface)]">
            <div className="sticky left-0 z-10 flex shrink-0 items-end border-r border-[var(--color-border)] bg-[var(--color-surface)] px-3 pb-2 text-xs font-semibold text-[var(--color-text-subtle)]" style={{ width: TITLE_W }}>
              Title
            </div>
            <div onPointerDown={pan} className="relative h-14 cursor-grab select-none active:cursor-grabbing" style={{ width }}>
              {months.map((m) => (
                <div key={m.getTime()} className="absolute top-0 h-7 border-l border-[var(--color-border)]" style={{ left: idx(m) * dw, width: getDaysInMonth(m) * dw }}>
                  <span className="sticky inline-block truncate px-2 text-xs leading-7 font-semibold" style={{ left: TITLE_W, maxWidth: getDaysInMonth(m) * dw }}>
                    {format(m, zoom === "Year" ? "MMM yyyy" : "MMMM yyyy")}
                  </span>
                </div>
              ))}
              {zoom !== "Year" &&
                days.map((d, i) =>
                  zoom === "Month" || d.getDay() === 1 ? (
                    <span
                      key={i}
                      className={`absolute top-7 h-7 text-center text-xs leading-7 ${i === todayX / dw ? "font-bold text-[var(--color-brand)]" : "text-[var(--color-text-subtle)]"}`}
                      style={{ left: i * dw, width: zoom === "Month" ? dw : dw * 7 }}
                    >
                      {format(d, "d")}
                    </span>
                  ) : null,
                )}
              <div className="absolute bottom-0 h-2 w-0.5 bg-[var(--color-brand)]" style={{ left: todayX + dw / 2 }} />
            </div>
          </div>

          <div className="relative">
            {/* weekend shading and today line sit behind the rows */}
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
                    const first = c.start ?? c.due;
                    const last = c.due ?? c.start;
                    const s0 = first ? idx(first) : null;
                    const e0 = last ? idx(last) : null;
                    let [s, e] = [s0, e0];
                    const d = drag?.id === c.id ? drag : null;
                    if (d && s !== null && e !== null) {
                      if (d.mode === "move") [s, e] = [s + d.days, e + d.days];
                      else if (d.mode === "start") s += d.days;
                      else e += d.days;
                    }
                    const barX = s !== null ? s * dw : 0;
                    const barW = s !== null && e !== null ? (e - s + 1) * dw : 0;
                    const offLeft = s !== null && barX + barW < port.left;
                    const offRight = s !== null && barX > port.left + lane;
                    const style = labelStyle(c.labels[0]?.label.color);
                    const handle = (mode: Drag["mode"]) => (ev: React.PointerEvent) => {
                      if (readOnly || ev.button !== 0) return;
                      ev.stopPropagation();
                      (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
                      setDrag({ id: c.id, mode, x0: ev.clientX, days: 0, moved: false });
                    };
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
                          <StatusToggle card={c} readOnly={readOnly} onToggle={() => update(c.id, { dueComplete: !c.dueComplete })} />
                          <button onClick={() => onOpenCard(c.id)} title={c.title} className="truncate text-left hover:text-[var(--color-brand)] hover:underline">
                            {c.title}
                          </button>
                        </div>
                        <div
                          className={`relative ${s === null && !readOnly ? "cursor-pointer" : ""}`}
                          style={{ width }}
                          onMouseMove={s === null && !readOnly ? (ev) => setGhost({ id: c.id, day: Math.floor((ev.clientX - ev.currentTarget.getBoundingClientRect().left) / dw) }) : undefined}
                          onMouseLeave={() => setGhost(null)}
                          onClick={
                            s === null && !readOnly && ghost?.id === c.id
                              ? () => {
                                  const day = addDays(from, ghost.day);
                                  update(c.id, { start: day, due: withDueTime(addDays(day, zoom === "Month" ? 0 : 6)) });
                                  setGhost(null);
                                }
                              : undefined
                          }
                        >
                          {s === null && ghost?.id === c.id && (
                            <div className="pointer-events-none absolute top-1.5 flex h-6 items-center rounded-full border border-dashed border-[var(--color-text-subtlest)] px-2 text-xs whitespace-nowrap text-[var(--color-text-subtle)]" style={{ left: ghost.day * dw + 1, minWidth: (zoom === "Month" ? 1 : 7) * dw - 2 }}>
                              {fullDate(addDays(from, ghost.day))}
                            </div>
                          )}
                          {s !== null && (
                            <div
                              role="button"
                              tabIndex={0}
                              aria-label={`${c.title}, ${first && fullDate(first)}${last && last !== first ? ` to ${fullDate(last)}` : ""}`}
                              title={`${c.title} · ${first && fullDate(first)}${last && last !== first ? ` – ${fullDate(last)}` : ""}`}
                              onKeyDown={(ev) => ev.key === "Enter" && onOpenCard(c.id)}
                              onPointerDown={handle("move")}
                              onPointerMove={(ev) => {
                                if (!d || s0 === null || e0 === null) return;
                                const raw = Math.round((ev.clientX - d.x0) / dw);
                                // an end can't cross the other end, so start stays on or before due
                                const days = d.mode === "start" ? Math.min(raw, e0 - s0) : d.mode === "end" ? Math.max(raw, s0 - e0) : raw;
                                setDrag({ ...d, days, moved: d.moved || Math.abs(ev.clientX - d.x0) > 3 });
                              }}
                              onPointerUp={() => {
                                setDrag(null);
                                if (!d) return onOpenCard(c.id); // observers, or a click quicker than a render
                                if (!d.moved) onOpenCard(c.id);
                                else if (d.days) commit(c, d);
                              }}
                              onPointerCancel={() => setDrag(null)}
                              className={`group/bar absolute top-1.5 flex h-6 items-center rounded-full text-xs font-medium shadow-[var(--shadow-card)] select-none ${readOnly ? "cursor-pointer" : "cursor-grab active:cursor-grabbing"} ${c.dueComplete ? "opacity-60" : ""} ${d ? "z-10 ring-2 ring-[var(--color-focus)]" : ""}`}
                              style={{ ...style, left: barX + 1, width: Math.max(barW - 2, 12) }}
                            >
                              {!readOnly && (
                                <>
                                  <span onPointerDown={handle("start")} className="absolute inset-y-0 left-0 w-2 cursor-ew-resize rounded-l-full opacity-0 group-hover/bar:opacity-100 hover:bg-black/15" />
                                  <span onPointerDown={handle("end")} className="absolute inset-y-0 right-0 w-2 cursor-ew-resize rounded-r-full opacity-0 group-hover/bar:opacity-100 hover:bg-black/15" />
                                </>
                              )}
                              {barW >= 60 && <span className="truncate px-2">{c.title}</span>}
                              {/* while dragging, show where the dates will land */}
                              {d?.moved && (
                                <>
                                  <span className="absolute right-full mr-1 rounded bg-[var(--color-text)] px-1 text-[11px] leading-5 whitespace-nowrap text-[var(--color-surface)]">{fullDate(addDays(from, s))}</span>
                                  <span className="absolute left-full ml-1 rounded bg-[var(--color-text)] px-1 text-[11px] leading-5 whitespace-nowrap text-[var(--color-surface)]">{fullDate(addDays(from, e!))}</span>
                                </>
                              )}
                            </div>
                          )}
                          {s !== null && barW < 60 && !d && (
                            <span className="pointer-events-none absolute top-1.5 truncate pl-2 text-xs leading-6 text-[var(--color-text-subtle)]" style={{ left: barX + barW, maxWidth: 240 }}>
                              {c.title}
                            </span>
                          )}
                          {/* GitHub's edge arrows: jump to a bar that's scrolled out of view */}
                          {(offLeft || offRight) && (
                            <button
                              onClick={() => scrollTo(barX)}
                              aria-label="Scroll to this card's dates"
                              className="absolute top-1.5 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-[var(--color-neutral)] text-[var(--color-text-subtle)] hover:bg-[var(--color-neutral-hover)] hover:text-[var(--color-text)]"
                              style={{ left: offLeft ? port.left + 4 : port.left + lane - 28 }}
                            >
                              <Icon name="chevronLeft" size={14} className={offRight ? "rotate-180" : ""} />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
              </div>
            ))}
            {!groups.some((g) => g.cards.length) && <p className="sticky left-0 py-10 text-center text-sm text-[var(--color-text-subtle)]" style={{ width: port.width || undefined }}>No cards match these filters.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
