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
| `tavily.ts` | `parseTavily(body): WebSource[]` (pure), `tavilySearch(query, signal?, maxResults?)` | `POST api.tavily.com/search` |
| `exa.ts` | `parseExa(body): WebSource[]` (pure), `exaSearch(query, signal?, numResults?)` | `POST api.exa.ai/search`, `contents.highlights` |
| `chat.ts` | `GROQ_FREE_MODELS`, `OPENROUTER_FREE_MODELS`, `isFreeModel`, `parseChatSse`, `openChat`, `readDeltas` | OpenAI-compatible stream; `:free` suffix enforced for OpenRouter |
| `kbrowser.ts` | `LiveBrowser`, `VIEWPORT`, `parseSnapshot`, `toScreen`, `openBrowser`, `closeBrowser`, `snapshotPage`, `gotoUrl`, `clickElement`, `typeInto`, `scrollPage`, `pressKey` | KERNEL cloud Chromium; calibrated coords; cursor is real |
| `kterm.ts` | `WORKDIR`, `ExecResult`, `clipOutput`, `workPath`, `lineDiffStats`, `execInVm`, `serveInVm`, `writeFileInVm`, `readFileInVm` | same KERNEL VM as kbrowser; paths jailed to `/workspace` |
| `paypal-activity.ts` | PayPal activity rows for Studio (uniform fields) | read-only |

## Research (`lib/research/`)

| File | Exports | Notes |
|---|---|---|
| `sources.ts` | `Source`, `hostOf`, `canonicalUrl`, `mergeSources`, `trimSources`, `SYSTEM_PROMPT`, `buildMessages` | dedupe + ranking across providers |
| `run.ts` | `ResearchEvent`, `Deps`, `defaultDeps`, `research(question, signal?, deps?)` | Tavily + Exa in parallel, then free-model answer with `[n]` cites |
| `citations.ts` | `Segment`, `segmentCitations`, `usedSources` | `【n】`/`[n]` → inline chips; pure |
| `rate-limit.ts` | `allow(key, nowMs, limit?, windowMs?)`, `resetRateLimit` | shared free-tier protection |

## Computer agent (`lib/computer/`)

The unified agent behind `POST /api/agent` (SSE `CEvent`s). One main agent delegates to research/browser/terminal
subagents that share one KERNEL VM. It gathers and acts; it never sees `computeVerdict` and never touches money —
promise data arrives as read-only `pageContext` (`context.ts`).

| File | Exports | Notes |
|---|---|---|
| `events.ts` | `AgentRole`, `RunState`, `Attachment`, `CEvent` | the whole UI contract |
| `run.ts` | `Run`, `AgentRow`, `Step`, `TermBlock`, `FileEdit`, `Message`, `TimelineItem`, `newRun`, `applyCEvent`, `parseCStream`, `subagents` | pure reducer for the client |
| `model.ts` | `ModelRef`, `ModelDeps`, `defaultModelDeps`, `orderModels`, `callModel`, `resetCooldowns` | free-model rotation + 429 cooldown |
| `session.ts` | `Session`, `HistoryTurn`, `getSession`, `endSession`, `hasSession`, `mergeInto`, `remapCitations`, `pushHistory` | per-VM session, history, shared sources |
| `ctx.ts` | `Deps`, `SubCtx`, `defaultDeps`, `ensureVm` | one VM opened lazily, shared by browser+terminal |
| `main-actions.ts` | `MainAction`, `parseMainAction`, `MAIN_SYSTEM`, `mainPrompt` | delegate / answer JSON loop |
| `main-agent.ts` | `runMain(session, input, deps, signal?)` | orchestrator; only voice the user hears |
| `research-agent.ts` | `runResearchAgent(ctx, task)` | wraps `lib/research/run` |
| `browser-agent.ts` | `runBrowserAgent(ctx, task)` | snapshot → action loop on the live VM browser |
| `terminal-agent.ts` | `runTerminalAgent(ctx, task)` | run/write/read/serve loop in `/workspace` |
| `term-actions.ts` | `TermAction`, `parseTermAction`, `describeTerm`, `TERM_SYSTEM`, `buildTermMessages` | |
| `repeat.ts` | `Repeat`, `repeatState`, `REPEAT_NOTE` | loop guard for all action loops |
| `context.ts` | `PromiseFacts`, `promiseIdFromPath`, `formatPromiseContext`, `loadPageContext` | read-only `/p?id=` context |
| `promise-agent.ts` | `runPromiseAgent(ctx, task)` | unlocks premium Newsroom articles: match → create promise → approve order on live VM → settle → return unlock URL |
| `promise-ops.ts` | `createPromise`, `settlePromise`, `promiseInfo`, `findPromises` | self-calls `/api/promise` ops over HTTP (never `computeVerdict`) |
| `browse/` (`lib/browse/`) | `actions.ts` (`Action`, `parseAction`, `extractJson`, `describeAction`), `snapshot.ts` (`El`, `Snapshot`, `renderElements`, `BROWSE_SYSTEM`, `buildBrowseMessages`), `live-view.ts` (`safeLiveViewUrl`, `liveViewSrc`) | browser-agent prompt + iframe URL guard |

