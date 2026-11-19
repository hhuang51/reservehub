import { useEffect, useState, type FormEvent } from "react";
import { useAuth0 } from "@auth0/auth0-react";
import useLiveUpdates from "./useLiveUpdates";
import { API_URL } from "./config";

type Closure = {
  id: number;
  date: string;
  startTime: string;
  endTime: string;
  reason: string;
};

type Props = {
  roomId: number;
  isScheduler: boolean;
};

const API = API_URL;

export default function RoomClosures({ roomId, isScheduler }: Props) {
  const { getAccessTokenSilently } = useAuth0();
  const [closures, setClosures] = useState<Closure[]>([]);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const liveRevision = useLiveUpdates();

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      setLoading(true);
      setLoadError("");

      try {
        const response = await fetch(`${API}/rooms/${roomId}/closures`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error();

        const rows: Closure[] = await response.json();
        if (!Array.isArray(rows)) throw new Error();

        if (!controller.signal.aborted) setClosures(rows);
      } catch {
        if (!controller.signal.aborted) setLoadError("Unable to load closures.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void load();
    return () => controller.abort();
  }, [roomId, revision, liveRevision]);

  async function changeClosure(path: string, method: string, body?: object) {
    setBusy(true);
    setMessage("");

    try {
      const token = await getAccessTokenSilently();
      const response = await fetch(`${API}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
      });

      if (!response.ok) {
        const result = await response.json();
        setMessage(result.error?.message ?? "Unable to update closure.");
        return;
      }

      setMessage(method === "POST" ? "Closure saved." : "Room reopened.");
      setRevision((value) => value + 1);
    } catch {
      setMessage("Could not confirm the change. Check the closure list.");
      setRevision((value) => value + 1);
    } finally {
      setBusy(false);
    }
  }

  function submitClosure(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);

    void changeClosure("/closures", "POST", {
      roomId,
      date: fields.get("date"),
      startTime: fields.get("startTime"),
      endTime: fields.get("endTime"),
      reason: fields.get("reason"),
    });
  }

  return (
    <section aria-label="Room closures">
      <h3>Room closures</h3>

      {loading ? (
        <p role="status">Loading closures...</p>
      ) : loadError ? (
        <>
          <p role="alert">{loadError}</p>
          <button type="button" onClick={() => setRevision((n) => n + 1)}>
            Try again
          </button>
        </>
      ) : closures.length === 0 ? (
        <p>No scheduled closures.</p>
      ) : (
        <ul>
          {closures.map((item) => (
            <li key={item.id}>
              {item.date} · {item.startTime}–{item.endTime} · {item.reason}{" "}
              {isScheduler && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm(`Reopen the ${item.startTime}–${item.endTime} slot on ${item.date}?`)) {
                      void changeClosure(`/closures/${item.id}/reopen`, "PATCH");
                    }
                  }}
                >
                  Reopen slot
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {isScheduler && (
        <form onSubmit={submitClosure}>
          <fieldset disabled={busy}>
            <legend>Schedule a closure</legend>
            <label>Date <input name="date" type="date" required /></label>
            <label>
              Start time
              <input name="startTime" type="time" min="09:00" max="17:00" required />
            </label>
            <label>
              End time
              <input name="endTime" type="time" min="09:00" max="17:00" required />
            </label>
            <label>
              Closure reason
              <input name="reason" maxLength={80} placeholder="Projector maintenance" required />
            </label>
            <button type="submit">Close this slot</button>
          </fieldset>
        </form>
      )}

      <p role="status">{message}</p>
    </section>
  );
}