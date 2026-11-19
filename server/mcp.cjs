const express = require("express");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");
const { z } = require("zod");

const {
  McpServer,
} = require("@modelcontextprotocol/sdk/server/mcp.js");

const {
  StreamableHTTPServerTransport,
} = require("@modelcontextprotocol/sdk/server/streamableHttp.js");

const { checkJwt } = require("./auth.cjs");
const permissions = require("./permissions.cjs");
const { validateReservation } = require("./validation.cjs");

const router = express.Router();

const PORT = Number(process.env.PORT || 3001);

// Fixed internal destination: never accept a destination from the client.
// REST and MCP belong to the same API and use the same token audience.
const INTERNAL_API = `http://127.0.0.1:${PORT}/api`;

const FRONTEND_ORIGIN =
  process.env.FRONTEND_ORIGIN || "http://localhost:5173";

// Separate versioned storage for MCP call audits.
const auditDb = new DatabaseSync(
  process.env.MCP_AUDIT_PATH || path.join(__dirname, "mcp-audit.sqlite")
);

const version = auditDb.prepare("PRAGMA user_version").get().user_version;

if (version > 1) {
  throw new Error("The MCP audit database requires a newer server.");
}

if (version === 0) {
  auditDb.exec(`
    BEGIN IMMEDIATE;

    CREATE TABLE tool_audit (
      id INTEGER PRIMARY KEY,
      call_id TEXT NOT NULL,
      actor TEXT NOT NULL,
      tool TEXT NOT NULL,
      outcome TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX tool_audit_call_id ON tool_audit(call_id);

    CREATE TRIGGER tool_audit_no_update
    BEFORE UPDATE ON tool_audit
    BEGIN
      SELECT RAISE(ABORT, 'AUDIT_IS_APPEND_ONLY');
    END;

    CREATE TRIGGER tool_audit_no_delete
    BEFORE DELETE ON tool_audit
    BEGIN
      SELECT RAISE(ABORT, 'AUDIT_IS_APPEND_ONLY');
    END;

    PRAGMA user_version = 1;
    COMMIT;
  `);
}

const confirmations = new Map();

const cleanup = setInterval(() => {
  const now = Date.now();

  for (const [id, confirmation] of confirmations) {
    if (confirmation.expiresAt <= now) {
      confirmations.delete(id);
    }
  }
}, 60000);

cleanup.unref();

const bookingSchema = z.object({
  roomId: z.number().int().positive(),
  label: z.string().trim().min(1).max(80),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
}).strict();

function actor(req) {
  return permissions.actorOf(req.auth.payload);
}

// Per-tool scope check (plus scheduler role for writes), from the
// validated token. Shared with REST so both follow the same rules.
function authorize(req, scope, scheduler = false) {
  return permissions.authorize(req.auth.payload, scope, scheduler);
}

function writeAudit(callId, identity, tool, outcome) {
  auditDb.prepare(`
    INSERT INTO tool_audit (call_id, actor, tool, outcome)
    VALUES (?, ?, ?, ?)
  `).run(callId, identity, tool, outcome);
}

async function rest(req, route, method = "GET", body) {
  const response = await fetch(`${INTERNAL_API}${route}`, {
    method,
    redirect: "error",
    headers: {
      Authorization: req.headers.authorization,
      // Lets the REST write limiter skip loopback calls that mcpLimiter
      // already counted. Ignored for anything arriving through a proxy.
      "X-Internal-Request": "mcp",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(10000),
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw Object.assign(
      new Error(data?.error?.message || "The operation failed."),
      { status: response.status }
    );
  }

  return data;
}

function success(data) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(data),
      },
    ],
  };
}

function buildServer(req) {
  const server = new McpServer({
    name: "reservehub",
    version: "1.0.0",
  });

  function register(name, description, schema, scope, write, handler) {
    server.registerTool(
      name,
      {
        description,
        inputSchema: schema,
        annotations: {
          readOnlyHint: !write,
          destructiveHint: false,
          idempotentHint: !write,
          openWorldHint: false,
        },
      },
      async (args) => {
        try {
          // Every tool checks its own scope, even read tools.
          authorize(req, scope, write);

          const data = await handler(args);

          // The operation already happened. An audit-write failure must
          // not be reported to the user as a failed booking.
          try {
            writeAudit(req.mcpCallId, actor(req), name, "succeeded");
          } catch {
            console.error(`Unable to record MCP success for ${name}.`);
          }

          return success(data);
        } catch (error) {
          writeAudit(
            req.mcpCallId,
            actor(req),
            name,
            `failed:${error.status || 500}`
          );

          return {
            isError: true,
            content: [
              {
                type: "text",
                text:
                  error.status
                    ? error.message
                    : "The operation could not be confirmed. Refresh the schedule before retrying.",
              },
            ],
          };
        }
      }
    );
  }

  register(
    "search_rooms",
    "Search rooms by name, minimum capacity, and equipment.",
    {
      query: z.string().max(80).optional(),
      minCapacity: z.number().int().min(1).optional(),
      equipment: z.string().max(80).optional(),
    },
    "read:reservations",
    false,
    async ({ query = "", minCapacity = 1, equipment = "" }) => {
      const rooms = await rest(req, "/rooms");

      return rooms.filter(
        (room) =>
          room.name.toLowerCase().includes(query.toLowerCase()) &&
          room.capacity >= minCapacity &&
          (!equipment || room.equipment.includes(equipment))
      );
    }
  );

  register(
    "get_room_availability",
    "Find rooms available for a weekday interval in Chicago local time.",
    {
      date: z.string(),
      startTime: z.string(),
      endTime: z.string(),
    },
    "read:reservations",
    false,
    async ({ date, startTime, endTime }) => {
      const query = new URLSearchParams({
        date,
        startTime,
        endTime,
      });

      return rest(req, `/rooms?${query}`);
    }
  );

  register(
    "list_reservations",
    "List confirmed reservations for one room.",
    {
      roomId: z.number().int().positive(),
    },
    "read:reservations",
    false,
    async ({ roomId }) =>
      rest(req, `/rooms/${roomId}/reservations`)
  );

  register(
    "create_reservation",
    "Create the exact reservation preview confirmed by the user. Requires a short-lived confirmationId from the ReserveHub confirmation interface.",
    {
      confirmationId: z.string().uuid(),
    },
    "write:reservations",
    true,
    async ({ confirmationId }) => {
      const confirmation = confirmations.get(confirmationId);

      if (
        !confirmation ||
        confirmation.expiresAt <= Date.now() ||
        confirmation.actor !== actor(req)
      ) {
        throw Object.assign(
          new Error("The preview expired or is invalid. Preview again."),
          { status: 409 }
        );
      }

      // Consume before awaiting anything so concurrent calls cannot reuse it.
      confirmations.delete(confirmationId);

      // The existing REST route rechecks permissions, validates fields,
      // and writes the reservation plus before/after audit transactionally.
      return rest(
        req,
        "/reservations",
        "POST",
        confirmation.draft
      );
    }
  );

  return server;
}

