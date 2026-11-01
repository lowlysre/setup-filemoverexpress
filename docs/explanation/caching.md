# Caching

The action caches the verified CLI in the runner tool cache, the same mechanism actions/setup-python and actions/setup-node use. It doesn't use the Actions cache service (`actions/cache`).

## Layout

```text
$RUNNER_TOOL_CACHE/
  filemoverexpress/
    1.1.1/
      x64/
        filemoverexpress        # filemoverexpress.exe on Windows
      x64.complete
```

Entries are keyed by version and architecture. A binary lands in the cache only after its digest, signature, and extraction all succeed.

## When the cache is used

| Request                | `check-latest: false` (default)              | `check-latest: true`                                       |
| ---------------------- | -------------------------------------------- | ---------------------------------------------------------- |
| Exact, such as `1.1.1` | Cached copy if present, no API call          | API call, then cached copy if the version matches          |
| Range, such as `1.x`   | Highest cached version in range, no API call | API call for the newest match, then cached copy if present |
| `latest`               | API call, then cached copy if present        | Same                                                       |

`cache-hit` is `true` whenever the binary came from the cache, whether or not the API was called.

## On GitHub-hosted runners

Each job gets a fresh virtual machine, and File Mover Express isn't preinstalled, so the first call in a job always downloads. The cache still pays off within a job: calling the action a second time to [add another bucket](../how-to/transfer-profiles.md#use-multiple-buckets) is a cache hit with no download and no verification work. In a test run, that second call took about 0.3 seconds, against about 7 seconds for a cold install on Windows.

The action doesn't add an `actions/cache` layer across jobs. A cache restore would be a second way to get a binary onto the runner, one that skips the digest and signature checks.

## On self-hosted runners

The tool cache persists between jobs, so each version downloads and verifies once per machine. With an exact version or range and `check-latest: false`, later jobs make no GitHub API call at all, which also keeps them clear of API rate limits.

To pick up a new release in a range, set `check-latest: true` or clear `$RUNNER_TOOL_CACHE/filemoverexpress`.

## What a cache hit skips

A cache hit skips the API call, the download, the digest check, and the signature check. It doesn't skip the smoke test: `filemoverexpress --version` still runs and has to report the expected version.

That makes the cache part of the trust boundary. See the [security model](./security.md#known-gaps) for what that means on shared self-hosted runners.
