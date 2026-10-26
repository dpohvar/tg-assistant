# Archived widget engine tests

These tests exercise the pre-React `render(state, view)` engine, named action callbacks, and its durable event queue. Schema 21 removes those registrations and the new service does not load that runtime. They are kept here as historical behavior evidence; `npm test` runs the replacement `react-widget-*.test.mjs`, React game/editor integration tests, and the unaffected controller suite in `test/integration`.

The archived guest and inline acceptance tests also import the former Wordle fixture and manual runners. They are no longer executable against the React engine; the new `react-wordle-ui.test.mjs` covers guest/inline mounting and game input in a real sandbox. Their corresponding live evidence remains historical until the new bounded Telegram check is completed.

Do not adapt these tests with compatibility shims. For a behavior that still matters, add a focused test against `createReactWidgetManager`, `createReactWidgetProcess`, or the materialized sandbox service.
