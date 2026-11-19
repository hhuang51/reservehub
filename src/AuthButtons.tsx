import { useState } from "react";
import { useAuth0 } from "@auth0/auth0-react";

function AuthButtons() {
  const {
    isLoading,
    isAuthenticated,
    loginWithRedirect,
    logout,
    error,
  } = useAuth0();

  const [actionError, setActionError] = useState("");

  async function handleLogin() {
    setActionError("");

    try {
      await loginWithRedirect();
    } catch {
      setActionError("Unable to start login. Please try again.");
    }
  }

  async function handleLogout() {
    setActionError("");

    try {
      await logout({
        logoutParams: {
          returnTo: window.location.origin,
        },
      });
    } catch {
      setActionError("Unable to log out. Please try again.");
    }
  }

  if (isLoading) {
    return <p role="status">Checking login...</p>;
  }

  return (
    <div>
      {error && (
        <p role="alert">
          Login error: {error.message}
        </p>
      )}

      {actionError && <p role="alert">{actionError}</p>}

      {isAuthenticated ? (
        <>
          <p>You are signed in.</p>
          <button type="button" onClick={handleLogout}>
            Log out
          </button>
        </>
      ) : (
        <button type="button" onClick={handleLogin}>
          Log in
        </button>
      )}
    </div>
  );
}

export default AuthButtons;