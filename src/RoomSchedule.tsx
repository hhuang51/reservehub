import { useEffect, useState } from "react";
import { useAuth0 } from "@auth0/auth0-react";
import ReservationForm from "./ReservationForm";
import RoomClosures from "./RoomClosures";
import useLiveUpdates from "./useLiveUpdates";
import { API_URL } from "./config";

type Booking = {
  id: number;
  label: string;
  date: string;
  startTime: string;
  endTime: string;
};

type RoomScheduleProps = {
  roomId: number;
  refreshCount: number;
  roomName?: string;
};

const OPEN_MINUTES = 8 * 60;

function isBooking(value: unknown): value is Booking {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const booking = value as Record<string, unknown>;

  return (
    typeof booking.id === "number" &&
    typeof booking.label === "string" &&
    typeof booking.date === "string" &&
    typeof booking.startTime === "string" &&
    typeof booking.endTime === "string"
  );
}

function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

export default function RoomSchedule({
  roomId,
  refreshCount,
  roomName = `Room ${roomId}`,
}: RoomScheduleProps) {
  const { isAuthenticated, getAccessTokenSilently } = useAuth0();

  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [reloadCount, setReloadCount] = useState(0);

  const [isScheduler, setIsScheduler] = useState(false);
  const [editingBooking, setEditingBooking] = useState<Booking | null>(null);
  const [cancelingId, setCancelingId] = useState<number | null>(null);
  const [actionMessage, setActionMessage] = useState("");
  const [usageDate, setUsageDate] = useState("");
  const liveRevision = useLiveUpdates();

  // Load confirmed bookings when the room or its schedule changes.
  useEffect(() => {
    const controller = new AbortController();

    async function loadSchedule() {
      setLoading(true);
      setLoadError("");

      try {
        const response = await fetch(
          `${API_URL}/rooms/${roomId}/reservations`,
          { signal: controller.signal }
        );

        if (!response.ok) {
          throw new Error("Schedule request failed.");
        }

        const data: unknown = await response.json();

        if (!Array.isArray(data) || !data.every(isBooking)) {
          throw new Error("Unexpected schedule data.");
        }

        if (!controller.signal.aborted) {
          setBookings(data);
        }
      } catch {
        if (!controller.signal.aborted) {
          setLoadError("Unable to load this room’s schedule.");
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    void loadSchedule();
    return () => controller.abort();
  }, [roomId, refreshCount, reloadCount, liveRevision]);

  // The backend checks the signed-in user's role and write permission.
  useEffect(() => {
    const controller = new AbortController();
    setIsScheduler(false);
    setEditingBooking(null);

    async function checkScheduler() {
      if (!isAuthenticated) return;

      try {
        const token = await getAccessTokenSilently();

        const response = await fetch(`${API_URL}/scheduler-check`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        });

        if (!controller.signal.aborted) {
          setIsScheduler(response.ok);
        }
      } catch {
        if (!controller.signal.aborted) {
          setIsScheduler(false);
        }
      }
    }

    void checkScheduler();
    return () => controller.abort();
  }, [isAuthenticated, getAccessTokenSilently]);

  async function cancelBooking(booking: Booking) {
    if (!isScheduler || cancelingId !== null) return;

    const confirmed = window.confirm(
      `Cancel "${booking.label}" on ${booking.date} ` +
      `from ${booking.startTime} to ${booking.endTime}?`
    );

    if (!confirmed) return;

    setCancelingId(booking.id);
    setActionMessage("");

    try {
      const token = await getAccessTokenSilently();

      const response = await fetch(
        `${API_URL}/reservations/${booking.id}/cancel`,
        {
          method: "PATCH",
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      if (response.status === 401 || response.status === 403) {
        setIsScheduler(false);
        setActionMessage("Sign in with scheduler access to cancel a booking.");
        return;
      }

      if (!response.ok) {
        setActionMessage(`Unable to cancel the reservation (${response.status}).`);
        return;
      }

      setActionMessage(`Canceled ${booking.label}.`);
      setReloadCount((count) => count + 1);
    } catch {
      setActionMessage("Could not confirm cancellation. Check the booked times.");
      setReloadCount((count) => count + 1);
    } finally {
      setCancelingId(null);
    }
  }

  const dayOfWeek = new Date(`${usageDate}T12:00:00Z`).getUTCDay();
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

  const bookedMinutes = bookings
    .filter((booking) => booking.date === usageDate)
    .reduce((total, booking) => {
      const duration =
        timeToMinutes(booking.endTime) - timeToMinutes(booking.startTime);
      return total + duration;
    }, 0);

  const utilization = Math.round((bookedMinutes / OPEN_MINUTES) * 100);

  return (
    <section aria-labelledby="schedule-heading">
      <h3 id="schedule-heading">Booked times</h3>

      {actionMessage && <p role="status">{actionMessage}</p>}

      {loading && <p role="status">Loading schedule...</p>}

      {!loading && loadError && (
        <div>
          <p role="alert">{loadError}</p>
          <button
            type="button"
            onClick={() => setReloadCount((count) => count + 1)}
          >
            Try again
          </button>
        </div>
      )}

      {!loading && !loadError && (
        <>
          {bookings.length === 0 ? (
            <p>No reservations for this room yet.</p>
          ) : (
            <>
              <p>Times are shown in Chicago local time.</p>

              <ul>
                {bookings.map((booking) => (
                  <li key={booking.id}>
                    <strong>{booking.date}</strong> ·{" "}
                    {booking.startTime}–{booking.endTime} · {booking.label}{" "}

                    {isAuthenticated && isScheduler && (
                      <>
                        <button
                          type="button"
                          disabled={cancelingId !== null || editingBooking !== null}
                          aria-label={`Edit ${booking.label} on ${booking.date} at ${booking.startTime}`}
                          onClick={() => {
                            setActionMessage("");
                            setEditingBooking(booking);
                          }}
                        >
                          Edit reservation
                        </button>{" "}

                        <button
                          type="button"
                          disabled={cancelingId !== null || editingBooking !== null}
                          aria-label={`Cancel ${booking.label} on ${booking.date} at ${booking.startTime}`}
                          onClick={() => void cancelBooking(booking)}
                        >
                          {cancelingId === booking.id
                            ? "Canceling..."
                            : "Cancel reservation"}
                        </button>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}

          {isAuthenticated && isScheduler && editingBooking && (
            <div>
              <ReservationForm
                key={editingBooking.id}
                roomId={roomId}
                roomName={roomName}
                existingBooking={editingBooking}
                onSaved={() => {
                  setActionMessage(`Updated ${editingBooking.label}.`);
                  setEditingBooking(null);
                  setReloadCount((count) => count + 1);
                }}
              />

              <button
                type="button"
                onClick={() => setEditingBooking(null)}
              >
                Discard changes
              </button>
            </div>
          )}

          <div>
            <h3>Daily room utilization</h3>

            <label htmlFor="usage-date">Choose a date</label>
            <input
              id="usage-date"
              type="date"
              value={usageDate}
              onChange={(event) => setUsageDate(event.target.value)}
            />

            {usageDate && (
              <p role="status">
                {isWeekend
                  ? "The center is closed on weekends."
                  : `${bookedMinutes} of ${OPEN_MINUTES} minutes booked (${utilization}%).`}
              </p>
            )}
          </div>
        </>
      )}

      <RoomClosures
        key={roomId}
        roomId={roomId}
        isScheduler={isAuthenticated && isScheduler}
        />
    </section>
  );
}