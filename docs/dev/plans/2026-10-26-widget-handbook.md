# Widget Handbook Implementation Plan

**Goal:** Give users and agents a versioned project entry point and a reliable React-widget authoring reference, while retaining the existing `/help` command descriptions.

**Architecture:** Keep `docs/widgets.md` as the stable entry point and place focused authoring chapters in `docs/widgets/`. Keep GitHub URLs in `package.json`; the controller uses them for `/help` and agent instructions. Validate documentation against the implemented renderer, build sandbox, and focused tests.

**Constraints:** Preserve existing `/help` permissions and command descriptions. Do not claim inline overlays or unrestricted Node access. Keep current wiki prose in English and existing relative links valid. Merge this branch with the independently verified Wordle overlay fix after both have passed checks.

## Tasks

- [ ] Add focused JSX, state, view, and runtime chapters; update the stable widget entry point and wiki navigation.
- [ ] Use `package.json` documentation links in `/help` and agent instructions; remove detailed store API prose from the agent prompt.
- [ ] Add focused help/instruction assertions, check all wiki links and examples, and run the full test suite.
- [ ] Review and commit this branch, combine it with the Wordle fix on `main`, retest, and push.