## Newsroom paywall (`lib/newsroom*.ts`, `app/api/newsroom/`, `app/newsroom/`)

CrawlerPal-style: premium articles answer HTTP 402 with a `standing-promise` offer to programmatic clients;
a captured Standing Promise unlocks them (`token=<promiseId>`). Proof marker: `/api/newsroom/proof` returns
`locked:<slug>` / `unlocked:<slug>` — that URL is the `page_contains` condition the promise settles against.

| File | Exports | Notes |
|---|---|---|
| `newsroom.ts` | `ARTICLES`, `Article`, `getArticle`, `listArticles`, `premiumOffer` | 5 deterministic articles, 2 premium ($0.01) |
| `newsroom-access.ts` | `articleAccess`, `isUnlockedFor`, `proofMarker` | pure unlock decision (promise captured + needle match) |
| `api/newsroom/articles` | GET list | free + premium metadata |
| `api/newsroom/article` | GET `?slug=&token=` | 402 + offer, or 200 article HTML when unlocked |
| `api/newsroom/proof` | GET `?article=` | `locked:`/`unlocked:` text for `page_contains` |
| `integrations/paypal-approve.ts` | `approveOrderOnBrowser(vm, orderId)` | scripted sandbox-buyer login on the session VM; best-effort, degrades to manual approve URL |

## UI (`components/`, `app/`)

`Composer` (create form) · `PromiseSurface` (settle, replay, manual entry, pane/outline state; dispatches `promises:changed`) ·
`shell/AppShell` + `shell/Sidebar` (global dark shell, recents, drawer) + `shell/TopBar` ·
`thread/Thread` (terms bubble, process disclosure, artifact cards, serif answer, action row, follow-ups; exports `ThreadProps`, `ThreadPromise`, `ThreadLogRow`, `PaneState`) ·
`thread/Pane` (agent/artifact detail pane, toolbar: copy, download, share, expand, close) · `thread/Outline` (Agents/Artifacts/Plugins/Sources popover) ·
`thread/Dock` (composer dock + `useDismiss`, `useStickToBottom`) · `thread/group-trace` (`groupTrace`, `processCounts`, `stepSummary`, `durationFromLog`, `isDegraded`) ·
`thread/format` (`formatDuration`) · `thread/reason-copy` (`REASON_SENTENCE`) · `thread/describe-condition` · `thread/safe-url` (`safeHttpUrl`, `hostLabel`, `sourcesFromTrace`) ·
`TracePanel` (`TraceRow` single row switch + `TracePanel` fallback aside) · `ui/Disclosure` · `ui/icons` (24 inline SVGs) ·
`PromiseTimeline` (Bryntum `svalbard-dark`, client only) · `studio/StudioBoard` (AG Studio in paper frame), `studio/registry` (`widgets`), `studio/agent` (`buildAi(adapter)`), `studio/chat-adapter` (`chatAdapter`, `toChatMessages`, `toChatTools`, `toToolChoice`, `parseDataLines`, `ChatStreamAccumulator`),
`studio/widgets/{verdict-pill,scoreboard}` ·
`agent/AgentProvider` (client state: runs, SSE consume, session id, workspace tabs, attachments) ·
`agent/AgentPanel` (the one chat, Ctrl+L, dock) · `agent/RunView` (prompt card, process disclosure, thinking, agent rows, files card, cited answer, chips) ·
`agent/Workspace` (big pane: live browser iframe + Take over, terminal blocks, files, sources, agent detail) ·
`agent/SelectionPopover` ("Add to chat" on text selection) · `agent/{AnswerText,SourcePane}` ·
pages: `/` `/p` `/board` `/timeline`. The standalone `/ask` surface was folded into this agent.

