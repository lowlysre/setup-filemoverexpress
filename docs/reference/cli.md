# CLI behavior in CI

The upstream [Using the CLI](https://awslabs.github.io/filemoverexpress/) guide documents every command and flag, plus the daemon and GUI features. This page covers only what matters when the CLI runs in a workflow step. Throughput flags such as `--max-active-transfers` and `--threads` are in [Upload and download faster](../how-to/transfers.md).

## Commands used in workflows

```bash
filemoverexpress upload <transfer-profile> <paths...>
filemoverexpress download <transfer-profile> <local-dest> <s3-prefix>
filemoverexpress validate-credentials <transfer-profile>
filemoverexpress inventory <transfer-profile> --output-format csv
```

`<transfer-profile>` is the profile the action writes when `bucket` is set. It's `default` unless `transfer-profile` says otherwise.

## Upload paths

```bash
filemoverexpress upload default payload --prefix ci/run1
```

| Path form                         | Resulting keys                                                                   |
| --------------------------------- | -------------------------------------------------------------------------------- |
| Relative, such as `payload`       | Directory structure kept: `ci/run1/payload/a.txt`, `ci/run1/payload/sub/big.txt` |
| Absolute, such as `/data/payload` | Stripped to the longest common directory of the arguments                        |
| Mixed relative and absolute       | Fatal error                                                                      |
| Containing `..`                   | Fatal error                                                                      |
| Doesn't exist                     | `WARNING No files found for upload`, exit code 0                                 |

Run uploads from the directory that should be the root of the key structure, and pass relative paths.

## Download layout

[Download a prefix](../how-to/transfers.md#download-a-prefix) shows how downloaded keys map to local paths.

## Log format

Each line starts with a fixed-width level and a timestamp:

```text
INFO   [2026-11-01 08:39:58] Validated credentials for e2e
WARNING[2026-11-01 08:40:03] No files found for upload
ERROR  [2026-11-01 08:40:11] Failed to transfer file ...
FATAL  [2026-11-01 08:40:15] ...
```

## Exit codes

| Situation                                                          | Logged as                            | Exit code |
| ------------------------------------------------------------------ | ------------------------------------ | --------- |
| Every file transferred                                             | `INFO`                               | `0`       |
| Some or all files failed, such as `NoSuchBucket` or `AccessDenied` | `ERROR ... Failed to transfer file`  | `0`       |
| Upload path doesn't exist                                          | `WARNING No files found for upload`  | `0`       |
| `validate-credentials` can't list the bucket                       | `WARNING ... Unable to list objects` | `0`       |
| Unknown transfer profile                                           | `FATAL`                              | `1`       |
| Mixed absolute and relative paths, or `..` in a path               | `FATAL`                              | non-zero  |

Because failed transfers exit 0, scan the output as shown in [Fail the job on transfer errors](../how-to/fail-on-errors.md). [Exit codes](../explanation/exit-codes.md) covers the reasoning.

## Files under FME_CONFIG_DIR

| File                 | Contents                                                                                       |
| -------------------- | ---------------------------------------------------------------------------------------------- |
| `configuration.yaml` | Transfer profiles and every other setting. The CLI fills in defaults and rewrites it on start. |
| `checksum-cache.db`  | Cached file hashes, when checksums are on                                                      |
| `logs/daemon.log`    | Log of the local transfer service                                                              |

With `FME_CONFIG_DIR` set, the CLI writes nothing under the home directory.
