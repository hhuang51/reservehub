import { useState } from "react";
import { useAuth0 } from "@auth0/auth0-react";
import { API_URL } from "./config";

function ApiCheck() {
  const { isAuthenticated, getAccessTokenSilently } = useAuth0();

  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function checkAccess() {
    setChecking(true);
    setMessage("");
    setError("");

    try {
      const token = await getAccessTokenSilently();

      const response = await fetch(
        `${API_URL}/scheduler-check`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (response.status === 401) {
        throw new Error("Your token was rejected. Log out and log in again.");
      }

      if (response.status === 403) {
        throw new Error("Scheduler access and the booking write permission are required.");
      }

      if (!response.ok) {
        throw new Error("The backend could not complete the check.");
      }

      const data: unknown = await response.json();

      if (
        typeof data !== "object" ||
        data === null ||
        !("message" in data) ||
        typeof data.message !== "string"
      ) {
        throw new Error("The backend returned an unexpected response.");
      }

      setMessage(data.message);
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Unable to verify API access."
      );
    } finally {
      setChecking(false);
    }
  }

  if (!isAuthenticated) {
    return null;
  }

  return (
    <section aria-label="API access check">
      <button
        type="button"
        onClick={checkAccess}
        disabled={checking}
      >
        {checking ? "Checking..." : "Check API access"}
      </button>

      {message && <p role="status">{message}</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}

export default ApiCheck;