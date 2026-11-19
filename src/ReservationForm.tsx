import { useEffect, useId, useState } from "react";
import type { FormEvent } from "react";
import { useAuth0 } from "@auth0/auth0-react";

import HolidayNotice from "./HolidayNotice";
import { API_URL } from "./config";

type ExistingBooking = {
  id: number;
  label: string;
  date: string;
  startTime: string;
  endTime: string;
};

type Props = {
  roomId: number;
  roomName: string;
  onSaved: () => void;
  existingBooking?: ExistingBooking;
};

type ReservationDraft = {
  roomId: number;
  label: string;
  date: string;
  startTime: string;
  endTime: string;
};


function validateDraft(draft: ReservationDraft): string | null {
  if (!draft.label.trim() || draft.label.trim().length > 80) {
    return "Enter a fictional reservation label between 1 and 80 characters.";
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date)) {
    return "Choose a valid date.";
  }

  const day = new Date(`${draft.date}T12:00:00Z`);

  if (
    Number.isNaN(day.getTime()) ||
    day.toISOString().slice(0, 10) !== draft.date
  ) {
    return "Choose a valid date.";
  }

  if (day.getUTCDay() === 0 || day.getUTCDay() === 6) {
    return "Rooms are open Monday through Friday.";
  }

  const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

  if (
    !timePattern.test(draft.startTime) ||
    !timePattern.test(draft.endTime)
  ) {
    return "Choose a start time and an end time.";
  }

  if (draft.startTime >= draft.endTime) {
    return "End time must be after start time.";
  }

  if (draft.startTime < "09:00" || draft.endTime > "17:00") {
    return "Choose a time between 9:00 AM and 5:00 PM.";
  }

  return null;
}

async function getErrorMessage(response: Response): Promise<string> {
  try {
    const body = await response.json();

    if (typeof body?.error?.message === "string") {
      return body.error.message;
    }
  } catch {
    // Use a fallback if the response does not contain JSON.
  }

  if (response.status === 401) {
    return "Your session has expired. Log out and log in again.";
  }

  if (response.status === 403) {
    return "Only schedulers can create or edit reservations.";
  }

  if (response.status === 409) {
    return "This time overlaps another reservation or a room closure.";
  }

  return `The server could not save this reservation (${response.status}).`;
}