## Other

`workflows/index.ts` (Render tasks `settleOne`, `sweep`) · `astropods/*` (`agent.mjs`: `runAgent`, `runTool`, `TOOLS`; `server.mjs`: `createAppServer`; tests: `node --test astropods/agent.test.mjs`) · `postman/*` · `scripts/{check-invariants,verify,elastic-setup,zapier-tools}.mjs`.

## Import rules (the graph)

```
lib/verdict.ts         -> (nothing)
lib/money.ts, sse.ts   -> types only
lib/integrations/*     -> lib/env, lib/money, lib/verdict (TYPES), registry/types. Never db, never lib/agent
lib/agent/*            -> lib/integrations, lib/events, lib/llm, db, lib/verdict (TYPES ONLY, never computeVerdict)
lib/computer/*         -> lib/integrations (kbrowser/kterm/chat/tavily/exa), lib/research, lib/browse, db (read-only context). Never lib/verdict, never a write endpoint
lib/research/*         -> lib/integrations (tavily/exa/chat), lib/computer/model is NOT used here (own loop)
lib/capture.ts         -> db, lib/events, lib/paypal, lib/agent/trace
app/api/promise/route  -> everything above; it is the only caller of computeVerdict
components/*           -> lib/sse, lib/money, types. Never db, never lib/integrations (except pure bryntum.ts)
```

## lib/pals (D-EXAM)

| File | Exports |
|---|---|
| `lib/pals/rival.ts` | `ARCHETYPES`, `PAYPAL_CAPS`, `MUTATIONS`, `Rival` (zod), `verifyRival(input, fetched, nowMs)`, `dedupeRivals`, `FetchedPage` |
| `lib/pals/ladder.ts` | `ARCHETYPE_TABLE`, `scoreLadder(measurements, archetypes?)`, `tally`, `LadderRow`, `RowStatus` |
| `lib/pals/seal.ts` | `decideSeal(rows)` -> `SEALED \| CONDITIONAL \| REFUSED`, `MAX_LIVE_CONDITIONS` |
| `lib/pals/attacks.ts` | `runAttacks(mutations)` (real `computeVerdict`), `NOT_AT_VERDICT_LEVEL` |
| `lib/pals/exam.ts` | `runExam(rivals, observed?)` |
| `lib/pals/generate.ts` | `generateRivals(contract, deps, signal)` (async generator of steps), `pagesFrom`, `parsePlan`, `parseRivals`, `rivalMessages` |
| `lib/pals/card.ts` | `ExamCard`, `buildCard`, `summarizeCard` |
| `lib/computer/rival-agent.ts` | `runRivalAgent(ctx, task)` (RivalPal), emits `{kind:"ladder"}` |
| `lib/computer/pals.ts` | `APP_NAME`, `PAL_NAMES`, `palName` |
| `components/agent/ExamPanel.tsx` | `ExamPanel({ card })` |
| `lib/pals/measure.ts` | `PromiseRunLog`, `measureRun(log)` -> `{ values, notApplicable, from }` |
| `lib/pals/superpals.ts` | `SUPER_PALS` (frozen roster), `scoreSuperPals({ values, keysPresent })` |


