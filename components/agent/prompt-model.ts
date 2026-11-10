/** Pure. Whether the send button is live: some text, or at least one picture, and no picture still being prepared. */
export const canSend = (text: string, pictures: number, preparing = 0): boolean => preparing === 0 && (text.trim().length >= 2 || pictures > 0);

/** Pure. The hint inside the box: what a message will do in the current mode. */
export const placeholderFor = (kind: "chat" | "battle" | "loop", busy: boolean, waiting = false): string =>
  waiting && !busy ? "Say \"continue\" when you have done it in the browser…"
  : busy ? "Send a follow-up when it finishes…"
  : kind === "battle" ? "Describe the scenario. Teams will argue opposite predictions…"
  : kind === "loop" ? "Describe the scenario. Each round tests a different version of it…"
  : "Type a command…";
