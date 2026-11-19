import { useState } from "react";
import type { FormEvent } from "react";
import { useAuth0 } from "@auth0/auth0-react";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { API_ORIGIN } from "./config";

type Room = {
  id: number;
  name: string;
  capacity: number;
};

type Booking = {
  id: number;
  label: string;
  date: string;
  startTime: string;
  endTime: string;
};

type Preview = {
  confirmationId: string;
  roomName: string;
  expiresAt: number;
  draft: {
    roomId: number;
    label: string;
    date: string;
    startTime: string;
    endTime: string;
  };
};

type TextPart = {
  type: "text";
  text: string;
};

const SERVER = API_ORIGIN;

function isTextPart(part: unknown): part is TextPart {
  return (
    typeof part === "object" &&
    part !== null &&
    "type" in part &&
    part.type === "text" &&
    "text" in part &&
    typeof part.text === "string"
  );
}

// client.callTool() is typed as a union that includes a legacy result
// shape, so `result.content` is not known to be an array. Validate the
// result at runtime instead of trusting the type.
function readToolResult(result: unknown): { text: string; isError: boolean } {
  if (
    typeof result !== "object" ||
    result === null ||
    !("content" in result) ||
    !Array.isArray(result.content)
  ) {
    throw new Error("Unexpected tool response.");
  }

  const text = result.content
    .filter(isTextPart)
    .map((part) => part.text)
    .join("\n");

  const isError = "isError" in result && result.isError === true;

  return { text, isError };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("The server returned an unexpected response.");
  }
}

// Read a JSON body without failing on empty or HTML error pages.
async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function errorMessage(body: unknown, fallback: string): string {
  if (
    typeof body === "object" &&
    body !== null &&
    "error" in body &&
    typeof body.error === "object" &&
    body.error !== null &&
    "message" in body.error &&
    typeof body.error.message === "string"
  ) {
    return body.error.message;
  }

  return fallback;
}

function readRooms(value: unknown): Room[] {
  if (
    !Array.isArray(value) ||
    !value.every(
      (room) =>
        typeof room?.id === "number" &&
        typeof room?.name === "string" &&
        typeof room?.capacity === "number"
    )
  ) {
    throw new Error("Unexpected room response.");
  }

  return value;
}

function readBookings(value: unknown): Booking[] {
  if (
    !Array.isArray(value) ||
    !value.every(
      (booking) =>
        typeof booking?.id === "number" &&
        typeof booking?.label === "string" &&
        typeof booking?.date === "string" &&
        typeof booking?.startTime === "string" &&
        typeof booking?.endTime === "string"
    )
  ) {
    throw new Error("Unexpected schedule response.");
  }

  return value;
}

function readPreview(value: unknown): Preview {
  if (typeof value !== "object" || value === null) {
    throw new Error("Unexpected preview response.");
  }

  const item = value as Partial<Preview>;

  if (
    typeof item.confirmationId !== "string" ||
    typeof item.roomName !== "string" ||
    typeof item.expiresAt !== "number" ||
    typeof item.draft?.roomId !== "number" ||
    typeof item.draft.label !== "string" ||
    typeof item.draft.date !== "string" ||
    typeof item.draft.startTime !== "string" ||
    typeof item.draft.endTime !== "string"
  ) {
    throw new Error("Unexpected preview response.");
  }

  return item as Preview;
}

function formatChicagoTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString("en-US", {
    timeZone: "America/Chicago",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function McpPanel() {
  const { isAuthenticated, getAccessTokenSilently } = useAuth0();

  const [rooms, setRooms] = useState<Room[]>([]);
  const [available, setAvailable] = useState<Room[] | null>(null);
  const [bookings, setBookings] = useState<Booking[] | null>(null);

  const [roomId, setRoomId] = useState("");
  const [label, setLabel] = useState("");
  const [date, setDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");

  const [preview, setPreview] = useState<Preview | null>(null);
  const [scheduler, setScheduler] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function callTool(
    name: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    const token = await getAccessTokenSilently();

    const client = new Client({
      name: "reservehub-react",
      version: "1.0.0",
    });

    const transport = new StreamableHTTPClientTransport(
      new URL(`${SERVER}/mcp`),
      {
        requestInit: {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      }
    );

    try {
      await client.connect(transport);

      const { text, isError } = readToolResult(
        await client.callTool({
          name,
          arguments: args,
        })
      );

      if (isError) {
        throw new Error(text || "The tool could not complete the request.");
      }

      return parseJson(text);
    } finally {
      // A cleanup failure must not turn a successful booking into
      // a misleading failure message.
      await client.close().catch(() => {});
    }
  }

  async function run(action: () => Promise<void>) {
    if (busy) return;

    setBusy(true);
    setError("");
    setMessage("");

    try {
      await action();
    } catch (problem) {
      setError(
        problem instanceof Error
          ? problem.message
          : "The operation failed."
      );
    } finally {
      setBusy(false);
    }
  }

  function changed() {
    setPreview(null);
    setAvailable(null);
    setMessage("");
    setError("");
  }

  async function loadRooms() {
    await run(async () => {
      const result = readRooms(await callTool("search_rooms", {}));

      const token = await getAccessTokenSilently();

      const access = await fetch(`${SERVER}/api/scheduler-check`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!access.ok && access.status !== 403) {
        throw new Error("Unable to check scheduler permissions.");
      }

      setScheduler(access.ok);
      setRooms(result);
      setRoomId(result[0] ? String(result[0].id) : "");
      setLoaded(true);
      setBookings(null);
      setPreview(null);
      setAvailable(null);
    });
  }

  async function checkAvailability() {
    await run(async () => {
      if (!date || !startTime || !endTime) {
        throw new Error("Choose a date, start time, and end time.");
      }

      const result = await callTool("get_room_availability", {
        date,
        startTime,
        endTime,
      });

      setAvailable(readRooms(result));
    });
  }

  async function loadSchedule() {
    await run(async () => {
      if (!roomId) throw new Error("Choose a room.");

      const result = await callTool("list_reservations", {
        roomId: Number(roomId),
      });

      setBookings(readBookings(result));
    });
  }

  async function prepare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    await run(async () => {
      setPreview(null);

      if (!roomId) throw new Error("Choose a room.");

      const token = await getAccessTokenSilently();

      const response = await fetch(`${SERVER}/mcp/confirmations`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          roomId: Number(roomId),
          label: label.trim(),
          date,
          startTime,
          endTime,
        }),
      });

      const data = await readJson(response);

      if (!response.ok) {
        throw new Error(
          errorMessage(data, `Preview failed (${response.status}).`)
        );
      }

      setPreview(readPreview(data));
    });
  }

  async function confirm() {
    if (!preview) return;

    const selected = preview;

    await run(async () => {
      // Clear immediately: a failed or uncertain request requires
      // checking the schedule and generating a new preview.
      setPreview(null);

      if (selected.expiresAt <= Date.now()) {
        throw new Error("This preview expired. Preview again.");
      }

      try {
        await callTool("create_reservation", {
          confirmationId: selected.confirmationId,
        });
      } catch (problem) {
        // A network failure (TypeError from fetch) means the request may
        // have reached the server. Do not tell the user it failed.
        if (problem instanceof TypeError) {
          throw new Error(
            "The reservation could not be confirmed. Check the room's " +
              "reservations before trying again."
          );
        }

        throw problem;
      } finally {
        // Whatever happened, the displayed schedule may now be stale.
        setAvailable(null);
        setBookings(null);
      }

      setMessage(
        `Saved ${selected.draft.label} in ${selected.roomName} on ` +
          `${selected.draft.date}, ${selected.draft.startTime}–` +
          `${selected.draft.endTime} Chicago time.`
      );
    });
  }

  if (!isAuthenticated) {
    return <p>Log in to use the MCP reservation panel.</p>;
  }

  return (
    <section aria-labelledby="mcp-heading">
      <h2 id="mcp-heading">MCP reservation panel</h2>

      <button type="button" onClick={loadRooms} disabled={busy}>
        {loaded ? "Reload rooms" : "Load rooms"}
      </button>

      {busy && <p role="status">Working…</p>}
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}

      {loaded && rooms.length === 0 && <p>No rooms found.</p>}

      {loaded && rooms.length > 0 && (
        <>
          {!scheduler && <p>Your account has read-only access.</p>}

          <form onSubmit={prepare}>
            <fieldset disabled={busy}>
              <legend>Room and time</legend>

              <p>
                <label htmlFor="mcp-room">Room</label>
                <select
                  id="mcp-room"
                  value={roomId}
                  onChange={(event) => {
                    setRoomId(event.target.value);
                    setBookings(null);
                    changed();
                  }}
                >
                  {rooms.map((room) => (
                    <option key={room.id} value={room.id}>
                      {room.name} — {room.capacity} people
                    </option>
                  ))}
                </select>
              </p>

              <p>
                <label htmlFor="mcp-date">Date</label>
                <input
                  id="mcp-date"
                  type="date"
                  required
                  value={date}
                  onChange={(event) => {
                    setDate(event.target.value);
                    changed();
                  }}
                />
              </p>

              <p>
                <label htmlFor="mcp-start">Start time</label>
                <input
                  id="mcp-start"
                  type="time"
                  min="09:00"
                  max="17:00"
                  required
                  value={startTime}
                  onChange={(event) => {
                    setStartTime(event.target.value);
                    changed();
                  }}
                />
              </p>

              <p>
                <label htmlFor="mcp-end">End time</label>
                <input
                  id="mcp-end"
                  type="time"
                  min="09:00"
                  max="17:00"
                  required
                  value={endTime}
                  onChange={(event) => {
                    setEndTime(event.target.value);
                    changed();
                  }}
                />
              </p>

              <p>All times are in Chicago local time.</p>

              <button type="button" onClick={checkAvailability}>
                Find available rooms
              </button>{" "}

              <button type="button" onClick={loadSchedule}>
                Show selected room’s reservations
              </button>

              {scheduler && (
                <>
                  <p>
                    <label htmlFor="mcp-label">
                      Fictional reservation label
                    </label>
                    <input
                      id="mcp-label"
                      required
                      maxLength={80}
                      value={label}
                      onChange={(event) => {
                        setLabel(event.target.value);
                        changed();
                      }}
                    />
                  </p>

                  <button type="submit">Preview reservation</button>
                </>
              )}
            </fieldset>
          </form>

          {available !== null && (
            <div>
              <h3>Available rooms for this interval</h3>

              {available.length === 0 ? (
                <p>No rooms are available.</p>
              ) : (
                <ul>
                  {available.map((room) => (
                    <li key={room.id}>{room.name}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {bookings !== null && (
            <div>
              <h3>Confirmed reservations</h3>

              {bookings.length === 0 ? (
                <p>No confirmed reservations.</p>
              ) : (
                <ul>
                  {bookings.map((booking) => (
                    <li key={booking.id}>
                      {booking.label}: {booking.date},{" "}
                      {booking.startTime}–{booking.endTime}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {preview && scheduler && (
            <div>
              <h3>Confirm this reservation</h3>

              <p>
                {preview.draft.label} — {preview.roomName},{" "}
                {preview.draft.date},{" "}
                {preview.draft.startTime}–{preview.draft.endTime}
                {" "}Chicago time.
              </p>

              <p>
                This preview expires at{" "}
                {formatChicagoTime(preview.expiresAt)} Chicago time.
                Availability is checked again when you confirm.
              </p>

              <button
                type="button"
                disabled={busy}
                onClick={confirm}
              >
                Confirm and create reservation
              </button>{" "}

              <button
                type="button"
                disabled={busy}
                onClick={() => setPreview(null)}
              >
                Discard preview
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