export default function ReservationForm({
  roomId,
  roomName,
  onSaved,
  existingBooking,
}: Props) {
  const {
    isAuthenticated,
    isLoading: authLoading,
    getAccessTokenSilently,
  } = useAuth0();

  const fieldId = useId();
  const editing = existingBooking !== undefined;

  const [label, setLabel] = useState(existingBooking?.label ?? "");
  const [date, setDate] = useState(existingBooking?.date ?? "");
  const [startTime, setStartTime] = useState(
    existingBooking?.startTime ?? ""
  );
  const [endTime, setEndTime] = useState(existingBooking?.endTime ?? "");

  const [preview, setPreview] = useState<ReservationDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [access, setAccess] = useState<
    "checking" | "allowed" | "denied" | "error"
  >("checking");
  const [accessRetry, setAccessRetry] = useState(0);

  // Check scheduler access using the protected backend endpoint.
  useEffect(() => {
    if (authLoading) return;

    if (!isAuthenticated) {
      setAccess("denied");
      return;
    }

    const controller = new AbortController();

    async function checkAccess() {
      setAccess("checking");

      try {
        const token = await getAccessTokenSilently();

        if (controller.signal.aborted) return;

        const response = await fetch(`${API_URL}/scheduler-check`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
          signal: controller.signal,
        });

        if (controller.signal.aborted) return;

        if (response.ok) {
          setAccess("allowed");
        } else if (response.status === 403) {
          setAccess("denied");
        } else {
          setAccess("error");
        }
      } catch {
        if (!controller.signal.aborted) {
          setAccess("error");
        }
      }
    }

    void checkAccess();

    return () => controller.abort();
  }, [
    authLoading,
    isAuthenticated,
    getAccessTokenSilently,
    accessRetry,
  ]);

  // Reset the fields if a different booking is selected for editing.
  useEffect(() => {
    setLabel(existingBooking?.label ?? "");
    setDate(existingBooking?.date ?? "");
    setStartTime(existingBooking?.startTime ?? "");
    setEndTime(existingBooking?.endTime ?? "");
    setPreview(null);
    setError("");
    setSuccess("");
  }, [
    roomId,
    existingBooking?.id,
    existingBooking?.label,
    existingBooking?.date,
    existingBooking?.startTime,
    existingBooking?.endTime,
  ]);

  function clearPreview() {
    setPreview(null);
    setError("");
    setSuccess("");
  }

  function handlePreview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setError("");
    setSuccess("");

    const draft: ReservationDraft = {
      roomId,
      label: label.trim(),
      date,
      startTime,
      endTime,
    };

    const validationError = validateDraft(draft);

    if (validationError) {
      setPreview(null);
      setError(validationError);
      return;
    }

    setPreview(draft);
  }

  async function saveReservation() {
    if (!preview || saving || access !== "allowed") return;

    setSaving(true);
    setError("");
    setSuccess("");

    let saved = false;

    try {
      const token = await getAccessTokenSilently();

      const endpoint = existingBooking
        ? `${API_URL}/reservations/${existingBooking.id}`
        : `${API_URL}/reservations`;

      const response = await fetch(endpoint, {
        method: existingBooking ? "PATCH" : "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(preview),
      });

      if (!response.ok) {
        setError(await getErrorMessage(response));
        return;
      }

      setSuccess(
        `${editing ? "Updated" : "Saved"}: ${preview.label} in ` +
          `${roomName} on ${preview.date}, ` +
          `${preview.startTime}–${preview.endTime} Chicago time.`
      );

      setPreview(null);
      saved = true;

      if (!editing) {
        setLabel("");
        setDate("");
        setStartTime("");
        setEndTime("");
      }
    } catch {
      setError(
        "The save could not be confirmed. Check the room schedule before retrying."
      );
    } finally {
      setSaving(false);
    }

    if (saved) {
      onSaved();
    }
  }

  if (authLoading) {
    return <p role="status">Checking login…</p>;
  }

  if (!isAuthenticated) {
    return <p>Log in with a scheduler account to make a reservation.</p>;
  }

  if (access === "checking") {
    return <p role="status">Checking reservation permissions…</p>;
  }

  if (access === "error") {
    return (
      <div>
        <p role="alert">
          Unable to check reservation permissions. If your session has
          expired, log out and log in again.
        </p>
        <button
          type="button"
          onClick={() => setAccessRetry((value) => value + 1)}
        >
          Try again
        </button>
      </div>
    );
  }

  if (access === "denied") {
    return (
      <p>
        You have view-only access. A scheduler account is required to
        create or edit reservations.
      </p>
    );
  }

  return (
    <section aria-labelledby={`${fieldId}-heading`}>
      <h3 id={`${fieldId}-heading`}>
        {editing ? "Edit reservation" : "Plan a reservation"}
      </h3>

      <form onSubmit={handlePreview}>
        <fieldset disabled={saving}>
          <legend>Booking details</legend>

          <div style={{ marginBottom: "16px" }}>
            <label htmlFor={`${fieldId}-label`}>
              Fictional reservation label
            </label>

            <input
              id={`${fieldId}-label`}
              type="text"
              required
              maxLength={80}
              value={label}
              placeholder="Team Maple Meeting"
              onChange={(event) => {
                setLabel(event.target.value);
                clearPreview();
              }}
              style={{ display: "block", width: "100%" }}
            />
          </div>

          <div style={{ marginBottom: "16px" }}>
            <label htmlFor={`${fieldId}-date`}>Date</label>

            <input
              id={`${fieldId}-date`}
              type="date"
              required
              value={date}
              onChange={(event) => {
                setDate(event.target.value);
                clearPreview();
              }}
              style={{ display: "block", width: "100%" }}
            />
          </div>

          <HolidayNotice date={date} />

          <div style={{ marginBottom: "16px" }}>
            <label htmlFor={`${fieldId}-start`}>Start time</label>

            <input
              id={`${fieldId}-start`}
              type="time"
              required
              min="09:00"
              max="17:00"
              step="60"
              value={startTime}
              onChange={(event) => {
                setStartTime(event.target.value);
                clearPreview();
              }}
              style={{ display: "block", width: "100%" }}
            />
          </div>

          <div style={{ marginBottom: "16px" }}>
            <label htmlFor={`${fieldId}-end`}>End time</label>

            <input
              id={`${fieldId}-end`}
              type="time"
              required
              min="09:00"
              max="17:00"
              step="60"
              value={endTime}
              onChange={(event) => {
                setEndTime(event.target.value);
                clearPreview();
              }}
              style={{ display: "block", width: "100%" }}
            />
          </div>

          <p>All times are in Chicago local time.</p>

          <button type="submit">
            {editing ? "Preview changes" : "Preview reservation"}
          </button>
        </fieldset>
      </form>

      {preview && (
        <section aria-labelledby={`${fieldId}-preview-heading`}>
          <h4 id={`${fieldId}-preview-heading`}>
            Reservation preview
          </h4>

          <p>
            <strong>{preview.label}</strong> — {roomName},{" "}
            {preview.date}, {preview.startTime}–{preview.endTime}{" "}
            Chicago time.
          </p>

          <p>
            Availability is checked again when you save.
          </p>

          <button
            type="button"
            onClick={() => void saveReservation()}
            disabled={saving}
          >
            {saving
              ? "Saving…"
              : editing
                ? "Save changes"
                : "Save reservation"}
          </button>
        </section>
      )}

      {error && <p role="alert">{error}</p>}
      {success && <p role="status">{success}</p>}
    </section>
  );
}