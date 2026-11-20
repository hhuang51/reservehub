import { lazy, Suspense, useEffect, useState } from "react";
import type { FormEvent } from "react";
import useLiveUpdates from "./useLiveUpdates";

import AuthButtons from "./AuthButtons";
import ApiCheck from "./ApiCheck";
import ReservationForm from "./ReservationForm";
import RoomSchedule from "./RoomSchedule";
import { API_URL } from "./config";

// The MCP panel pulls in the MCP SDK and zod, the largest libraries in the
// app. Load them only when someone opens the panel (D8).
const McpPanel = lazy(() => import("./McpPanel"));

type Room = {
  id: number;
  name: string;
  capacity: number;
  equipment: string[];
};


function isRoom(value: unknown): value is Room {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const room = value as Record<string, unknown>;

  return (
    typeof room.id === "number" &&
    Number.isSafeInteger(room.id) &&
    room.id > 0 &&
    typeof room.name === "string" &&
    typeof room.capacity === "number" &&
    room.capacity > 0 &&
    Array.isArray(room.equipment) &&
    room.equipment.every((item) => typeof item === "string")
  );
}

function validateAvailability(
  date: string,
  startTime: string,
  endTime: string
): string | null {
  if (!date || !startTime || !endTime) {
    return "Choose a date, start time, and end time.";
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return "Choose a valid date.";
  }

  const parsed = new Date(`${date}T12:00:00Z`);

  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== date
  ) {
    return "Choose a valid date.";
  }

  if (parsed.getUTCDay() === 0 || parsed.getUTCDay() === 6) {
    return "Rooms are open Monday through Friday.";
  }

  const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

  if (!timePattern.test(startTime) || !timePattern.test(endTime)) {
    return "Choose valid start and end times.";
  }

  if (startTime >= endTime) {
    return "End time must be after start time.";
  }

  if (startTime < "09:00" || endTime > "17:00") {
    return "Choose a time between 9:00 AM and 5:00 PM.";
  }

  return null;
}

