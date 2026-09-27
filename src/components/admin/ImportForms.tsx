"use client";

import { useActionState, useState } from "react";
import {
  applyImportAction,
  uploadImportAction,
  undoImportAction,
  type ActionState,
} from "@/app/admin/(panel)/stock/importar/actions";
import { M } from "@/lib/messages";

const I = M.admin.imports;

function ErrorBox({ state }: { state: ActionState }) {
  if (!state?.error) return null;
  return (
    <p role="alert" className="mt-3 rounded-lg bg-danger/10 px-4 py-2 text-sm font-medium text-danger">
      {state.error}
    </p>
  );
}

export function ImportUploadForm({ kind }: { kind: "add" | "replace" }) {
  const [state, action, pending] = useActionState(uploadImportAction, null);
  const danger = kind === "replace";
  return (
    <form action={action} className="mt-4">
      <input type="hidden" name="kind" value={kind} />
      <div className="flex flex-wrap items-end gap-3">
        <label className="block text-sm">
          <span className="font-medium">{I.file}</span>
          <input
            type="file"
            name="file"
            accept=".csv,text/csv"
            required
            className={`mt-1 block w-80 max-w-full rounded-lg border bg-white px-3 py-1.5 text-xs file:mr-2 file:rounded file:border-0 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-paper ${
              danger ? "border-danger/40 file:bg-danger" : "border-ink/15 file:bg-felt"
            }`}
          />
        </label>
        <button
          type="submit"
          disabled={pending}
          className={
            danger
              ? "rounded-lg border border-danger px-4 py-2 text-sm font-semibold text-danger hover:bg-danger/10 disabled:opacity-60"
              : "rounded-lg bg-felt px-4 py-2 text-sm font-semibold text-paper hover:bg-felt-soft disabled:opacity-60"
          }
        >
          {pending ? I.uploading : danger ? I.dangerUpload : I.upload}
        </button>
      </div>
      <ErrorBox state={state} />
    </form>
  );
}

export function ConfirmAddForm({ id, copies }: { id: string; copies: number }) {
  const [state, action, pending] = useActionState(applyImportAction.bind(null, id), null);
  return (
    <form action={action}>
      <button
        type="submit"
        disabled={pending || copies === 0}
        className="rounded-lg bg-felt px-5 py-2.5 text-sm font-semibold text-paper hover:bg-felt-soft disabled:opacity-60"
      >
        {pending ? I.applying : I.confirmAdd(copies)}
      </button>
      <ErrorBox state={state} />
    </form>
  );
}

/**
 * The replace confirmation: the button stays disabled until the admin both
 * ticks the acknowledgement and types the phrase exactly. Pasting is blocked
 * so the phrase has to be typed; the server re-checks it regardless.
 */
export function ConfirmReplaceForm({ id, phrase }: { id: string; phrase: string }) {
  const [state, action, pending] = useActionState(applyImportAction.bind(null, id), null);
  const [typed, setTyped] = useState("");
  const [ack, setAck] = useState(false);
  const ready = ack && typed.trim() === phrase;
  return (
    <form action={action} className="space-y-4">
      <label className="flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          checked={ack}
          onChange={(e) => setAck(e.target.checked)}
          className="mt-0.5 h-4 w-4 accent-danger"
        />
        <span>{I.ack}</span>
      </label>
      <label className="block text-sm">
        <span className="font-medium">{I.phraseLabel(phrase)}</span>
        <input
          type="text"
          name="phrase"
          value={typed}
          // What is shown is what is checked: no CSS-only uppercasing that
          // would display the phrase correctly while the value doesn't match.
          onChange={(e) => setTyped(e.target.value.toUpperCase())}
          onPaste={(e) => e.preventDefault()}
          onDrop={(e) => e.preventDefault()}
          autoComplete="off"
          spellCheck={false}
          className={`font-price mt-1 block w-full max-w-md rounded-lg border px-3 py-2 tracking-wide ${
            typed && !phrase.startsWith(typed.trimStart()) ? "border-danger" : "border-ink/20"
          }`}
        />
      </label>
      <button
        type="submit"
        disabled={!ready || pending}
        className="rounded-lg bg-danger px-5 py-2.5 text-sm font-semibold text-paper hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {pending ? I.applying : I.confirmReplace}
      </button>
      <ErrorBox state={state} />
    </form>
  );
}

export function UndoImportForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState(undoImportAction.bind(null, id), null);
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm(I.confirmUndo)) e.preventDefault();
      }}
    >
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg border border-ink/20 px-4 py-2 text-sm font-medium hover:border-danger hover:text-danger disabled:opacity-60"
      >
        {pending ? I.undoing : I.undo}
      </button>
      <ErrorBox state={state} />
    </form>
  );
}
