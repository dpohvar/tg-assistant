# MCP OAuth manual-callback probe

Status: implementation verified with automated tests and a synthetic provider; external Google-account acceptance remains manual.

The original exploratory probe below predates implementation.

The probe ran in the existing Alpine Docker environment with Codex CLI 0.159.3. It used a separate temporary CODEX_HOME and a local synthetic OAuth/Streamable HTTP MCP server. No real accounts or production credentials were used. The running Telegram service was not restarted or modified.

The authorization server supported discovery, dynamic client registration, authorization codes and S256 PKCE. It checked the code verifier and redirect URI before issuing a synthetic token. The harness simulated browser approval, captured the redirect Location without requesting the callback endpoint, and supplied the full callback URL through stdin to `codex mcp login NAME --no-browser --oauth-client-registration dcr`.

## Results

All assertions passed in the final run; the process exited with code 0.

| Check | Evidence |
|---|---|
| Manual callback submission | Login succeeded without an HTTP request to the callback listener. |
| Initial isolation | After logging in server A, A exposed its account-specific tool; server B remained notLoggedIn. |
| Two accounts for the same service | Server entries A and B used the identical MCP URL and shared CODEX_HOME, but exposed different account-specific tools after separate logins. |
| Process restart | A fresh App Server loaded both authorizations from disk and exposed the expected tools. No additional code-to-token exchange occurred. |
| Independent logout | `codex mcp logout` for A left A notLoggedIn and B still authenticated as its original account. |

Credentials were written using `mcp_oauth_credentials_store = "file"`. Temporary credential storage was removed after the probe.

## Implications and limits

For the tested runtime, the controller can start a no-browser login, send its authorization link to an administrator, and write the administrator's reply URL to the waiting process stdin. A public callback endpoint, SSH tunnel, or HTTP callback forwarding is unnecessary for this path.

Distinct native MCP server names provided credential separation in this scenario. This tests two server entries representing bots, not two fully configured Telegram bots. Production integration must use the existing bot-specific server namespace and prevent inherited MCP configuration from affecting login.

This does not establish compatibility with every OAuth provider, other Codex versions, refresh-token rotation, denied consent, malformed callbacks, timeouts, concurrent logins, or the proposed Telegram reply command. Those remain integration checks. The synthetic provider allowed a loopback redirect URI; real providers may impose additional registration rules.

## Implemented controller verification

`test/live/mcp-oauth.mjs` exercises the actual manager, CLI adapter, command reply routing and native test runtime on Alpine/Codex 0.159.3. The final run passed manual callback, denied consent, issuer mismatch, shared-URL bot namespace separation, fresh-process credential loading, two refreshes, independent logout and callback exclusion/deletion. No model turns, application tool calls or callback HTTP requests occurred. The provider required a registered client ID and client secret for both initial token exchange and refresh.

Native 0.159.3 silently ignored `client_secret_env_var`; the supported `oauth.client_secret` setting was verified against a provider enforcing client authentication. Callback URLs may receive a native suffix and loopback port selection; the exact redirect URI is shown in the auth reply for registration. Denied consent cancels immediately because the native CLI otherwise asks for another callback.

The final Windows suite passed 249 tests with 8 existing skips and no failures. Alpine focused tests passed 30 tests. Focused MCP/Codex checks passed 45 tests. An external Pipedream probe created an authorization link successfully, but no real account was authorized. Direct Google Calendar MCP requires Google Workspace Developer Preview membership and Google Cloud/OAuth setup. These checks do not claim completed Google integration.

Manual Google acceptance completed login and exposed nine tools. An unauthenticated Google tools listing had previously returned `notLoggedIn` despite successful initialization, so list/test output now shows authorization state. A subsequent application call reported that the Google Cloud project needs Developer Preview enrollment; reading calendar data remains unverified. This provider policy cannot be inferred solely from tools/list.

All controller command replies were translated to English, including master-bot replies. MCP list rows use a code entity for the connection name and an italic entity for the status. The final relevant Alpine command checks passed 23 tests, and the running test service was restarted with these changes.