## lib/swarm/tree (D-CHAIN, pure)
- `types.ts`: `Kind`, `Mode`, `Tool`, `Caps`, `SPAWNS`, `POLICY`, `SpawnRequest`, `TreeNode`, `TreeView`, `attenuate(parent, want)`, `jobKey(req)`
- `policy.ts`: `admitSpawn(tree, parentId, req, nowMs) -> Decision`, `ancestors(tree, id)`
- `budget.ts`: `BudgetNode` (`child`, `tryTake`, `release`, `left`, `spent`)
- `merge.ts`: `mergeStreams(tasks, n)` streams events as they arrive, results in input order

## lib/computer additions
- `model.ts`: `callModelHedged(agent, messages, deps, o)`; `ModelDeps.hedge`
- `process.ts`: `processLabel(run)`, `disclosureRows(run)`
- `superpal-agent.ts`: `runSuperPals(ctx, rows, now?)` -> rows with `evidence`
- `lib/pals/evidence.ts`: `pickEvidence(company, pages)`; `lib/pals/generate.ts`: `GenDeps.cache`, `CACHE_TTL_MS`

## SituationPal (D-SITUATION)
- `lib/pals/situation.ts`: `RAILS`, `NEEDS`, `parseNeeds`, `verifyCells`, `parseCells`, `mergeCells`, `unknownCells`, `queriesFor`, `scoreRails`, `buildSituationCard`, `summarizeSituation`, `classifierMessages`, `needsMessages`
- `lib/pals/probe.ts`: `CHECKS`, `stripeRows`, `squareRows`, `paypalRows`, typed-error readers
- `lib/integrations/rails.ts`: `probeStripe(runId)`, `probeSquare(runId)`, `probePayPal(run)` (capabilities `stripe`, `square`)
- `lib/computer/situation-agent.ts`: `runSituationAgent(ctx, idea)`; `components/agent/SituationPanel.tsx`; `components/ui/Pill.tsx`
- `lib/computer/model.ts`: `callModel`/`callModelHedged` take `accept(text)` so an unusable reply moves on to the next model

## Case Desk inside SituationPal (D-DESK) and Proctor (D-PROCTOR)
- `lib/pals/recommend.ts`: `judgeRecommendation(card, blind)`, `contenders`, `separated`, `blindMessages`, `parseBlind`, `REASON_TEXT`, `OUTCOMES`, `REASONS`
- `lib/pals/situation.ts`: `RailDef`, `RAILS` (seeds), `verifyRails`, `parseRails`, `scoutMessages`, `scoutPlanMessages`, `scoutQueries`, `mergeCellsDetail`
- `lib/pals/family.ts`: `familyOf`, `familyOfBare`, `excludeFamilies`; `lib/pals/receipt.ts`: `cardHash`, `receiptId`, `canon`, `sha256` (server only)
- `lib/proctor/core.ts`: `dueJobs`, `changed`, `allowEscalation`, `escalationStep`, `diffRows`, `fingerprint`; `run.ts`: `runDue(deps, schedules)`; `store.ts`: `proctorStore`
- `app/api/proctor/route.ts`; `components/ProctorPanel.tsx` (on /board)

