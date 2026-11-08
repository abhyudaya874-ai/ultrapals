# BACKLOG

## Now
- [x] Computer agent (Perplexity-Computer shell + unified agent): dark shell/sidebar/thread/dock/panes; `lib/computer` main→research/browser/terminal subagents on one KERNEL VM; Groq+OpenRouter free models with rotation; Tavily+Exa parallel with inline citations; `/api/agent` SSE; agent panel (Ctrl+L), selection "Add to chat", workspace pane (live browser/terminal/files/sources); `/ask` folded in
- [ ] C7 promise subagent + CrawlerPal newsroom paywall (402 → approve → unlock) — payment through Standing Promise, scripted sandbox approval
- [ ] C8 docs + live rehearsal through the quick tunnel (`PUBLIC_URL`)
- [ ] P4 zapier nudge: code ready, BLOCKED on ZAPIER_MCP_TOKEN (needs user's Zapier MCP endpoint)
- [x] P1 bootstrap done (commit f848253): verify green, dev on :3001, caps studio/channel3/kernel/bryntum on
- [x] P2 money path done: create->approve->settle->CAPTURE->1 row, dedup, replay identical, expiry RELEASE (commits cb3b7ef, 4cc9e1a)
- [x] P3 world done: channel3 schema fixed to live shape, CONDITION_MET/PENDING/UNMET all proven, CAP_CHANNEL3=0 -> FACT_MISSING, manual fallback, page_contains via KERNEL, approvals automated (scripts/kapprove.mjs)
- [x] P4 surfaces mostly done: /board prewired (pill+scoreboard+still-to-come+grid+chart), /api/studio/paypal live, still-to-come widget + copy test, CAP_STUDIO=0 -> [] + x-degraded proven, bryntum fontawesome fixed

## Next
- [ ] Day 2: settle happy path with a real sandbox buyer approval
- [ ] Day 3: `/wire-world-condition`; failure paths (double click, decline, network off)
- [ ] Day 4: `/wire-studio-dashboard`, `/wire-bryntum`, `/wire-zapier`
- [ ] Day 5: `/wire-render`, `/postman-setup`, `/apimatic-verify-paypal`, README
- [ ] Day 6: `/demo-freeze`

## Deferred (not on a demo beat)
- auth, multi-tenant, email beyond the nudge, webhooks beyond capture, admin UI, i18n
- AG Studio dark theme: `createStudioTheme()` accepts no params and no dark preset is exported; the board sits in a `rounded-2xl bg-white` paper frame inside the dark shell until a theme can be built from `AgStudioThemeParams` (~80 keys, needs vendor docs)
- persisted trace: agent rows/diff/explanation live only in SSE memory; a reloaded `/p` shows the event-log fallback + REASON_SENTENCE. Persisting `TraceEvent[]` would restore the full thread on reload
- refunds (a `refunded` state needs schema + logic + UI; the Bryntum brief mentions refund markers)
- Studio agent adapter polish; Elastic Agent Builder tools beyond one ES|QL tool
- DNS-rebinding defence in `url-guard.ts`

## Lessons
(append one paragraph per post-mortem)
