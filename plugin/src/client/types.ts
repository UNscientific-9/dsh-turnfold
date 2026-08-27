/**
 * 共享行类型：行描述与成员事实。
 *
 * 零依赖模块——被 row-membership / row-classify / row-apply / scroll /
 * apply-plan / projector-core / membership-persist 以 type-only 方式引用，
 * 不产生任何运行时依赖边，因此不会形成模块环（madge --circular 为空）。
 */
export interface RowDescriptor {
  /** `data-chat-anchor-key` value (`conversationContextKey(kind, id)`). */
  readonly key: string;
  /** `data-chat-flow-kind` value; informational fallback only. */
  readonly kind: string | undefined;
}

/** A described row bound to its live element. */
export interface RowWithElement extends RowDescriptor {
  readonly element: HTMLElement;
}

/** Membership facts for one completed turn, mirroring the node data the view
 *  renders into `data-dsh-ta-*`. */
export interface SummaryRef {
  readonly turn: number;
  readonly finalStep: number | undefined;
  readonly toolCallIds: readonly string[];
  /** Correlated `llm/retry` ids; `model-retry` rows keyed by these ids are
   *  hidden together with the turn's activity. */
  readonly retryIds: readonly string[];
  /** The session this summary row was rendered for; read from the DOM so
   *  the projector never re-derives session ownership and so two `data-chat-flow`
   *  columns rendered for different sessions can each apply their own store
   *  decisions without cross-contamination. */
  readonly sessionId: string | undefined;
}
