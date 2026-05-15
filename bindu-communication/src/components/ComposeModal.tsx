import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import clsx from "clsx";
import { XIcon, PaperPlaneTiltIcon } from "@phosphor-icons/react";
import { shortDid } from "~/lib/format";

interface EcosystemAgent {
	id: string;
	url?: string;
	did?: { id?: string } | null;
	agentCard?: { name?: string } | null;
}

interface Props {
	open: boolean;
	onClose: () => void;
}

export function ComposeModal({ open, onClose }: Props) {
	const navigate = useNavigate();
	const [agents, setAgents] = useState<EcosystemAgent[]>([]);
	const [agentId, setAgentId] = useState("");
	const [text, setText] = useState("");
	const [status, setStatus] = useState<"idle" | "sending" | "error">("idle");
	const [errMsg, setErrMsg] = useState<string | null>(null);

	useEffect(() => {
		if (!open) return;
		setText("");
		setStatus("idle");
		setErrMsg(null);
		fetch("/api/ecosystem")
			.then((r) => (r.ok ? r.json() : []))
			.then((j: EcosystemAgent[]) => {
				// Exclude the synthetic outbox bucket — you don't send TO your own outbox.
				const filtered = j.filter((a) => a.id !== "outbox");
				setAgents(filtered);
				if (!agentId && filtered[0]) setAgentId(filtered[0].id);
			})
			.catch(() => {});
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [open]);

	useEffect(() => {
		if (!open) return;
		function onKey(e: KeyboardEvent) {
			if (e.key === "Escape") onClose();
		}
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [open, onClose]);

	if (!open) return null;

	const canSubmit =
		agentId.length > 0 && text.trim().length > 0 && status !== "sending";

	async function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		if (!canSubmit) return;
		setStatus("sending");
		setErrMsg(null);
		try {
			const r = await fetch("/api/compose", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ agentId, text: text.trim() }),
			});
			const j = (await r.json().catch(() => ({}))) as {
				ok?: boolean;
				error?: string;
				detail?: string;
			};
			if (!r.ok || j.ok === false) {
				setStatus("error");
				setErrMsg(j.detail ?? j.error ?? `HTTP ${r.status}`);
				return;
			}
			navigate("/agents/outbox");
			onClose();
		} catch (err) {
			setStatus("error");
			setErrMsg((err as Error).message);
		}
	}

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 backdrop-blur-sm"
			onClick={onClose}
		>
			<form
				onSubmit={handleSubmit}
				onClick={(e) => e.stopPropagation()}
				className="w-[560px] max-w-[92vw] rounded-lg border border-[--color-border] bg-white shadow-2xl"
			>
				<div className="flex items-center gap-2.5 border-b border-[--color-border-soft] px-5 py-3">
					<PaperPlaneTiltIcon
						size={18}
						weight="duotone"
						className="text-[--color-cobalt]"
					/>
					<div className="flex-1">
						<h2 className="text-[14px] font-medium text-fg">New request</h2>
						<div className="text-[10px] text-fg-dim">
							Send a message to an agent in your ecosystem. From: your operator DID.
						</div>
					</div>
					<button
						type="button"
						onClick={onClose}
						className="rounded p-1 text-fg-dim transition hover:bg-slate-100 hover:text-fg"
					>
						<XIcon size={14} weight="bold" />
					</button>
				</div>

				<div className="space-y-4 px-5 py-5">
					<div>
						<label className="block text-[10px] uppercase tracking-[0.15em] text-fg-dim">
							To
						</label>
						{agents.length === 0 ? (
							<div className="mt-1.5 rounded-md border border-dashed border-[--color-border] bg-slate-50 px-3 py-2 text-[12px] text-fg-dim">
								No agents in your ecosystem yet. Add one from the sidebar first.
							</div>
						) : (
							<select
								value={agentId}
								onChange={(e) => setAgentId(e.target.value)}
								className="mt-1.5 w-full rounded-md border border-[--color-border] bg-white px-3 py-2 text-[13px] text-fg outline-none transition focus:border-[--color-cobalt] focus:ring-2 focus:ring-[--color-cobalt-soft]"
							>
								{agents.map((a) => {
									const name = a.agentCard?.name ?? a.id;
									const did = a.did?.id;
									return (
										<option key={a.id} value={a.id}>
											{name}
											{did ? ` · ${shortDid(did)}` : ` · ${a.id}`}
										</option>
									);
								})}
							</select>
						)}
					</div>

					<div>
						<label className="block text-[10px] uppercase tracking-[0.15em] text-fg-dim">
							Body
						</label>
						<textarea
							autoFocus
							value={text}
							onChange={(e) => setText(e.target.value)}
							placeholder="Type the request body…"
							rows={5}
							className="mt-1.5 w-full resize-y rounded-md border border-[--color-border] bg-white px-3 py-2 text-[13px] text-fg placeholder-fg-faint outline-none transition focus:border-[--color-cobalt] focus:ring-2 focus:ring-[--color-cobalt-soft]"
						/>
					</div>

					{status === "error" && errMsg && (
						<div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] text-rose-700">
							✗ {errMsg}
						</div>
					)}
				</div>

				<div className="flex items-center justify-end gap-2 border-t border-[--color-border-soft] bg-slate-50 px-5 py-3">
					<button
						type="button"
						onClick={onClose}
						className="rounded-md border border-[--color-border] bg-white px-3 py-1.5 text-[12px] text-fg-muted transition hover:border-[--color-cobalt] hover:text-[--color-cobalt]"
					>
						Cancel
					</button>
					<button
						type="submit"
						disabled={!canSubmit || agents.length === 0}
						className={clsx(
							"rounded-md px-3 py-1.5 text-[12px] font-medium shadow-sm transition",
							canSubmit && agents.length > 0
								? "bg-[--color-cobalt] text-white hover:bg-[--color-cobalt-strong]"
								: "bg-slate-200 text-slate-400",
						)}
					>
						{status === "sending" ? "Sending…" : "Send request"}
					</button>
				</div>
			</form>
		</div>
	);
}
