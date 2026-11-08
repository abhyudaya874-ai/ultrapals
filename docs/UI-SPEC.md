# UI spec

Grammar borrowed from Perplexity Computer: a dark task workspace — sidebar, centered serif thread,
collapsible process groups, right detail pane, bottom rounded dock, outline popover.
Everything on screen is real data from the app; a surface with no real backing is omitted, never mocked.

## Global shell (`components/shell/`)

`AppShell` wraps every page (`app/layout.tsx`): `h-dvh` flex row, canvas `#15171b`.

| Piece | Behavior |
|---|---|
| `Sidebar` | 272px (`~19%` of content at 1440), `#1b1d21`. Logo → `/`, Search button toggles a client-side filter over recents, nav rows (`New promise` → `/`, `Dashboard` → `/board`, `Timeline` → `/timeline`), `Promises` = recents from `GET /api/promises/recent?limit=40` (dot per state, active row highlighted, hidden when the filter has no match), footer = `PayPal sandbox` pill + "N of 8 vendors on". Below `lg` it is an off-canvas drawer (`translate-x`, backdrop, Esc/outside-click close via `AppShell`'s `useShell`). A `promises:changed` window event (dispatched by `PromiseSurface` after settle) refetches recents. |
| `TopBar` (`/p` only) | `h-14`: drawer button (<lg only), truncated promise title, Outline (list) toggle (`aria-pressed`), `Copy link` pill → `navigator.clipboard` + `location.href`. |

## `/` home

Hero (serif "Standing Promise" + one line), capability strip (each vendor on/off, real `/api/capabilities`),
the composer dock, and below it the same recents list. Composer posts the identical `create` body as before.

## `/p` thread grammar (`components/thread/`)

```
sidebar │ topbar: title · outline · copy link
        │ thread column max-w-[720px], serif answer, px-6, pb clears the dock
        │   TermsBubble      title + amount · window end · state + describeCondition, line-clamp-3 "Read more"
        │   process          Disclosure "Working..." (live) / "Finished <dur>" + "N agents · M tool calls"
        │                    agent rows: state dot, agent glyph, title, stepSummary, ms → opens agent pane
        │                    (no live trace → persisted event-log rows instead; duration from log timestamps)
        │   source card      decide() · lib/verdict.ts +n −0 → opens source artifact (live trace only)
        │   verdict card     "Verdict brief · Document" → opens verdict artifact
        │   answer           serif sentence (live explanation ?? REASON_SENTENCE) + reason→consequence chip
        │   action row       Copy verdict (clipboard JSON) · Replay verdict (runReplay) · "N sources" (outline)
        │   follow-ups       Open dashboard · See on timeline · Replay verdict (return-arrow prefix)
        │ dock               rounded-dock teal pill: status line or manual-entry form + "+" menu + settle button
        │ outline popover    Agents · Artifacts · Plugins · Sources (absolute under topbar, Esc/outside close)
        │ pane (right)       agent steps | verdict brief | decide() source | event log; lg split ~1:1,
        │                    <lg fullscreen sheet; Esc/outside-click/X close; Expand = fixed overlay
```

`groupTrace(trace)` (pure, tested) reduces `TraceEvent[]` → `{groups, diff, explanation, verdictSeen}`.
`TraceRow` (`components/TracePanel.tsx`) is the single row renderer reused by the process list, agent pane
and log views. `sourcesFromTrace` extracts http(s) args from tool events for the sources count and outline.

## Computer agent (`components/agent/`) — the one chat, everywhere

`AgentProvider` (inside `AppShell`, so it follows every page) owns runs, the SSE consume, the session id
(`sessionStorage["sp-agent-session"]`), workspace tabs and text-selection attachments. `Ctrl+L` toggles the
panel (sidebar "Computer" row on touch), `Esc` closes it while the dock is focused. `POST /api/agent` streams
`CEvent`s; `lib/computer/run.ts` reduces them into `Run`s — pure, tested.

```
sidebar │ agent panel (440px, fixed sheet <lg)     workspace (over the page column, <lg fullscreen)
        │   header: Computer · working/ready · new · close
        │   thread: prompt card (+ selection quotes) · process Disclosure (agent rows → workspace)
        │           · Thinking Disclosure · files card · serif AnswerText with [n] cite chips
        │           · chips row: N sources · Browser · N commands
        │   dock:    rounded-dock teal pill, attachments row, textarea, send/stop
        │ workspace tabs: Browser | Terminal | Files | Sources N | Agent
        │   Browser   live KERNEL iframe (read-only; "Take over" posts KERNEL_SET_READ_ONLY), url bar, page events
        │   Terminal  every term block: $ command, state dot, exit, ms, capped output
        │   Files     every file edit: path, +adds −removes, expandable preview
        │   Sources   SourcePane cards (same as before)
        │   Agent     one subagent's steps/reasoning/terms/files
```

Selection: selecting ≥2 chars of page text shows an "Add to chat" pill (`Ctrl+L` does the same); the text +
its route become an attachment chip in the dock, capped at 5. On `/p` the route also gives the agent the
promise's stored facts as read-only context. Workspace auto-opens on the first `workspace` event (live view
URL) and stays open across runs; `DELETE /api/agent?sessionId=` (New chat) ends the session and its VM.

## Trace grammar (unchanged semantics, dark tokens)

| Event | Visual |
|---|---|
| tool | mono name, args one line, ms right, state dot. Degraded vendor = red row with reason |
| subagent | becomes an agent row inside the process group (dot + title + summary + ms) |
| diff | real `decide()` source from `lib/verdict.ts`, streamed, `+n −0` badge; pane shows it with line numbers |
| thought | dim italic ≤ 3 lines |
| verdict | reason code inside the group; verdict card + chip in the thread |
| done | final state; `(duplicate request, first result returned)` when deduped |
| error | inline red, never a toast |

## Other pages

| Route | What |
|---|---|
| `/board` | AG Studio dashboard inside a `rounded-2xl bg-white` paper frame — the vendor ships no dark theme (`createStudioTheme()` takes no params; verified in `.d.ts`), tracked in BACKLOG |
| `/timeline` | Bryntum Scheduler with `svalbard-dark.css` (a real shipped theme), drag-to-reschedule unchanged |

## Rules

- Append-only trace (same id supersedes). No layout shift (fixed row min-height). Errors inline, never toast.
- Icon-only buttons carry `aria-label`; disclosures carry `aria-expanded`; Esc closes panes, popovers, drawer, menus.
- Focus ring: `:focus-visible` accent outline (globals.css). Motion: CSS only, ≤200ms, killed under `prefers-reduced-motion`.
- No third-party subresources: inline SVG icons (`components/ui/icons.tsx`), local letter tiles for source hosts, system fonts only.
- Colour: `ok` green = met, `warn` amber = indeterminate, `bad` red = unmet/error; tokens live in `app/globals.css` `@theme`.
- The scoreboard stays friendly ("on track / waiting / missed it"), never a collections report.
