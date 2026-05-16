import { useEffect, useMemo } from "react";
import { useLocation, useParams } from "react-router";
import clsx from "clsx";
import {
	PauseIcon,
	PlayIcon,
	PencilSimpleIcon,
	TrayIcon,
} from "@phosphor-icons/react";
import { events as mockEvents } from "~/data/mock";
import { useUI } from "~/state";
import { shortDid } from "~/lib/format";
import { ThreadList } from "./ThreadList";
import { ThreadView } from "./ThreadView";

type Folder = "inbox" | "sent";
type Mode = { kind: "folder"; folder: Folder } | { kind: "agent"; agentId: string };

const OUTBOX_AGENT_ID = "outbox";

function useMode(): Mode {
	const loc = useLocation();
	const params = useParams<{ agentId: string }>();
	if (loc.pathname === "/sent") return { kind: "folder", folder: "sent" };
	if (loc.pathname === "/inbox" || loc.pathname === "/")
		return { kind: "folder", folder: "inbox" };
	return { kind: "agent", agentId: params.agentId ?? "writer" };
}

export function StreamPanel() {
	const mode = useMode();
	const streamPaused = useUI((s) => s.streamPaused);
	const togglePause = useUI((s) => s.togglePause);
	const agents = useUI((s) => s.agents);
	const liveEvents = useUI((s) => s.liveEvents);
	const selectedThreadId = useUI((s) => s.selectedThreadId);
	const selectThread = useUI((s) => s.selectThread);
	const openCompose = useUI((s) => s.openCompose);

	// Clear the open thread when the user switches folder / agent — a
	// context_id belongs to one selection, not another's.
	const modeKey = mode.kind === "folder" ? `folder:${mode.folder}` : `agent:${mode.agentId}`;
	useEffect(() => {
		selectThread(null);
	}, [modeKey, selectThread]);

	const filteredEvents = useMemo(() => {
		const all = [...liveEvents, ...mockEvents];
		if (mode.kind === "agent") {
			return all.filter((e) => e.agentId === mode.agentId);
		}
		if (mode.folder === "sent") {
			return all.filter((e) => e.agentId === OUTBOX_AGENT_ID);
		}
		// inbox = everything except outbound originated locally
		return all.filter((e) => e.agentId !== OUTBOX_AGENT_ID);
	}, [mode, liveEvents]);

	const title =
		mode.kind === "folder"
			? mode.folder === "sent"
				? "Sent"
				: "Inbox"
			: agents.find((a) => a.id === mode.agentId)?.name ?? mode.agentId;
	const subtitle =
		mode.kind === "folder"
			? mode.folder === "sent"
				? "Conversations you initiated"
				: "Conversations from your ecosystem"
			: shortDid(agents.find((a) => a.id === mode.agentId)?.did ?? "");

	return (
		<main className="flex min-w-0 flex-1 flex-col">
			<header className="flex items-center justify-between border-b border-[--color-border-soft] bg-[--color-panel] px-6 py-3">
				<div className="flex items-baseline gap-3">
					{mode.kind === "folder" && (
						<TrayIcon size={16} weight="duotone" className="text-fg-muted" />
					)}
					<h1 className="text-[14px] font-medium text-fg">{title}</h1>
					<span className="text-[11px] text-fg-dim">{subtitle}</span>
				</div>
				<div className="flex items-center gap-3">
					<button
						type="button"
						onClick={openCompose}
						className="flex items-center gap-1.5 rounded-md bg-[--color-cobalt] px-2.5 py-1 text-[11px] font-medium text-white shadow-sm transition hover:bg-[--color-cobalt-strong]"
					>
						<PencilSimpleIcon size={11} weight="fill" />
						Compose
					</button>
					<div className="flex items-center gap-1.5 text-[11px]">
						<span
							className={clsx(
								"inline-block h-1.5 w-1.5 rounded-full",
								streamPaused
									? "bg-yellow-400"
									: "live-pulse bg-[--color-cobalt]",
							)}
						/>
						<span className="text-fg-muted">
							{streamPaused ? "paused" : "live"}
						</span>
					</div>
					<button
						type="button"
						onClick={togglePause}
						className="flex items-center gap-1.5 rounded-md border border-[--color-border] bg-white px-2 py-1 text-[11px] text-fg-muted transition hover:border-[--color-cobalt] hover:text-[--color-cobalt]"
					>
						{streamPaused ? (
							<PlayIcon size={11} weight="fill" />
						) : (
							<PauseIcon size={11} weight="fill" />
						)}
						{streamPaused ? "Resume" : "Pause"}
					</button>
				</div>
			</header>
			{selectedThreadId ? (
				<ThreadView contextId={selectedThreadId} />
			) : (
				<div className="scrollbar flex-1 overflow-y-auto">
					<ThreadList events={filteredEvents} />
				</div>
			)}
		</main>
	);
}
