import { useEffect, useState } from "react";
import { API_URL } from "./config";

export default function useLiveUpdates() {
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const stream = new EventSource(`${API_URL}/events`);

    let lastRevision: string | null = null;

    stream.onopen = () => {
      // Accept the initial snapshot notification after every reconnect.
      lastRevision = null;
    };

    stream.onmessage = (event) => {
      try {
        const data: unknown = JSON.parse(event.data);

        if (
          typeof data !== "object" ||
          data === null ||
          !("revision" in data) ||
          typeof data.revision !== "string"
        ) {
          return;
        }

        if (data.revision === lastRevision) return;

        lastRevision = data.revision;
        setRevision((value) => value + 1);
      } catch {
        // Ignore malformed notifications.
      }
    };

    // EventSource handles reconnection automatically.
    return () => stream.close();
  }, []);

  return revision;
}