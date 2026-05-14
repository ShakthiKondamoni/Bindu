import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const DB_PATH = process.env.BINDU_COMMS_DB ?? "data/events.db";
mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

db.exec(`
	CREATE TABLE IF NOT EXISTS events (
		id              TEXT PRIMARY KEY,
		agent_id        TEXT NOT NULL,
		received_at     TEXT NOT NULL,
		payload         TEXT NOT NULL,
		first_contact   INTEGER NOT NULL DEFAULT 0
	);
	CREATE INDEX IF NOT EXISTS events_agent_received
		ON events (agent_id, received_at DESC);

	CREATE TABLE IF NOT EXISTS agents (
		id           TEXT PRIMARY KEY,
		url          TEXT,
		did          TEXT,
		agent_card   TEXT,
		resolved_at  TEXT
	);

	CREATE TABLE IF NOT EXISTS contexts (
		agent_id        TEXT NOT NULL,
		context_id      TEXT NOT NULL,
		first_seen_at   TEXT NOT NULL,
		PRIMARY KEY (agent_id, context_id)
	);
`);

export interface EventRow {
	id: string;
	agentId: string;
	receivedAt: string;
	payload: Record<string, unknown>;
	firstContact: boolean;
}

// Defensive: older DB files may predate first_contact. Add the column when
// missing so we don't crash on startup after the schema bump.
const eventColumns = db
	.prepare("PRAGMA table_info(events)")
	.all() as Array<{ name: string }>;
if (!eventColumns.some((c) => c.name === "first_contact")) {
	db.exec("ALTER TABLE events ADD COLUMN first_contact INTEGER NOT NULL DEFAULT 0");
}

const insertEvent = db.prepare(
	"INSERT OR REPLACE INTO events (id, agent_id, received_at, payload, first_contact) VALUES (?, ?, ?, ?, ?)",
);
const trimEvents = db.prepare(
	`DELETE FROM events WHERE id IN (
		SELECT id FROM events ORDER BY received_at DESC LIMIT -1 OFFSET ?
	)`,
);
const recentEvents = db.prepare(
	"SELECT id, agent_id AS agentId, received_at AS receivedAt, payload, first_contact AS firstContact FROM events ORDER BY received_at ASC LIMIT ?",
);
const distinctAgents = db.prepare(
	"SELECT DISTINCT agent_id AS agentId FROM events",
);
const upsertContext = db.prepare(
	"INSERT OR IGNORE INTO contexts (agent_id, context_id, first_seen_at) VALUES (?, ?, ?)",
);
const getAgent = db.prepare(
	"SELECT id, url, did, agent_card AS agentCard, resolved_at AS resolvedAt FROM agents WHERE id = ?",
);
const upsertAgent = db.prepare(`
	INSERT INTO agents (id, url, did, agent_card, resolved_at)
	VALUES (@id, @url, @did, @agentCard, @resolvedAt)
	ON CONFLICT(id) DO UPDATE SET
		url = excluded.url,
		did = excluded.did,
		agent_card = excluded.agent_card,
		resolved_at = excluded.resolved_at
`);

const MAX_EVENTS = 1000;

export function recordEvent(
	id: string,
	agentId: string,
	receivedAt: string,
	payload: Record<string, unknown>,
): boolean {
	const contextId =
		typeof payload.context_id === "string" ? (payload.context_id as string) : null;
	let firstContact = false;
	if (contextId) {
		const result = upsertContext.run(agentId, contextId, receivedAt);
		firstContact = result.changes > 0;
	}
	insertEvent.run(id, agentId, receivedAt, JSON.stringify(payload), firstContact ? 1 : 0);
	trimEvents.run(MAX_EVENTS);
	return firstContact;
}

export function listRecentEvents(limit = 50): EventRow[] {
	type Row = {
		id: string;
		agentId: string;
		receivedAt: string;
		payload: string;
		firstContact: number;
	};
	const rows = recentEvents.all(limit) as Row[];
	return rows.map((r) => ({
		id: r.id,
		agentId: r.agentId,
		receivedAt: r.receivedAt,
		payload: JSON.parse(r.payload) as Record<string, unknown>,
		firstContact: !!r.firstContact,
	}));
}

export function listAgents(): string[] {
	type Row = { agentId: string };
	return (distinctAgents.all() as Row[]).map((r) => r.agentId);
}

export interface AgentRecord {
	id: string;
	url?: string;
	did?: unknown;
	agentCard?: unknown;
	resolvedAt?: string;
}

export function readAgent(id: string): AgentRecord | null {
	type Row = {
		id: string;
		url: string | null;
		did: string | null;
		agentCard: string | null;
		resolvedAt: string | null;
	};
	const row = getAgent.get(id) as Row | undefined;
	if (!row) return null;
	return {
		id: row.id,
		url: row.url ?? undefined,
		did: row.did ? JSON.parse(row.did) : null,
		agentCard: row.agentCard ? JSON.parse(row.agentCard) : null,
		resolvedAt: row.resolvedAt ?? undefined,
	};
}

export function writeAgent(rec: AgentRecord): void {
	upsertAgent.run({
		id: rec.id,
		url: rec.url ?? null,
		did: rec.did === undefined ? null : JSON.stringify(rec.did),
		agentCard:
			rec.agentCard === undefined ? null : JSON.stringify(rec.agentCard),
		resolvedAt: rec.resolvedAt ?? null,
	});
}