// Reject unexpected browser origins. Requests without Origin are allowed
// for non-browser MCP clients, but still require a valid access token.
router.use((req, res, next) => {
  const origin = req.get("Origin");

  if (origin && origin !== FRONTEND_ORIGIN) {
    return res.status(403).json({
      error: {
        code: "FORBIDDEN",
        message: "Origin is not allowed.",
      },
    });
  }

  res.setHeader("Cache-Control", "no-store");
  next();
});

// OAuth applies to every MCP endpoint.
router.use(checkJwt);

// Create a server-held, actor-bound preview.
// This does not create a reservation.
router.post("/confirmations", async (req, res, next) => {
  try {
    authorize(req, "read:reservations");
    authorize(req, "write:reservations", true);

    const parsed = bookingSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        error: {
          code: "INVALID_RESERVATION",
          message: "Enter a room, fictional label, date, and valid times.",
        },
      });
    }

    const draft = parsed.data;

    // Same business rules as the REST API (weekday, hours, not in the past).
    const ruleError = validateReservation(draft);

    if (ruleError) {
      return res.status(400).json({
        error: { code: "INVALID_RESERVATION", message: ruleError },
      });
    }

    const query = new URLSearchParams({
      date: draft.date,
      startTime: draft.startTime,
      endTime: draft.endTime,
    });

    const availableRooms = await rest(req, `/rooms?${query}`);
    const room = availableRooms.find((item) => item.id === draft.roomId);

    if (!room) {
      return res.status(409).json({
        error: {
          code: "UNAVAILABLE",
          message: "That room is unavailable for the selected interval.",
        },
      });
    }

    const identity = actor(req);

    // Bound memory usage and allow only one active preview per actor.
    for (const [id, item] of confirmations) {
      if (item.actor === identity || item.expiresAt <= Date.now()) {
        confirmations.delete(id);
      }
    }

    if (confirmations.size >= 1000) {
      return res.status(503).json({
        error: {
          code: "BUSY",
          message: "Too many pending previews. Try again shortly.",
        },
      });
    }

    const confirmationId = randomUUID();
    const expiresAt = Date.now() + 5 * 60 * 1000;

    confirmations.set(confirmationId, {
      actor: identity,
      draft,
      expiresAt,
    });

    return res.json({
      confirmationId,
      roomName: room.name,
      draft,
      expiresAt,
    });
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({
        error: {
          code: "PREVIEW_FAILED",
          message: error.message,
        },
      });
    }

    next(error);
  }
});

router.post("/", async (req, res, next) => {
  let server;

  try {
    const identity = actor(req);

    // Audit all tool-call attempts, including unknown tools and bad schemas.
    if (req.body?.method === "tools/call") {
      req.mcpCallId = randomUUID();

      const name =
        typeof req.body.params?.name === "string"
          ? req.body.params.name.slice(0, 100)
          : "invalid";

      writeAudit(req.mcpCallId, identity, name, "received");

      res.on("finish", () => {
        try {
          writeAudit(
            req.mcpCallId,
            identity,
            name,
            `http_completed:${res.statusCode}`
          );
        } catch {
          console.error("Unable to record MCP response completion.");
        }
      });
    }

    server = buildServer(req);

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    res.on("close", () => {
      void server.close().catch(() => {});
    });

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    if (server) {
      await server.close().catch(() => {});
    }

    next(error);
  }
});

// This stateless endpoint does not offer a persistent GET stream.
router.all("/", (req, res) => {
  res.setHeader("Allow", "POST");
  res.status(405).json({
    error: {
      code: "METHOD_NOT_ALLOWED",
      message: "Use POST for MCP requests.",
    },
  });
});

module.exports = router;