# Wordle migration verification

Status: final legacy/current repeat and actual model management exercised. Held-open two-view play was visually confirmed by the user; source files remained unchanged.

The supplied archive was not edited. SHA-256: `f3279705d3873ed9588c6f2a88bf6e41a07ab4b8480865a4300238dc65a3d084`. The immutable legacy tree was exported from `8468767d139df48b50e52680b8a74ebeddabd7aa`. Both stages used the same isolated database, agent identity, workspace and controller snapshots; no production database was opened.

| Check | Evidence |
| --- | --- |
| Legacy publication | Real old createWidgetService and Windows sandbox published the archived game in the designated user's private test-bot chat |
| Legacy play | User clicked Start and a letter; confirmed that the letter appeared |
| Upgrade | New schema 16 opened the same database; widget/agent/message IDs and a stable migrated view were verified |
| Old callback | Real click on the old message worked through the new runtime |
| Handler update | New update_widget with the same handler retained saved state and address |
| Multiple views | Second ordinary message attached, runtime restarted; user clicked it and confirmed that both messages updated |
| Detachment | Second view detached with disabled buttons; first view still accepted a real click |
| Delete | Widget deleted; remaining message retained with buttons disabled, confirmed by user seeing both inactive |
| Source integrity | Source hashes matched before/after all stages |
| Timer with no views | Automated runtime coverage only; not yet a live Wordle acceptance |
| Native-model management of the migrated widget | Actual registered list_widgets, get_widget and an empty update_widget succeeded on the previous widget ID without resetting state |
| Native session reset | Deleted the fixture's native session and created a new tool session; agent identity, widget state and view IDs were unchanged |
| Final visual control | Held both messages open; user pressed a letter on the second and then the first, confirming synchronized updates. User then explicitly sent /wordle stop and confirmed disabled keyboards |

The first historical checkpoint captured a started callback row after state/publication but before queue completion. New recovery reported interrupted_effect and did not replay it. Final BEFORE runs waited for every started/pending row to disappear before saving the backup. A separate manual-runner defect failed to carry the Telegram update offset across phases, allowing the last key to be delivered twice; the user observed two letters. The runner now persists that offset in the private manifest and restores it for AFTER, matching the production poller's durable offset behavior. Fresh user clicks on both messages after migration were subsequently confirmed in the held-open control; do not count the replayed transition callback as a fresh user action.

The archived render(state) ignores the additional view argument and needs no ctx.message adapter. All views display the original complete game; the archive was not redesigned to select result-only props. Group custom-emoji edit behavior has a known archive-specific reply-anchor requirement; this private-chat migration does not establish inline/group custom-emoji acceptance.

The initial real-model inline test stopped under the existing 256 MiB runtime-tree threshold. Offline reproduction measured 295,038,976 bytes with a retained esbuild child. The accepted fix separates compilation into a temporary sandbox and removes compiler imports/build RPC from the persistent runtime. The unchanged offline game stayed active for 20 seconds at 192,626,688 bytes. In the later actual native-model/Telegram run, the user confirmed that Start and letters work on the same inline Wordle after restart; measured runtime samples were 193,855,488 and 195,211,264 bytes. No game-source or sandbox-limit change was needed.

Opt-in runner: [wordle-migration-acceptance.mjs](../../test/manual/wordle-migration-acceptance.mjs), with [native management helper](../../test/manual/wordle-native-management.mjs). Use --native-config PRIVATE_JSON for actual model management and --keep-active for a visual session that ends only on /wordle stop or the bounded deadline. Credentials, native state/answers and before/after manifests remain in the ignored private fixture. No production configuration or bot service was upgraded.
