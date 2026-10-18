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
    | "local"
    | "view_delete";
  receivedAt: string;
  delayed: boolean;
  /** For button events: the original Telegram CallbackQuery; data.data is the full callback_data. */
  data: unknown;
  user?: Record<string, unknown>;
  fromWidgetId?: string;
  view?: WidgetView;
  reason?: "message_deleted"|"message_not_found"|"access_lost";
  respond?: (
    answer?: string | { text?: string; showAlert?: boolean } | null,
  ) => Promise<void>;
}
export type WidgetTarget = {chatId:number;messageId:number} | {inlineMessageId:string};
export interface WidgetView {readonly id:string;readonly target:Readonly<WidgetTarget|{chatId:number}>;readonly props:Readonly<Record<string,JSONValue>>;}
export interface WidgetAPI {
  create_widget(args:{handler:string;description:string;state?:State}):Promise<{widgetId:string}>;
  update_widget(args:{widgetId:string;handler?:string;description?:string;state?:State}):Promise<{widgetId:string;renderErrors?:{viewId:string;code:string;message:string}[]}>;
  set_widget_view(args:{widgetId:string;props?:Record<string,JSONValue>;send?:{chatId?:number;topicId?:number;reply_parameters?:Record<string,JSONValue>;disable_notification?:boolean;protect_content?:boolean;message_effect_id?:string};target?:WidgetTarget|{messageId:number}}):Promise<{viewId:string;target:WidgetTarget}>;
  delete_widget_view(args:{viewId:string}):Promise<void>;
  delete_widget(args:{widgetId:string}):Promise<void>;
  list_widgets(args?:{}):Promise<{canCreate:number;items:Record<string,unknown>[]}>;
  get_widget(args:{widgetId:string}):Promise<Record<string,unknown>>;
  widget_event(args:{widgetId:string;name:string;data?:JSONValue}):Promise<void>;
  notify_agent(args:{text:string}):Promise<void>;
  stop_poll(args:{viewId:string}|{chatId:number;messageId:number}):Promise<Record<string,unknown>>;
  stop_live_location(args:{viewId:string}|WidgetTarget):Promise<Record<string,unknown>|boolean>;
  [method:string]:(args:any)=>Promise<any>;
}
export interface WidgetContext {
  widgetId: string;
  state: State;
  /** @deprecated There is no primary message. Use event.view or render(state,view). */
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
