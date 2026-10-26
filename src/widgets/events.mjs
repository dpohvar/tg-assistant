import {createReactWidgetEvents} from './react-events.mjs';

/** The controller routes widget callbacks and subscribed observations through React only. */
export function createWidgetEvents({manager,telegram}){
  return createReactWidgetEvents({manager,telegram});
}
