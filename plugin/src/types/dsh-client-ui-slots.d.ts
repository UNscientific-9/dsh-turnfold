/**
 * Minimal local stub for `@deepseek-ai/dsh-client-ui-slots`.
 *
 * The npm registry publishes only an outdated 0.0.1-rc.1 of this package that
 * conflicts with the DSH 0.1.1-rc.2 dependency tree, and the installed DSH
 * bundle does not ship it (it is a build-time type package only). The shipped
 * `@deepseek-ai/*` client bundles declare these types in their `.d.ts` files,
 * so TypeScript needs the module to exist. This stub declares just enough,
 * loosely typed, to resolve those references; `skipLibCheck` keeps the
 * shipped declarations from being fully re-checked against it. Runtime code
 * never imports this module — esbuild marks `@deepseek-ai/*` external.
 */
declare module '@deepseek-ai/dsh-client-ui-slots' {
  export interface SlotMap {}
  export interface LocaleNamespaceMap {}
  export type LocaleId = string;
  export type LocaleDictOf<Namespace extends keyof LocaleNamespaceMap & string> = Record<
    string,
    string
  >;
  export type TranslateNS<Namespace extends keyof LocaleNamespaceMap & string> = (
    key: string,
    params?: Record<string, string>,
  ) => string;
  export interface Translate {
    (key: string, params?: Record<string, string>): string;
  }
  export interface SlotSpec {
    [key: string]: unknown;
  }
  export interface SlotRenderer {
    (props: any): unknown;
  }
  export interface StoredEntry {
    [key: string]: unknown;
  }
  export interface LiveSlotNode {
    [key: string]: unknown;
  }
  export interface LocaleFace {
    [key: string]: unknown;
  }
  export type OwnerOf<Slot extends keyof SlotMap & string> = SlotMap[Slot] extends infer Owner
    ? Owner extends { owner: infer O }
      ? O
      : never
    : never;
  export class SlotCore {
    register: (...args: any[]) => any;
    inject: (...args: any[]) => any;
  }
  export interface PropsRuntime<Name extends string, Kind extends string> {
    node: any;
    useSession: any;
    useSessions: any;
    useStore: any;
    renderSlot: any;
    renderSlotChain: any;
    openFile: any;
    inspectCall: any;
    forkAt: any;
    cwd: any;
    selectedCallId: any;
    fileMentions: any;
    renderMessageImages: any;
  }
  export interface PropsLocale<Name extends string> {
    t: (key: string, params?: Record<string, string>) => string;
  }
  export interface PropsRenderSlots<Names extends string> {
    renderSlot: any;
  }
  export interface PropsStore<State> {
    useStore: any;
  }
  export interface GlobalStandardProps {
    useSessions: any;
    useWorkspaces: any;
  }
}
