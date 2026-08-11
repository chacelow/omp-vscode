import { useEffect, useMemo, useState } from "react";
import type { ElicitationContentValue } from "@agentclientprotocol/sdk";
import type { AcpElicitationRequest, AcpPermissionRequest } from "../../../core/acp/protocol";

type InteractionResponse = {
  optionId?: string;
  action?: "accept" | "decline" | "cancel";
  content?: Record<string, ElicitationContentValue>;
};

type FormValues = Record<string, ElicitationContentValue>;
type FormProperty = {
  type: string;
  title?: string;
  enum?: string[];
  default?: ElicitationContentValue;
  itemType?: string;
  itemChoices?: string[];
};

export interface InteractionDialogProps {
  request: AcpPermissionRequest | AcpElicitationRequest;
  onRespond: (request: AcpPermissionRequest | AcpElicitationRequest, response: InteractionResponse) => void;
}

export function InteractionDialog({ request, onRespond }: InteractionDialogProps) {
  const [values, setValues] = useState<FormValues>({});
  const [activeTab, setActiveTab] = useState(0);
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState("");
  const isPermission = "toolCall" in request;
  const elicitation = isPermission ? null : request;
  const mode = elicitation?.request.mode;
  const schema = useMemo(() => {
    if (!elicitation || !("requestedSchema" in elicitation.request)) return null;
    const { requestedSchema } = elicitation.request;
    return typeof requestedSchema === "object" && requestedSchema !== null ? requestedSchema : null;
  }, [elicitation]);
  const properties = useMemo((): Array<[string, FormProperty]> => {
    if (!schema || !("type" in schema) || schema.type !== "object" || !("properties" in schema)) return [];
    const rawProperties = schema.properties;
    if (typeof rawProperties !== "object" || rawProperties === null) return [];
    return Object.entries(rawProperties).flatMap(([name, property]) => {
      if (typeof property !== "object" || property === null || !("type" in property) || typeof property.type !== "string") return [];
      const choices = "enum" in property && Array.isArray(property.enum)
        ? property.enum.filter((choice: unknown): choice is string => typeof choice === "string")
        : undefined;
      const defaultValue = "default" in property && (typeof property.default === "string" || typeof property.default === "number" || typeof property.default === "boolean" || (Array.isArray(property.default) && property.default.every((value: unknown) => typeof value === "string")))
        ? property.default
        : undefined;
      const items = "items" in property && typeof property.items === "object" && property.items !== null ? property.items : null;
      const itemChoices = items && "enum" in items && Array.isArray(items.enum)
        ? items.enum.filter((choice: unknown): choice is string => typeof choice === "string")
        : undefined;
      const itemType = items && "type" in items && typeof items.type === "string" ? items.type : undefined;
      const title = "title" in property && typeof property.title === "string" ? property.title : undefined;
      return [[name, { type: property.type, title, enum: choices, default: defaultValue, itemType, itemChoices }]];
    });
  }, [schema]);
  const hasTabbedForm = !isPermission && properties.length >= 2;
  const reviewTab = properties.length;
  const activeProperty = hasTabbedForm && activeTab < properties.length ? properties[activeTab] : null;
  useEffect(() => {
    setValues(Object.fromEntries(properties.flatMap(([name, property]) => property.default === undefined ? [] : [[name, property.default]])));
    setActiveTab(0);
    setNoteOpen(false);
    setNote("");
  }, [request, properties]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onRespond(request, isPermission ? {} : { action: "cancel" });
      if (event.key === "n" && activeProperty && event.target instanceof HTMLElement && !event.target.matches("input, textarea, select")) {
        event.preventDefault();
        setNoteOpen(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeProperty, isPermission, onRespond, request]);
  const setValue = (name: string, value: ElicitationContentValue) => setValues((current) => ({ ...current, [name]: value }));
  const title = isPermission ? request.toolCall.title ?? "Permission required" : "title" in request.request && typeof request.request.title === "string" ? request.request.title : "Response required";
  const rawInput = isPermission && "rawInput" in request.toolCall ? request.toolCall.rawInput : undefined;
  const description = rawInput && typeof rawInput === "object" && "description" in rawInput && typeof rawInput.description === "string" ? rawInput.description : elicitation?.request.message;
  const selectChoices = schema && "enum" in schema && Array.isArray(schema.enum) ? schema.enum.filter((choice): choice is string => typeof choice === "string") : [];
  const isForm = properties.length > 0;
  const visibleProperties = activeProperty ? [activeProperty] : properties;
  const appendNote = () => {
    if (!activeProperty || !note.trim()) return;
    const [name] = activeProperty;
    const current = values[name];
    setValue(name, typeof current === "string" && current ? `${current}\n${note}` : note);
    setNote("");
    setNoteOpen(false);
  };

  return <div className="absolute inset-0 z-[90] flex items-center justify-center bg-[var(--vscode-widget-shadow,rgba(0,0,0,0.18))] p-5">
    <div role="dialog" aria-modal="true" aria-label={title} className="w-full max-w-[560px] overflow-hidden rounded-lg border border-border bg-background shadow-[0_20px_60px_var(--vscode-widget-shadow,rgba(0,0,0,0.28))]">
      <div className="border-b border-border px-3.5 py-3"><h2 className="text-balance text-sm font-semibold text-foreground">{title}</h2>{description && <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">{description}</p>}</div>
      {hasTabbedForm && <div role="tablist" aria-label="Questions" className="flex overflow-x-auto border-b border-border px-2 pt-2">
        {properties.map(([name, property], index) => <button key={name} type="button" role="tab" aria-selected={activeTab === index} className={`min-h-9 whitespace-nowrap rounded-t px-3 text-xs ${activeTab === index ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted"}`} onClick={() => { setActiveTab(index); setNoteOpen(false); }}>{property.title ?? `Question ${index + 1}`}</button>)}
        <button type="button" role="tab" aria-selected={activeTab === reviewTab} className={`min-h-9 whitespace-nowrap rounded-t px-3 text-xs ${activeTab === reviewTab ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted"}`} onClick={() => { setActiveTab(reviewTab); setNoteOpen(false); }}>Review</button>
      </div>}
      <div className="space-y-3 p-3.5">
        {isPermission && <div className="grid gap-2">{request.options.map((option) => <button key={option.optionId} type="button" className="min-h-10 w-full rounded-md border border-border bg-background px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-muted active:scale-[0.96]" onClick={() => onRespond(request, { optionId: option.optionId })}>{"label" in option && typeof option.label === "string" ? option.label : option.name}</button>)}</div>}
        {elicitation && mode === "select" && selectChoices.length > 0 && <div className="grid gap-2">{selectChoices.map((choice) => <button key={choice} type="button" className="min-h-10 w-full rounded-md border border-border bg-background px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-muted active:scale-[0.96]" onClick={() => onRespond(request, { action: "accept", content: { value: choice } })}>{choice}</button>)}</div>}
        {elicitation && mode === "confirm" && <div className="flex gap-2"><button type="button" className="min-h-10 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground active:scale-[0.96]" onClick={() => onRespond(request, { action: "accept", content: { confirmed: true } })}>Yes</button><button type="button" className="min-h-10 rounded-md border border-border bg-background px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted active:scale-[0.96]" onClick={() => onRespond(request, { action: "accept", content: { confirmed: false } })}>No</button></div>}
        {elicitation && (mode === "input" || mode === "editor") && !isForm && <textarea autoFocus value={typeof values.value === "string" ? values.value : ""} onChange={(event) => setValue("value", event.target.value)} className="min-h-28 w-full resize-y rounded-md border border-border bg-muted p-2.5 text-sm text-foreground outline-none focus:border-primary" />}
        {elicitation && isForm && (!hasTabbedForm || activeTab !== reviewTab) && <div className="grid gap-3">{visibleProperties.map(([name, property]) => <label key={name} className="grid gap-1.5 text-sm text-foreground"><span>{property.title ?? name}</span>{property.type === "boolean" ? <input type="checkbox" checked={values[name] === true} onChange={(event) => setValue(name, event.target.checked)} className="size-4 accent-primary" /> : property.type === "array" && property.itemChoices ? <div className="grid gap-1">{property.itemChoices.map((choice) => <label key={choice} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={Array.isArray(values[name]) && values[name].includes(choice)} onChange={(event) => { const selected = Array.isArray(values[name]) ? values[name] : []; setValue(name, event.target.checked ? [...selected, choice] : selected.filter((value) => value !== choice)); }} className="size-4 accent-primary" />{choice}</label>)}</div> : property.type === "string" && property.enum && property.enum.length > 0 ? <select value={typeof values[name] === "string" ? values[name] : ""} onChange={(event) => setValue(name, event.target.value)} className="min-h-10 rounded-md border border-border bg-muted px-2.5 text-sm text-foreground"><option value="">Select…</option>{property.enum.map((choice) => <option key={choice} value={choice}>{choice}</option>)}</select> : <input type={property.type === "number" ? "number" : "text"} value={typeof values[name] === "string" || typeof values[name] === "number" ? values[name] : ""} onChange={(event) => setValue(name, property.type === "number" ? Number(event.target.value) : event.target.value)} className="min-h-10 rounded-md border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary" />}</label>)}</div>}
        {hasTabbedForm && activeTab === reviewTab && <div className="grid gap-2">{properties.map(([name, property]) => <div key={name} className="rounded border border-border bg-muted px-2.5 py-2 text-sm"><span className="font-medium text-foreground">{property.title ?? name}: </span><span className="whitespace-pre-wrap text-muted-foreground">{Array.isArray(values[name]) ? values[name].join(", ") : String(values[name] ?? "—")}</span></div>)}</div>}
        {noteOpen && activeProperty && <div className="grid gap-2 rounded border border-border bg-muted p-2"><label htmlFor="elicitation-note" className="text-xs text-muted-foreground">Add note to {activeProperty[1].title ?? activeProperty[0]}</label><textarea id="elicitation-note" autoFocus value={note} onChange={(event) => setNote(event.target.value)} className="min-h-20 rounded border border-border bg-background p-2 text-sm text-foreground" /><div className="flex justify-end gap-2"><button type="button" className="text-xs text-muted-foreground" onClick={() => setNoteOpen(false)}>Cancel</button><button type="button" className="text-xs text-primary" onClick={appendNote}>Add note</button></div></div>}
      </div>
      <div className="flex justify-end gap-2 border-t border-border bg-muted px-3.5 py-2.5">{!isPermission && <button type="button" className="min-h-10 rounded-md border border-border bg-background px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-background active:scale-[0.96]" onClick={() => onRespond(request, { action: "decline" })}>Decline</button>}<button type="button" className="min-h-10 rounded-md border border-border bg-background px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-background active:scale-[0.96]" onClick={() => onRespond(request, isPermission ? {} : { action: "cancel" })}>Cancel</button>{elicitation && ((mode === "input" || mode === "editor") || isForm) && (!hasTabbedForm || activeTab === reviewTab) && <button type="button" className="min-h-10 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground active:scale-[0.96]" onClick={() => onRespond(request, { action: "accept", content: values })}>Submit</button>}</div>
    </div>
  </div>;
}
