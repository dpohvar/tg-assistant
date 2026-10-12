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
export interface WidgetEvent {
  /** For button events: the action before the first colon in callback_data. */
  name: string;
  source:
    | "button"
    | "reply"
    | "reaction"
    | "poll"
    | "poll_answer"
    | "agent"
    | "widget"
    | "local";
  receivedAt: string;
  delayed: boolean;
  /** For button events: the original Telegram CallbackQuery; data.data is the full callback_data. */
  data: unknown;
  user?: Record<string, unknown>;
  fromWidgetId?: string;
  respond?: (
    answer?: string | { text?: string; showAlert?: boolean } | null,
  ) => Promise<void>;
}
export interface SetWidget {
  widgetId?: string;
  messageId?: number;
  chatId?: number;
  handler?: string;
  description?: string;
  state?: State;
  topicId?: number;
  reply_parameters?: Record<string, unknown>;
  disable_notification?: boolean;
  protect_content?: boolean;
  message_effect_id?: string;
}
export interface WidgetAPI {
  set_widget(
    args: SetWidget,
  ): Promise<{ widgetId: string; chatId: number; messageId: number | null }>;
  delete_widget(args: { widgetId: string }): Promise<void>;
  widgets(args?: {}): Promise<{
    canCreate: number;
    items: Record<string, unknown>[];
  }>;
  widget_state(args: { widgetId: string }): Promise<State>;
  widget_event(args: {
    widgetId: string;
    name: string;
    data?: JSONValue;
  }): Promise<void>;
  render_widget(args: { widgetId: string; state?: State }): Promise<void>;
  notify_agent(args: { text: string }): Promise<void>;
  [method: string]: (args: any) => Promise<any>;
}
export interface WidgetContext {
  widgetId: string;
  state: State;
  readonly message: Record<string, any> | null;
  readonly queueInfo: { pending: number; dropped: number };
  readonly signal: AbortSignal;
  readonly api: WidgetAPI;
  enqueue(name: string, data?: unknown): boolean;
  render(): Promise<void>;
  setTimeout(fn: () => void, delay: number): ReturnType<typeof setTimeout>;
  setInterval(fn: () => void, delay: number): ReturnType<typeof setInterval>;
  clearTimeout(id: ReturnType<typeof setTimeout>): void;
  clearInterval(id: ReturnType<typeof setInterval>): void;
  use<T>(resource: T, dispose?: (resource: T) => void | Promise<void>): T;
  defer(dispose: () => void | Promise<void>): void;
}
export interface JSXNode {
  type: string;
  props: Record<string, any>;
}
export namespace JSX {
  type Element = JSXNode;
  interface IntrinsicElements {
    [tag: string]: Record<string, any>;
  }
}
