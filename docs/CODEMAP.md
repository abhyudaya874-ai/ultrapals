# CODEMAP: every file, its exports, exact signatures

**Look names up here before you import or call anything. If it is not here, grep. If grep finds nothing, it does not exist.**
(Paths are the project paths after `bash scripts/install-reference.sh`; the files live under `reference/` in this pack.)
Generated from the real code, then annotated. If you add an export, add it here in the same commit.

## Pure core

| File | Exports | Notes |
|---|---|---|
| `lib/verdict.ts` **(protected)** | `REASON_CODES`, `ReasonCode`, `VerdictKind`, `Consequence`, `Condition`, `Terms`, `Fact`, `ConditionFact`, `VerdictInput`, `Verdict`, `computeVerdict(input: VerdictInput): Verdict` | imports NOTHING. `Condition = none \| price_at_most{query,ceilingMinor,currency} \| page_contains{url,needle}`. `Fact = observed{observedMinor,currency} \| none \| unavailable`. `ConditionFact = not_checked \| product{priceMinor,currency,inStock} \| page{text} \| unavailable`. `VerdictInput = {terms, fact, world, nowMs}` |
| `lib/money.ts` | `SUPPORTED_CURRENCIES` (PAYABLE only: no INR), `Currency`, `exponentOf(c)`, `parseMinor(value: string, currency): number`, `formatMajor(minor, currency): string`, `minorFromJson(value: number\|string, currency): number` | the ONLY place money changes representation |
| `lib/sse.ts` | `encodeSse(e: TraceEvent): string`, `parseSse(buffer): {events, rest}`, `upsertEvent(list, e)` | server encodes, client parses, panel upserts |

## Data

| File | Exports | Notes |
|---|---|---|
| `db/schema.ts` **(protected)** | `PROMISE_STATES`, `PromiseState`, `CAPTURE_STATUSES`, `CaptureStatus`, tables `promise`, `promiseEvent`, `capture`, `conditionSnapshot` | `promise` has `payerName`, `payerEmail`, `condition` (jsonb `Condition`), `state` |
| `db/index.ts` | `getDb()` | lazy; always call `getDb()`, never import a `db` constant |
| `lib/env.ts` | `getEnv(): Env`, `Env` | the only reader of `process.env` (plus `NEXT_PUBLIC_*` in components) |
| `lib/events.ts` | `EVENT_KINDS`, `EventKind`, `logEvent(promiseId, attempt, kind, payload?)`, `setState(promiseId, state)` | log FIRST, then `setState` |
| `lib/studio/rows.ts` | `VerdictRow`, `queryVerdictRows(limit)` | one query behind the dashboard, scoreboard and timeline |

## Money movement

| File | Exports | Notes |
|---|---|---|
| `lib/paypal.ts` | `createOrder`, `getOrder`, `captureOrder`, `normalizeCapture(status, body): CaptureOutcome`, `approveUrlFor(orderId)`, `paypal` (object of the three calls), types `CaptureOutcome`, `OrderResult`, `CreateResult` | sandbox host only. `getOrder` ok-result fields: `orderStatus, amountMinor, currency` |
| `lib/capture.ts` | `SettleCtx`, `Outcome`, `capturePromise(c)`, `releasePromise(c)`, `waitPromise(c)`, `resume(c, {existingCapture, state})` | claim-then-act. The three consequence handlers the route looks up |
| `app/api/promise/route.ts` **(protected)** | `POST` (ops `create`, `settle`, `manual_fact`, `reschedule`), `runtime`, `dynamic` | the ONLY write endpoint. `settle` streams SSE |
| `app/p/page.tsx` **(protected)** | default `Page` | server component, reads the local DB only |
| `app/api/verdict/replay/route.ts` | `GET ?promiseId=` | recomputes the stored verdict from its stored input |
| `app/api/studio/query/route.ts` | `GET ?limit=` | rows for Studio / Bryntum |
| `app/api/studio/llm/[...path]/route.ts` | `POST` | key-safe proxy: forwards ONLY `chat/completions` to an OpenAI-compatible provider |
| `app/api/promises/open/route.ts` | `GET` | open promise ids (for the Render sweep) |
| `app/api/promises/recent/route.ts` | `GET ?limit=` | latest promises for the sidebar (id, title, state, amountMinor, currency, createdAt) |
| `app/api/render/sweep/route.ts` | `POST` | starts the Render workflow task |
| `app/api/capabilities/route.ts` | `GET` | `capabilityReport()` |

## Runtime agents (`lib/agent/`)