## Streaming, visits, artifacts, reader (D-STREAM)
- `lib/computer/pump.ts` `pump(...)`: forwards model events as steps while a call runs.
- `lib/computer/json-text.ts` `answerTextSoFar(partial)`: the answer string so far from partial JSON.
- `lib/computer/visits.ts` `hostOfUrl`, `avatarOf`, `searchVisit`, `readVisit`, `groupVisits`.
- `lib/computer/artifacts.ts` `csvOf`, `parseCsv`, `artifactPath`, `putFile`, `writeArtifact`, `workspaceDigest`.
- `lib/computer/reader.ts` `readPage`, `MAX_BROWSER_READS`, `MIN_CHARS` (fetch -> browser -> terminal). 5th file: guarded fetch is `lib/integrations/webpage.ts`.
- `lib/integrations/webpage.ts` `fetchPageText` (SSRF-guarded per hop, capability `webfetch`); `lib/research/htmltext.ts` `htmlToText`.
- `components/ui/SiteChip.tsx` `SiteAvatar`, `SiteChip`, `SourceStack`; `components/agent/SearchedSites.tsx`.

## Workspace UI, model choice, images, app artifacts (D-WORKSPACE)
- `components/agent/`: `AgentHome` (main screen), `AgentPanel` (dock on other pages), `PromptBox` (input: images, selections, model pill), `ModelPill`, `ArtifactPanel` (tabs), `FileArtifact`, `FileChanges`, `DiffView`, `Markdown`, `AppArtifacts`, `ArtifactsGallery`.
  Pure helpers with tests: `panel-model.ts` (tab ids, `collectFiles`, `withTab/withoutTab`), `markdown.ts`, `image-prep.ts`, `artifact-store.ts` (localStorage list, `byMonth`).
- `lib/computer/diff.ts` `diffLines`, `readRows`; `models.ts` `LEVELS`, `modelDepsFor`, `roundsFor`, `parseChoice`; `images.ts` `ImageIn`, `sniffMime`; `request.ts` `AgentBody`; `app-data.ts` + `app-open.ts` (`open` action).
- `lib/integrations/vision.ts` `describeImages`. `ModelDeps.rotate` keeps a chosen order fixed.
- `lib/automations/`: `core` (schedule, limits, `nextRunAfter`, `canStart`, `asksForSchedule`, `parseSchedule`), `store` (file, atomic), `run` (`runAutomation`, `summarizeRun`), `tick` (`execute`, `tickDue`, `startNow`),
  `scheduler` (timer + live deps), `public`, `presets`, `token`. Routes: `app/api/automations` (GET/POST/PATCH/DELETE), `/run`, `/tick`. UI: `components/automations/AutomationsView.tsx`, `app/automations`, `app/artifacts`, `app/new`.

## Charts, palette, panels, player (D-LAYOUT)
- `lib/charts/`: `spec` (22 chart types, `profileData`, `problems`, `suggestSpec`, `resolveSpec`), `choose` (model prompt, `specFromChoice`), `prepare` (data shaping per type), `flow` (money flow, activity grid). `lib/computer/chart-action.ts` (the `chart` action).
- `components/charts/`: `geometry` (pure), `Charts` (SVG: radar, candlestick, waterfall, heatmap, donut, bars, box plot, swimlane timeline), `ChartView` (Recharts, lazy via `LazyChart`).
- `components/shell/`: `layout` (resize maths), `Resizable` (hook, handle, rail), `recents` + `SidebarMenus` + `useRecents`, `palette` + `CommandPalette`.
- `components/agent/`: `pace` (event pacing), `BrowserPip` + `pip-model`, `ChartBlock`, `AppArtifacts` (Newsroom, Dashboard, Timeline, Proctor).
- `lib/automations/stats.ts` (run grid, kpis, upcoming runs); `lib/pals/situation-charts.ts` (radar, heatmap, fit waterfall for the SituationPanel).

