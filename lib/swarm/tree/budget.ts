/**
 * Hierarchical call budget. A child reserves its allowance from its parent up front, so a subtree can never spend more than it
 * was given and the root can never be overspent. When a child finishes, its unused allowance returns to the parent and only
 * what it really spent stays charged. The deadline always clamps to the parent's.
 */
export class BudgetNode {
  private direct = 0; // calls this node spent itself
  private settled = 0; // calls finished children spent (already charged)
  private alloc = 0; // allowance held by children that are still running
  private kids: BudgetNode[] = [];
  private done = false;

  constructor(readonly calls: number, readonly deadlineMs: number, private readonly parent?: BudgetNode) {
    if (!Number.isInteger(calls) || calls < 0) throw new RangeError("budget calls must be an integer >= 0");
  }

  /** Calls still available to spend or hand to a new child. */
  get left(): number {
    return this.calls - this.direct - this.settled - this.alloc;
  }
  /** Everything this subtree has spent so far, descendants included. */
  get spent(): number {
    return this.direct + this.settled + this.kids.reduce((n, k) => n + k.spent, 0);
  }

  child(calls: number, deadlineMs: number): BudgetNode {
    if (!Number.isInteger(calls) || calls < 0) throw new RangeError("child calls must be an integer >= 0");
    if (this.done) throw new RangeError("budget is released");
    if (calls > this.left) throw new RangeError(`child asks ${calls} calls, only ${this.left} left`);
    const c = new BudgetNode(calls, Math.min(deadlineMs, this.deadlineMs), this);
    this.alloc += calls;
    this.kids.push(c);
    return c;
  }

  /** Spends one of THIS node's own calls. False (nothing spent) when out of calls or past the deadline. */
  tryTake(nowMs: number): boolean {
    if (this.done || nowMs >= this.deadlineMs || this.direct + this.settled + this.alloc >= this.calls) return false;
    this.direct++;
    return true;
  }

  /** Called once when the child is finished: unspent allowance goes back to the parent. A second call does nothing. */
  release(): void {
    if (!this.parent || this.done) return;
    const used = this.spent;
    this.close();
    this.parent.alloc -= this.calls;
    this.parent.settled += used;
    this.parent.kids = this.parent.kids.filter((k) => k !== this);
    this.kids = [];
    this.direct = used;
    this.settled = 0;
  }

  /** A finished subtree can neither spend nor spawn: closes this node and every descendant. */
  private close(): void {
    this.done = true;
    for (const k of this.kids) k.close();
  }
}
