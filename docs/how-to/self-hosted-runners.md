# Use self-hosted runners

The action works on self-hosted runners with the same inputs. A few things differ from GitHub-hosted images.

## Prerequisites by OS

| OS      | Needs                                                                                                                  |
| ------- | ---------------------------------------------------------------------------------------------------------------------- |
| Linux   | Nothing extra. The CLI is a static binary.                                                                             |
| macOS   | `hdiutil` and `codesign`, both part of macOS                                                                           |
| Windows | 7-Zip, either on `PATH` or at `C:\Program Files\7-Zip\7z.exe`, plus Windows PowerShell for `Get-AuthenticodeSignature` |

GitHub-hosted Windows images include 7-Zip. On a self-hosted Windows runner without it, the action fails with a message saying so.

## Network access

The runner needs HTTPS access to:

- api.github.com, to resolve versions. Skipped on a tool cache hit, see below
- github.com and the GitHub release asset download host, to download the release
- Your S3 endpoint, for transfers

Downloads go through `@actions/tool-cache`, which honors the `https_proxy` and `no_proxy` variables that the runner sets when you configure it behind a proxy.

## Reuse the tool cache

Self-hosted runners keep `RUNNER_TOOL_CACHE` between jobs, so each version downloads and verifies once per machine. With an exact version or a range and `check-latest: false` (the default), later jobs make no GitHub API call. [Caching](../explanation/caching.md) covers the details.

> [!WARNING]
> The action doesn't re-verify the digest or signature on a cache hit. Anyone who can write to the tool cache on a shared runner can replace the binary, so restrict write access to the runner's service account or use ephemeral runners. See the [security model](../explanation/security.md#known-gaps).

## GitHub Enterprise Server

File Mover Express releases live on github.com. On GitHub Enterprise Server the `token` input defaults to empty, because the instance's `github.token` isn't valid on github.com. Unauthenticated API calls are limited to 60 per hour per IP address, which a busy runner fleet hits quickly. Two fixes:

- Pin an exact version and rely on the tool cache, so most runs make no API call
- Pass a github.com token with no scopes:

```yaml
- uses: lowlysre/setup-filemoverexpress@v1
  with:
    token: ${{ secrets.GITHUB_DOTCOM_TOKEN }}
```

## Don't run as root

File Mover Express warns when it runs as root or Administrator. Run the runner service as an unprivileged user; the action doesn't need elevation on any OS, because it never runs an installer. Small machines get a similar warning for memory; see [Tune throughput](./transfers.md#limits).
