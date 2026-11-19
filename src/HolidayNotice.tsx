import { useEffect, useState } from "react";
import { API_URL } from "./config";

type Holiday = {
  name: string;
  date: string;
};

type HolidayResponse = {
  status: "fresh" | "stale" | "unavailable";
  holidays: Holiday[];
  fetchedAt: number | null;
};

type Props = {
  date: string;
};

function isHolidayResponse(value: unknown): value is HolidayResponse {
  if (typeof value !== "object" || value === null) return false;

  const data = value as Record<string, unknown>;

  return (
    ["fresh", "stale", "unavailable"].includes(String(data.status)) &&
    (data.fetchedAt === null || typeof data.fetchedAt === "number") &&
    Array.isArray(data.holidays) &&
    data.holidays.every(
      (holiday: unknown) =>
        typeof holiday === "object" &&
        holiday !== null &&
        "name" in holiday &&
        typeof holiday.name === "string" &&
        "date" in holiday &&
        typeof holiday.date === "string"
    )
  );
}

export default function HolidayNotice({ date }: Props) {
  const year = /^\d{4}-\d{2}-\d{2}$/.test(date)
    ? date.slice(0, 4)
    : "";

  const [result, setResult] = useState<{
    year: string;
    data: HolidayResponse;
  } | null>(null);

  useEffect(() => {
    if (!year) return;

    const controller = new AbortController();

    async function load() {
      try {
        const response = await fetch(
          `${API_URL}/holidays?year=${year}`,
          { signal: controller.signal }
        );

        if (!response.ok) throw new Error("Holiday lookup failed.");

        const data: unknown = await response.json();

        if (!isHolidayResponse(data)) {
          throw new Error("Unexpected holiday response.");
        }

        if (!controller.signal.aborted) {
          setResult({ year, data });
        }
      } catch {
        if (!controller.signal.aborted) {
          setResult({
            year,
            data: {
              status: "unavailable",
              holidays: [],
              fetchedAt: null,
            },
          });
        }
      }
    }

    void load();

    return () => controller.abort();
  }, [year]);

  if (!year) return null;

  if (!result || result.year !== year) {
    return <p role="status">Checking holidays…</p>;
  }

  const { data } = result;

  if (data.status === "unavailable") {
    return (
      <p role="status">
        Holiday information is unavailable. You can still book an open slot.
      </p>
    );
  }

  const matches = data.holidays.filter((holiday) => holiday.date === date);

  return (
    <div role="status">
      {matches.length > 0 && (
        <p>
          <strong>Holiday advisory:</strong>{" "}
          {matches.map((holiday) => holiday.name).join(", ")}.
          {" "}Bookings are allowed unless the room has a scheduled closure.
        </p>
      )}

      {data.status === "stale" && (
        <p>
          Holiday information is cached and may be out of date.
        </p>
      )}

      {matches.length === 0 && data.status === "fresh" && (
        <p>No US national holiday is listed for this date.</p>
      )}
    </div>
  );
}