## Battle and Loop (D-ARENA)
- `lib/arena/` (pure, tested): `types` (`ContenderInfo`, `Outcome`, `Facts`, `Score`, `MatchResult`, `ArenaFinal`), `personas` (`PERSONAS`, `STANCES`, `lineup`), `plan` (`Plan`, `Slot`, `planProblems`, `defaultPlan`, `planMessages`, `planFromDraft`, `readPlan`, `PLAN_LABEL`),
  `plan-edit` (`updateSlot`, `addSlot`, `removeSlot`, `problemsOf`), `mode` (`parseMode`, `MODE_INFO`, `countHint`), `frame` (prompts, `parseOutcome`, `loopStop`, scenario lenses), `judge` (`detScore`, `judgeMessages`, `scrub`, `parseJudge`, `scoreAll`, `meanScores`, `judgeOrder`),
  `bracket` (`buildBracket`, `resolve`, `nextMatch`, `standings`), `duel` (`duel`, `recover`, `whyResult`), `replay` (`replay`: frames for the hit animation), `explain` (`whyBullets`, `winnerEdge`, `dimGrid`, `evidenceMatrix`, `calibrationPoints`, `loopCurve`, `unjudgedNote`),
  `diff` (`roundDiff`, `stability`, `tokens`, `overlap`), `view` (`entriesOf`, `roundViews`, `progressOf`, `placeOf`, `statusText`, `splitFinal`, `evidenceLines`, `pathOf`), `report` (markdown and CSV), `run` (`runArena`, `proposePlan`, `pinsFor`, `factsOf`).
- Routes: `app/api/agent/route.ts` (body `mode`, `approved`; limits 2 a minute per IP and 2 at once), `app/api/arena/plan/route.ts` (POST draft a plan; writes nothing). Events: `arena`, `contender`, `contender_add`, `contender_done`, `arena_phase`, `arena_scores`, `arena_match`, `arena_final`; `Run.arena` is built by `applyCEvent`.
- `components/arena/`: `board` (pure grid maths), `PanelBoard`, `ContenderPanel`, `Stage` + `StageBits`, `BattleStage`, `Bracket` (+ `MatchWhy`), `Duel` (the hit playback), `LoopStage` (rail, flight, popover), `Diff` (`RoundBrief`, `DiffView`), `Results` + `LoopResults` + `ResultsParts` + `ArenaCharts`, `PlanDialog`, `ArenaSummary` (thread card).
- `components/orbs/`: `palette`, `gaze`, `mood`, `budget`, `Eyes`, `Orbs` (`FlatOrb`, `AgentOrb`, `BattleOrb`, `UltraOrb`, all memoized). `components/ui/`: `Menu`, `HoverCard` + `hover-place`, `live-orb`, icons.
- `components/agent/`: `ModeBar`, `prompt-model`, `pump` (the display queue), `CiteCard` + `excerpt`. `AgentProvider` holds `mode`, `drafts`, `pendingPlan`, `stage`.


## Browser window and handoff (D-HANDOFF)
- `lib/browse/`: `address` (`normalizeAddress`, `SEARCH_URL`), `actions` (`Action`, `BROWSER_KEYS`, `parseAction` incl. optional `note`, `describeAction`), `snapshot` (`BROWSE_SYSTEM`, `buildBrowseMessages`, `changeNote`, `scrollLine`, `textChange`, `memoryText`),
  `handoff` (`needsHuman`, `noticeFor`, `Handoff`, `freshHandoff`, `parseResume`, `resumeTask`, `handoffMessage`, `pendingNote`, `sameAsk`, `sameSpot`, `HANDOFF_TTL_MS`).
- `lib/integrations/kbrowser.ts` (Kernel adapter, `kiosk_mode`): `openBrowser`, `snapshotPage`, `gotoUrl`, `clickElement`, `typeInto`, `selectOption`, `scrollPage`, `pressKey`, `findText`, `waitSeconds`, `navigate` (back, forward, reload through CDP history), `browserState`, `vmAlive`, `plainError`.
- `lib/computer/`: `browser-agent` (the loop: look, auto-wait, `needsHuman`, hedged call with `accept`, notes, handoff, resume guards), `ctx` (`SubCtx.interactive`, `SubCtx.resumed`, `ensureVm` health check), `main-agent` (`firstDelegate`, `waitForPerson`, `NO_FINAL_ANSWER`, `WAITING_FOR_YOU`),
  `models` (`BROWSING_FIRST`, `browsingDeps`), `model` (`callModel` `accept`; `ModelResult.rejected`), `reader` (walls are blocked, not content).