export default function App() {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [retryCount, setRetryCount] = useState(0);

  const [search, setSearch] = useState("");
  const [minCapacity, setMinCapacity] = useState("");
  const [equipment, setEquipment] = useState("");

  const [availabilityDate, setAvailabilityDate] = useState("");
  const [availabilityStart, setAvailabilityStart] = useState("");
  const [availabilityEnd, setAvailabilityEnd] = useState("");
  const [availabilityQuery, setAvailabilityQuery] = useState("");
  const [availabilityError, setAvailabilityError] = useState("");

  const [appliedSlot, setAppliedSlot] = useState<{
    date: string;
    startTime: string;
    endTime: string;
  } | null>(null);

  // Keep the selected room separate from search results so a live
  // refresh does not remove a reservation form being edited.
  const [selectedRoom, setSelectedRoom] = useState<Room | null>(null);
  const [scheduleRefresh, setScheduleRefresh] = useState(0);

  const liveRevision = useLiveUpdates();
  const [showMcp, setShowMcp] = useState(false);

  useEffect(() => {
    const controller = new AbortController();

    async function loadRooms() {
      setLoading(true);
      setLoadError("");

      try {
        const response = await fetch(
          `${API_URL}/rooms${availabilityQuery}`,
          { signal: controller.signal }
        );

        if (!response.ok) {
          throw new Error(
            `Unable to load rooms (${response.status}). Please try again.`
          );
        }

        const data: unknown = await response.json();

        if (!Array.isArray(data) || !data.every(isRoom)) {
          throw new Error("The server returned unexpected room data.");
        }

        if (!controller.signal.aborted) {
          setRooms(data);
        }
      } catch (error) {
        if (controller.signal.aborted) return;

        setLoadError(
          error instanceof Error
            ? error.message
            : "Unable to load rooms. Please try again."
        );
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    void loadRooms();

    return () => controller.abort();
  }, [availabilityQuery, retryCount, liveRevision]);

  const filteredRooms = rooms.filter((room) => {
    const matchesName = room.name
      .toLowerCase()
      .includes(search.trim().toLowerCase());

    const matchesCapacity =
      minCapacity === "" || room.capacity >= Number(minCapacity);

    const matchesEquipment =
      equipment === "" || room.equipment.includes(equipment);

    return matchesName && matchesCapacity && matchesEquipment;
  });

  function searchAvailability(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const error = validateAvailability(
      availabilityDate,
      availabilityStart,
      availabilityEnd
    );

    if (error) {
      setAvailabilityError(error);
      return;
    }

    const params = new URLSearchParams({
      date: availabilityDate,
      startTime: availabilityStart,
      endTime: availabilityEnd,
    });

    setAvailabilityError("");
    setAvailabilityQuery(`?${params.toString()}`);
    setAppliedSlot({
      date: availabilityDate,
      startTime: availabilityStart,
      endTime: availabilityEnd,
    });
    setSelectedRoom(null);
    setRetryCount((value) => value + 1);
  }

  function clearFilters() {
    setSearch("");
    setMinCapacity("");
    setEquipment("");

    setAvailabilityDate("");
    setAvailabilityStart("");
    setAvailabilityEnd("");
    setAvailabilityQuery("");
    setAvailabilityError("");
    setAppliedSlot(null);

    setSelectedRoom(null);
    setRetryCount((value) => value + 1);
  }

  function handleReservationSaved() {
    setScheduleRefresh((value) => value + 1);
    setRetryCount((value) => value + 1);
  }

  return (
    <main
      style={{
        maxWidth: "900px",
        margin: "0 auto",
        padding: "24px",
      }}
    >
      <header>
        <h1>ReserveHub</h1>

        <AuthButtons />
        <ApiCheck />

        <p>Find a room for your next meeting or study session.</p>
        <p>
          Opening hours: Monday–Friday, 9:00 AM–5:00 PM.
          All times are in Chicago local time.
        </p>
      </header>

      <section aria-labelledby="search-heading">
        <h2 id="search-heading">Find a room</h2>

        <div style={{ marginBottom: "16px" }}>
          <label htmlFor="room-search">Search rooms</label>
          <input
            id="room-search"
            type="search"
            placeholder="Enter a room name"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            style={{ display: "block", width: "100%" }}
          />
        </div>

        <div style={{ marginBottom: "16px" }}>
          <label htmlFor="minimum-capacity">Minimum capacity</label>
          <select
            id="minimum-capacity"
            value={minCapacity}
            onChange={(event) => setMinCapacity(event.target.value)}
            style={{ display: "block", width: "100%" }}
          >
            <option value="">Any capacity</option>
            <option value="4">At least 4 people</option>
            <option value="8">At least 8 people</option>
            <option value="12">At least 12 people</option>
          </select>
        </div>

        <div style={{ marginBottom: "16px" }}>
          <label htmlFor="equipment-filter">Equipment</label>
          <select
            id="equipment-filter"
            value={equipment}
            onChange={(event) => setEquipment(event.target.value)}
            style={{ display: "block", width: "100%" }}
          >
            <option value="">Any equipment</option>
            <option value="Whiteboard">Whiteboard</option>
            <option value="TV">TV</option>
            <option value="Projector">Projector</option>
          </select>
        </div>

        <form onSubmit={searchAvailability}>
          <fieldset>
            <legend>Find an available time</legend>

            <div style={{ marginBottom: "16px" }}>
              <label htmlFor="availability-date">Date</label>
              <input
                id="availability-date"
                type="date"
                required
                value={availabilityDate}
                onChange={(event) => {
                  setAvailabilityDate(event.target.value);
                  setAvailabilityError("");
                }}
                style={{ display: "block", width: "100%" }}
              />
            </div>

            <div style={{ marginBottom: "16px" }}>
              <label htmlFor="availability-start">Start time</label>
              <input
                id="availability-start"
                type="time"
                min="09:00"
                max="17:00"
                step="60"
                required
                value={availabilityStart}
                onChange={(event) => {
                  setAvailabilityStart(event.target.value);
                  setAvailabilityError("");
                }}
                style={{ display: "block", width: "100%" }}
              />
            </div>

            <div style={{ marginBottom: "16px" }}>
              <label htmlFor="availability-end">End time</label>
              <input
                id="availability-end"
                type="time"
                min="09:00"
                max="17:00"
                step="60"
                required
                value={availabilityEnd}
                onChange={(event) => {
                  setAvailabilityEnd(event.target.value);
                  setAvailabilityError("");
                }}
                style={{ display: "block", width: "100%" }}
              />
            </div>

            {availabilityError && (
              <p role="alert">{availabilityError}</p>
            )}

            <button type="submit">Find available rooms</button>
          </fieldset>
        </form>

        <button
          type="button"
          onClick={clearFilters}
          style={{ marginTop: "16px" }}
        >
          Clear filters
        </button>
      </section>

      <section
        aria-labelledby="results-heading"
        aria-busy={loading}
        style={{ marginTop: "24px" }}
      >
        <h2 id="results-heading">Rooms</h2>

        {appliedSlot && (
          <p>
            Availability for {appliedSlot.date},{" "}
            {appliedSlot.startTime}–{appliedSlot.endTime} Chicago time.
          </p>
        )}

        {loading && <p role="status">Updating rooms…</p>}

        {loadError && (
          <div role="alert">
            <p>{loadError}</p>
            <button
              type="button"
              onClick={() => setRetryCount((value) => value + 1)}
            >
              Try again
            </button>
          </div>
        )}

        {!loading && !loadError && (
          <p role="status">
            {filteredRooms.length}{" "}
            {filteredRooms.length === 1 ? "room" : "rooms"} found
          </p>
        )}

        {!loading && !loadError && filteredRooms.length === 0 && (
          <p>
            No rooms match your search. Try another time or clear the filters.
          </p>
        )}

        {!loadError &&
          filteredRooms.map((room) => (
            <article
              key={room.id}
              style={{
                border: "1px solid #ccc",
                borderRadius: "6px",
                padding: "16px",
                marginBottom: "12px",
                backgroundColor: "#fff",
                color: "#111",
              }}
            >
              <h3>{room.name}</h3>
              <p>Capacity: {room.capacity} people</p>
              <p>
                Equipment:{" "}
                {room.equipment.length > 0
                  ? room.equipment.join(", ")
                  : "None"}
              </p>

              <button
                type="button"
                aria-expanded={selectedRoom?.id === room.id}
                aria-controls={
                  selectedRoom?.id === room.id ? "room-details" : undefined
                }
                onClick={() => setSelectedRoom(room)}
              >
                View details
              </button>
            </article>
          ))}
      </section>

      {selectedRoom && (
        <section
          id="room-details"
          aria-labelledby="room-details-heading"
          style={{
            border: "1px solid #183b63",
            borderRadius: "6px",
            padding: "16px",
            marginTop: "24px",
            backgroundColor: "#eef3fa",
            color: "#111",
          }}
        >
          <h2 id="room-details-heading">
            {selectedRoom.name} details
          </h2>

          <p>Capacity: {selectedRoom.capacity} people</p>
          <p>Equipment: {selectedRoom.equipment.join(", ") || "None"}</p>
          <p>Opening hours: 9:00 AM–5:00 PM, Monday–Friday.</p>

          <RoomSchedule
            key={`schedule-${selectedRoom.id}`}
            roomId={selectedRoom.id}
            roomName={selectedRoom.name}
            refreshCount={scheduleRefresh + liveRevision}
          />

          <ReservationForm
            key={`reservation-${selectedRoom.id}`}
            roomId={selectedRoom.id}
            roomName={selectedRoom.name}
            onSaved={handleReservationSaved}
          />

          <button
            type="button"
            onClick={() => setSelectedRoom(null)}
            style={{ marginTop: "16px" }}
          >
            Close details
          </button>
        </section>
      )}

      <hr />
      {showMcp ? (
        <Suspense fallback={<p role="status">Loading MCP panel…</p>}>
          <McpPanel />
        </Suspense>
      ) : (
        <section aria-labelledby="mcp-open-heading">
          <h2 id="mcp-open-heading">MCP reservation panel</h2>
          <button type="button" onClick={() => setShowMcp(true)}>
            Open MCP panel
          </button>
        </section>
      )}
    </main>
  );
}