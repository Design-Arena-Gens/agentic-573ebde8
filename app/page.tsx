"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Target = {
  id: string;
  title: string;
  notes?: string;
  dueAtISO: string; // ISO datetime string
  locked: boolean;
  completedAtISO?: string;
  createdAtISO: string;
};

const STORAGE_KEY = "target-locker:v1:targets";

function loadTargets(): Target[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Target[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveTargets(targets: Target[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(targets));
}

function startOfTomorrow(): Date {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);
  return tomorrow;
}

function defaultTomorrowAt(hour: number, minute = 0) {
  const d = startOfTomorrow();
  d.setHours(hour, minute, 0, 0);
  return d;
}

function toLocalInputValue(d: Date) {
  // yyyy-MM-ddTHH:mm for input[type=datetime-local]
  const pad = (n: number) => String(n).padStart(2, "0");
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const mi = pad(d.getMinutes());
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

function fromLocalInputValue(v: string) {
  // treat as local time
  return new Date(v);
}

function generateICS(target: Target): string {
  const uid = `${target.id}@target-locker`;
  const start = new Date(target.dueAtISO);
  const dtStart = start
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(".000", "");
  const end = new Date(start.getTime() + 30 * 60 * 1000);
  const dtEnd = end
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(".000", "");
  const now = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(".000", "");
  const summary = target.title.replace(/\n/g, " ");
  const description = (target.notes ?? "").replace(/\n/g, " ");
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Target Locker//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${now}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${summary}`,
    description ? `DESCRIPTION:${description}` : "",
    "END:VEVENT",
    "END:VCALENDAR",
  ]
    .filter(Boolean)
    .join("\r\n");
}

function downloadICS(target: Target) {
  const ics = generateICS(target);
  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `target-${target.id}.ics`;
  a.click();
  URL.revokeObjectURL(url);
}

function requestNotificationPermission(): Promise<NotificationPermission> {
  if (typeof window === "undefined" || !("Notification" in window)) return Promise.resolve("denied");
  if (Notification.permission === "granted") return Promise.resolve("granted");
  if (Notification.permission === "denied") return Promise.resolve("denied");
  return Notification.requestPermission();
}

export default function Page() {
  const [targets, setTargets] = useState<Target[]>([]);
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [dueLocal, setDueLocal] = useState(toLocalInputValue(defaultTomorrowAt(9)));
  const timeouts = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    setTargets(loadTargets());
  }, []);

  useEffect(() => {
    saveTargets(targets);
  }, [targets]);

  // Schedule in-tab notifications for upcoming targets
  useEffect(() => {
    for (const [id, handle] of timeouts.current) {
      window.clearTimeout(handle);
      timeouts.current.delete(id);
    }

    (async () => {
      const perm = await requestNotificationPermission();
      const now = Date.now();
      if (perm !== "granted") return;
      targets
        .filter((t) => !t.completedAtISO && new Date(t.dueAtISO).getTime() > now)
        .forEach((t) => {
          const delay = Math.max(0, new Date(t.dueAtISO).getTime() - now);
          const handle = window.setTimeout(() => {
            try {
              new Notification("Target due", { body: t.title });
            } catch {}
          }, delay);
          timeouts.current.set(t.id, handle);
        });
    })();
  }, [targets]);

  const todays = useMemo(() => {
    const today = new Date();
    const start = new Date(today);
    start.setHours(0, 0, 0, 0);
    const end = new Date(today);
    end.setHours(23, 59, 59, 999);
    return targets.filter((t) => {
      const d = new Date(t.dueAtISO);
      return d >= start && d <= end;
    });
  }, [targets]);

  function addTarget() {
    const due = fromLocalInputValue(dueLocal);
    const tomorrowStart = startOfTomorrow();
    const tomorrowEnd = new Date(tomorrowStart);
    tomorrowEnd.setHours(23, 59, 59, 999);
    if (due < tomorrowStart || due > tomorrowEnd) {
      alert("Targets can only be locked for tomorrow. Adjust time.");
      return;
    }
    const now = new Date();
    const t: Target = {
      id: crypto.randomUUID(),
      title: title.trim() || "Untitled Target",
      notes: notes.trim() || undefined,
      dueAtISO: due.toISOString(),
      locked: false,
      createdAtISO: now.toISOString(),
    };
    setTargets((prev) => [t, ...prev]);
    setTitle("");
    setNotes("");
    setDueLocal(toLocalInputValue(defaultTomorrowAt(9)));
  }

  function lockTarget(id: string) {
    setTargets((prev) => prev.map((t) => (t.id === id ? { ...t, locked: true } : t)));
  }

  function unlockTarget(id: string) {
    // Only allow unlock before the due day starts
    const target = targets.find((t) => t.id === id);
    if (!target) return;
    const now = new Date();
    const startTomorrow = startOfTomorrow();
    if (now >= startTomorrow) {
      alert("Cannot unlock on or after the due day.");
      return;
    }
    setTargets((prev) => prev.map((t) => (t.id === id ? { ...t, locked: false } : t)));
  }

  function updateTitle(id: string, value: string) {
    setTargets((prev) => prev.map((t) => (t.id === id ? { ...t, title: value } : t)));
  }

  function updateNotes(id: string, value: string) {
    setTargets((prev) => prev.map((t) => (t.id === id ? { ...t, notes: value } : t)));
  }

  function updateDue(id: string, value: string) {
    const d = fromLocalInputValue(value);
    const tStart = startOfTomorrow();
    const tEnd = new Date(tStart);
    tEnd.setHours(23, 59, 59, 999);
    if (d < tStart || d > tEnd) {
      alert("Due date must remain tomorrow.");
      return;
    }
    setTargets((prev) => prev.map((t) => (t.id === id ? { ...t, dueAtISO: d.toISOString() } : t)));
  }

  function complete(id: string) {
    setTargets((prev) =>
      prev.map((t) => (t.id === id ? { ...t, completedAtISO: new Date().toISOString() } : t))
    );
    try {
      if (Notification.permission === "granted") {
        new Notification("Completed!", { body: "Great job completing your target." });
      }
    } catch {}
  }

  function deleteTarget(id: string) {
    setTargets((prev) => prev.filter((t) => t.id !== id));
  }

  function snooze(id: string, minutes: number) {
    const t = targets.find((x) => x.id === id);
    if (!t) return;
    const newDue = new Date();
    newDue.setMinutes(newDue.getMinutes() + minutes);
    // still must be tomorrow; if snooze pushes outside, clamp to tomorrow end
    const tStart = startOfTomorrow();
    const tEnd = new Date(tStart);
    tEnd.setHours(23, 59, 59, 999);
    const clamped = newDue > tEnd ? tEnd : newDue;
    updateDue(id, toLocalInputValue(clamped));
  }

  return (
    <div className="space-y-8">
      <section className="rounded-lg border bg-white p-5 shadow-sm">
        <h2 className="mb-4 text-lg font-semibold">Lock tomorrow's target</h2>
        <div className="grid gap-3">
          <label className="grid gap-1">
            <span className="text-sm font-medium">Title</span>
            <input
              className="rounded-md border px-3 py-2 outline-none focus:ring"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What will you focus on?"
            />
          </label>
          <label className="grid gap-1">
            <span className="text-sm font-medium">Notes (optional)</span>
            <textarea
              className="rounded-md border px-3 py-2 outline-none focus:ring"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Details, definition of done, etc."
              rows={3}
            />
          </label>
          <label className="grid gap-1">
            <span className="text-sm font-medium">Due time (tomorrow)</span>
            <input
              type="datetime-local"
              className="rounded-md border px-3 py-2 outline-none focus:ring"
              value={dueLocal}
              onChange={(e) => setDueLocal(e.target.value)}
            />
          </label>
          <div className="flex gap-2 pt-2">
            <button
              className="rounded-md bg-gray-900 px-4 py-2 text-white hover:bg-gray-700"
              onClick={addTarget}
            >
              Add Target
            </button>
          </div>
          <p className="text-xs text-gray-500">You can edit until you lock it. Targets must be due tomorrow.</p>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Tomorrow's targets</h2>
        {todays.length === 0 ? (
          <p className="text-sm text-gray-500">No targets yet.</p>
        ) : (
          <ul className="space-y-3">
            {todays.map((t) => (
              <li key={t.id} className="rounded-lg border bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 space-y-2">
                    <input
                      className="w-full rounded-md border px-3 py-2 text-base font-medium outline-none focus:ring disabled:opacity-75"
                      value={t.title}
                      onChange={(e) => updateTitle(t.id, e.target.value)}
                      disabled={t.locked || !!t.completedAtISO}
                    />
                    <textarea
                      className="w-full rounded-md border px-3 py-2 outline-none focus:ring disabled:opacity-75"
                      value={t.notes ?? ""}
                      onChange={(e) => updateNotes(t.id, e.target.value)}
                      placeholder="Notes"
                      rows={2}
                      disabled={t.locked || !!t.completedAtISO}
                    />
                    <div className="flex items-center gap-2">
                      <input
                        type="datetime-local"
                        className="rounded-md border px-3 py-2 outline-none focus:ring disabled:opacity-75"
                        value={toLocalInputValue(new Date(t.dueAtISO))}
                        onChange={(e) => updateDue(t.id, e.target.value)}
                        disabled={t.locked || !!t.completedAtISO}
                      />
                      <span className="text-xs text-gray-500">
                        Due {new Date(t.dueAtISO).toLocaleString()}
                      </span>
                    </div>
                    {t.completedAtISO ? (
                      <p className="text-sm text-green-700">Completed at {new Date(t.completedAtISO).toLocaleString()}</p>
                    ) : t.locked ? (
                      <p className="text-sm text-blue-700">Locked until tomorrow.</p>
                    ) : (
                      <p className="text-sm text-amber-700">Editable until you lock it.</p>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-2">
                    {!t.completedAtISO && (
                      <>
                        {!t.locked ? (
                          <button
                            className="rounded-md border border-blue-600 px-3 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-50"
                            onClick={() => lockTarget(t.id)}
                          >
                            Lock
                          </button>
                        ) : (
                          <button
                            className="rounded-md border border-amber-600 px-3 py-1.5 text-sm font-medium text-amber-700 hover:bg-amber-50"
                            onClick={() => unlockTarget(t.id)}
                          >
                            Unlock
                          </button>
                        )}
                        <button
                          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50"
                          onClick={() => downloadICS(t)}
                        >
                          Add to Calendar
                        </button>
                        <div className="flex gap-1">
                          <button
                            className="rounded-md border border-purple-600 px-2 py-1 text-xs text-purple-700 hover:bg-purple-50"
                            onClick={() => snooze(t.id, 10)}
                          >
                            Snooze 10m
                          </button>
                          <button
                            className="rounded-md border border-purple-600 px-2 py-1 text-xs text-purple-700 hover:bg-purple-50"
                            onClick={() => snooze(t.id, 30)}
                          >
                            Snooze 30m
                          </button>
                        </div>
                        <button
                          className="rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700"
                          onClick={() => complete(t.id)}
                        >
                          Mark Completed
                        </button>
                      </>
                    )}
                    <button
                      className="rounded-md bg-red-50 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-100"
                      onClick={() => deleteTarget(t.id)}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-lg border bg-white p-4">
        <h3 className="mb-2 text-sm font-semibold">Notifications</h3>
        <p className="text-sm text-gray-600">
          In-browser notifications will fire at your target time while this page is open.
          Add to your calendar for reliable reminders even when the browser is closed.
        </p>
      </section>
    </div>
  );
}