- `app/api/browser/route.ts` (5th file: a new route): GET state; POST `goto`, `back`, `forward`, `reload`, `open`. Rate limited (90 state reads, 40 actions, 4 new browsers per 5 minutes per IP).
- `components/agent/`: `BrowserPip` + `pip-model` (connection state machine), `BrowserBar` (`AddressBar`, `AgentBox`), `browser-client` (calls the route), `HandoffCard` (the thread card). `lib/computer/events.ts` has the `handoff` event.

## History, saved conversations and automation kinds (D-HISTORY)
- `components/shell/`: `history` (pure: `HItem`, `fromPromise`, `fromAutomation`, `fromConvo`, `filterItems`, `toggleKind`, `countsByKind`, `sortItems`, `groupItems`, `splitPinned`, `togglePin`, `toggleKey`, `bulkPlan`, `pinBulk`, `parsePrefs`, `ago`), `useHistory` (the three sources merged), `useRecents` (`useRecents`, `useHistoryPrefs`),
  `Sidebar`, `SidebarMenus` (`SortGroupMenu`, `KindChips`, `RowMenu`), `recents` (`Item`, `stateLabel`).
- `components/agent/convos.ts` (pure apart from the storage it is handed): `titleOf`, `kindsOf`, `statusOf`, `trimRun`, `sigOf`, `bodyOf`, `saveConvo`, `loadConvo`, `readIndex`, `renameConvo`, `removeConvos`. `AgentProvider` adds `convoId`, `openConvo`, `deleteConvos`, `renameConvo` and `send(message, { chat })`.
- `lib/automations/`: `kinds` (`KINDS`, `KIND_INFO`, `IDEAS`, `TEAM_OF`, `MAX_HEAVY_ON`, `kindOf`, `countFor`, `dailyCapFor`, `timeoutFor`, `staleFor`), `core` (`Spec` with `kind` and `count`, `heavyOn`, `heavyRoom`, `asksForSchedule`), `run` (`framePrompt` by kind, `previousReport`, `parseWatch`, `watchTask`, `RunDeps.arena`),
  `public` (`toBrief`, `PublicBrief`), `presets` (`presetsFor`, the weekly preset), `store` (the heavy cap). `app/api/automations` takes `?brief=1`.
- `components/automations/`: `AutomationsView` (centered form, `KindMenu`, ideas, the list below), `PalStack` (`memberName`).

## Effort, orbs, context and suggestions (D-HISTORY)
- `components/orbs/`: `effort` (`EFFORT_THEME`, `effortOf`, `growStyle`), `EffortContext` (`EffortProvider`, `useEffort`); `Orbs` takes an optional `level`. `components/ui/live-orb.tsx` takes `style`.
- `lib/usage/`: `tokens` (`estimateTokens`, `messagesTokens`, `usageFor`, `WINDOWS`, `contextWindow`, `formatTokens`, `percentLabel`, `fillOf`, `MAIN_BASELINE_TOKENS`), `rings` (`ringsFor`, `Ring`). `lib/computer/model.ts` yields the `usage` event (`usageEvent`) and `ModelResult.usage`; `run.ts` folds it into `Run.usage`.
- `components/agent/`: `ContextRings` (`ringHeadline`, `ringSource`), `suggestions` (`SUGGESTIONS_BY_MODE`, `suggestionsFor`, `startsAtOnce`, `SUGGESTION_CAPTION`), `prompt-model` (`FILL_EVENT`, `fillPrompt`).
