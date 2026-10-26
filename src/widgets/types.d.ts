import type * as React from "react";

export type JSONValue =
  | null
  | boolean
  | number
  | string
  | JSONValue[]
  | { [key: string]: JSONValue };
/** State normalizes like JSON: undefined object fields disappear; array slots become null. */
export type StateValue = null | boolean | number | string | undefined
  | StateValue[] | { [key: string]: StateValue };
export type State = Record<string, StateValue>;
/** An ordinary address is durable; ephemeral addresses are scoped to a recipient. */
export type ReactViewTarget =
  | { chatId: number; messageId: number }
  | { chatId: number; topicId?: number; reply_parameters?: Record<string, JSONValue> }
  | { inlineMessageId: string }
  | { guestRequestId: string }
  | { chatId: number; receiverUserId: number; ephemeralMessageId?: number };
export type ReactViewStatus = "active" | "error" | "disabled";
export interface ReactViewHandle {
  readonly id: string;
  readonly target: Readonly<ReactViewTarget>;
  readonly props: Readonly<Record<string, unknown>>;
  readonly message: Readonly<Record<string, unknown>> | null;
  readonly parent: ReactViewHandle | null;
  readonly user: Readonly<{ id: number }> | null;
  readonly status: ReactViewStatus;
  readonly error: Readonly<{ code: string; message: string }> | null;
  mount(node?: React.ReactNode, options?: { force?: boolean }): Promise<ReactViewHandle>;
  unmount(): Promise<void>;
  closeOverlay(): Promise<void> | undefined;
  getOverlays(): readonly ReactViewHandle[];
}
export interface ReactWidgetHandle {
  readonly id: string;
  mount(target: ReactViewTarget | string, node: React.ReactNode, options?: { force?: boolean }): Promise<ReactViewHandle>;
  unmount(target: ReactViewTarget | string): Promise<void>;
  closeOverlays(target: ReactViewTarget | string): Promise<void>;
  getView(target: ReactViewTarget | string): ReactViewHandle | null;
  notifyAgent(payload: { text: string }): Promise<void>;
  requestAgent(payload: { text: string; responseSchema?: Record<string, JSONValue>; data?: JSONValue }, options: { timeoutMs?: number; signal?: AbortSignal }): Promise<JSONValue>;
}
export interface ReactButtonEvent {
  readonly from: Readonly<{ id: number }>;
  readonly view: ReactViewHandle;
  readonly callbackQueryId: string;
  overlay(node: React.ReactNode, options?: { force?: boolean }): Promise<ReactViewHandle>;
  respond(answer?: string | { text?: string; showAlert?: boolean }): Promise<void>;
}
export declare function defineStore(options: {
  version: number;
  initialState: State | ((oldState: State | undefined, oldVersion: number) => State);
}): void;
export declare function useSelector<T>(selector: (state: State) => T): T;
export declare function useDispatch(): (recipe: (draft: State) => void) => void;
export declare function useWidget(): ReactWidgetHandle;
export declare function useView(): ReactViewHandle;
export declare function useViews(): readonly ReactViewHandle[];
export declare function useTelegram(): ScopedTelegramAPI;
export declare function useOnMessage(callback: (message: unknown) => void): void;
export declare function useOnReply(callback: (event: unknown) => void, options?: { disabled?: boolean }): void;
export declare function useOnReaction(callback: (event: unknown) => void, options?: { disabled?: boolean }): void;
export declare function useDice(): readonly [number | null, string | null];
export interface ScopedTelegramAPI {
  [method: string]: (args: Record<string, unknown>) => Promise<unknown>;
}

// React owns the JSX namespace; these native Telegram tags are host elements.
declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "tg-keyboard": Record<string, unknown>;
      "tg-button-row": Record<string, unknown>;
      "tg-button": { onClick?: (event: ReactButtonEvent) => unknown; disabled?: boolean; style?: string; url?: string; copy_text?: string; switch_inline_query?: string; switch_inline_query_current_chat?: string; switch_inline_query_chosen_chat?: Record<string, unknown>; children?: React.ReactNode };
      "tg-dice": { emoji?: string };
      "tg-sticker": { src: string };
      "tg-emoji": Record<string, unknown>;
      "tg-time": Record<string, unknown>;
      "tg-reference": Record<string, unknown>;
      "tg-map": Record<string, unknown>;
      "tg-math": Record<string, unknown>;
      "tg-math-block": Record<string, unknown>;
      "tg-slideshow": Record<string, unknown>;
      "tg-collage": Record<string, unknown>;
      "tg-document": Record<string, unknown>;
    }
  }
}