| File | Exports | Notes |
|---|---|---|
| `types.ts` | `SubagentId`, `SubagentState`, `Emit`, `TraceEvent`, `SubagentResult<T>`, `AgentCtx`, `OnFailure`, `AgentProfile`, `GuardFacts`, `ObserverResult`, `ResolverResult`, `Reconciliation`, `Gathered` | `AgentCtx = {promiseId, attempt, nowMs, signal, emit}` |
| `registry.ts` | `PROFILES`, `GRAPH` | caps and `onFailure` per agent |
| `budget.ts` | `CYCLE_BUDGET_MS`, `Budget`, `withTimeout(profile, budget, parentSignal, run)` | deadline rejects even if the agent ignores the signal |
| `trace.ts` | `nextId(prefix)`, `traced(emit, name, args, fn)`, `streamVerdictSource(emit)` | wrap EVERY external call in `traced` |
| `orchestrator.ts` | `Cycle` (`gather()`, `decorate(verdict, guard)`), `CycleError` | gather = guard→observer→resolver→reconciler |
| `agents/guard.ts` | `runGuard(ctx, signal): GuardFacts` | abort on failure |
| `agents/observer.ts` | `runObserver(ctx, orderId, signal): ObserverResult` | PayPal evidence |
| `agents/resolver.ts` | `runResolver(ctx, guardFacts, signal): ResolverResult` | world evidence + snapshot row |
| `agents/reconciler.ts` | `runReconciler(ctx, orderStatus, signal)` | local only |
| `agents/explainer.ts` | `FALLBACK`, `runExplainer(ctx, signal, verdict, condition)` | template, optional LLM, optional Elastic precedent |
| `agents/nudger.ts` | `runNudger(ctx, guardFacts, verdict, signal)` | Zapier or in-app banner |
| `agents/archivist.ts` | `runArchivist(ctx, signal, verdict, condition)` | summary row + Elastic index |

## Integrations (`lib/integrations/`)

| File | Exports | Notes |
|---|---|---|
| `types.ts` | `AdapterResult<T>`, `ProductFact`, `PageFact`, `NudgeInput` | |
| `registry.ts` | `CAPABILITY_IDS`, `CapabilityId`, `isOn(id)`, `degrade(reason)`, `guard(id, fn)`, `capabilityReport()` | |
| `url-guard.ts` | `assertPublicHttpUrl(url): string` | SSRF guard. Use on every user URL |
| `channel3.ts` | `parseChannel3(body): ProductFact\|null` (pure), `searchProduct(query, signal?)` | |
| `kernel.ts` | `observePage(url, signal?)`, `fetchPage(url, signal?)` | fetchPage = degrade target |
| `elastic.ts` | `INDEX`, `INFERENCE_ID`, `conditionText(c)`, `precedentLine(rows)`, `indexVerdict`, `findPrecedent`, `esql` | |
| `zapier.ts` | `buildNudge(n)` (pure), `buildToolArgs(schemaProps, n)` (pure), `needsFollowUp(text)` (pure), `sendNudge(n)` | reads the tool's input schema at call time |
| `render.ts` | `startSweep()` | |
| `bryntum.ts` | `TimelineRow`, `SchedulerData`, `toScheduler(rows)` (pure) | |

## UI (`components/`, `app/`)

`Composer` (create form) · `PromiseSurface` (settle, replay, manual entry, pane/outline state; dispatches `promises:changed`) ·
`shell/AppShell` + `shell/Sidebar` (global dark shell, recents, drawer) + `shell/TopBar` ·
`thread/Thread` (terms bubble, process disclosure, artifact cards, serif answer, action row, follow-ups; exports `ThreadProps`, `ThreadPromise`, `ThreadLogRow`, `PaneState`) ·
`thread/Pane` (agent/artifact detail pane, toolbar: copy, download, share, expand, close) · `thread/Outline` (Agents/Artifacts/Plugins/Sources popover) ·
`thread/Dock` (composer dock + `useDismiss`, `useStickToBottom`) · `thread/group-trace` (`groupTrace`, `processCounts`, `stepSummary`, `durationFromLog`, `isDegraded`) ·
`thread/format` (`formatDuration`) · `thread/reason-copy` (`REASON_SENTENCE`) · `thread/describe-condition` · `thread/safe-url` (`safeHttpUrl`, `hostLabel`, `sourcesFromTrace`) ·
`TracePanel` (`TraceRow` single row switch + `TracePanel` fallback aside) · `ui/Disclosure` · `ui/icons` (24 inline SVGs) ·
`PromiseTimeline` (Bryntum `svalbard-dark`, client only) · `studio/StudioBoard` (AG Studio in paper frame), `studio/registry` (`widgets`), `studio/agent` (`buildAi(adapter)`), `studio/chat-adapter` (`chatAdapter`, `toChatMessages`, `toChatTools`, `toToolChoice`, `parseDataLines`, `ChatStreamAccumulator`),
`studio/widgets/{verdict-pill,scoreboard}` · pages: `/` `/p` `/board` `/timeline`.

## Other

`workflows/index.ts` (Render tasks `settleOne`, `sweep`) · `astropods/*` (`agent.mjs`: `runAgent`, `runTool`, `TOOLS`; `server.mjs`: `createAppServer`; tests: `node --test astropods/agent.test.mjs`) · `postman/*` · `scripts/{check-invariants,verify,elastic-setup,zapier-tools}.mjs`.

## Import rules (the graph)

```
lib/verdict.ts         -> (nothing)
lib/money.ts, sse.ts   -> types only
lib/integrations/*     -> lib/env, lib/money, lib/verdict (TYPES), registry/types. Never db, never lib/agent
lib/agent/*            -> lib/integrations, lib/events, lib/llm, db, lib/verdict (TYPES ONLY, never computeVerdict)
lib/capture.ts         -> db, lib/events, lib/paypal, lib/agent/trace
app/api/promise/route  -> everything above; it is the only caller of computeVerdict
components/*           -> lib/sse, lib/money, types. Never db, never lib/integrations (except pure bryntum.ts)
```
