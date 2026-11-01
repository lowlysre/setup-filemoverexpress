# Fail the job on transfer errors

File Mover Express exits 0 when individual files fail to transfer, so a plain `run: filemoverexpress upload ...` step can go green after uploading nothing. This page shows how to turn those failures into a failed step. [Exit codes](../explanation/exit-codes.md) explains why the CLI behaves this way.

## Scan the log with tee and grep

Every log line starts with its level: `INFO`, `WARNING`, `ERROR`, or `FATAL`. Save the output and fail if an error line shows up:

```yaml
- name: Upload
  shell: bash
  run: |
    filemoverexpress upload default ./renders --prefix "builds/${GITHUB_RUN_ID}" 2>&1 | tee fme.log
    if grep -qE '^(ERROR|FATAL)' fme.log; then
      echo "::error::File Mover Express reported transfer errors"
      exit 1
    fi
```

The pieces that matter:

- `shell: bash` runs the script with `-eo pipefail`, so a non-zero exit from the CLI still fails the step through the pipe
- `2>&1` sends both streams into the log file
- `tee` keeps the output in the job log as it streams

This works on every runner image, including Windows, where `shell: bash` uses Git Bash.

## Also fail when nothing matched

An upload of a path that doesn't exist logs `WARNING` and exits 0. To treat that as a failure, add a second check:

```yaml
- name: Upload
  shell: bash
  run: |
    filemoverexpress upload default ./renders 2>&1 | tee fme.log
    if grep -qE '^(ERROR|FATAL)' fme.log; then
      echo "::error::File Mover Express reported transfer errors"
      exit 1
    fi
    if grep -q 'No files found for upload' fme.log; then
      echo "::error::Nothing to upload in ./renders"
      exit 1
    fi
```

## Verify the result independently

For uploads you can't afford to miss, check the bucket after the transfer. `inventory` lists the objects File Mover Express sees through the same transfer profile:

```yaml
- name: Confirm upload
  shell: bash
  run: |
    filemoverexpress inventory default --output-format csv > inventory.csv
    grep -q "builds/${GITHUB_RUN_ID}/renders/manifest.json" inventory.csv
```

## Annotations from the problem matcher

The action registers a problem matcher, so `ERROR` and `FATAL` lines show up as error annotations and `WARNING` lines as warning annotations on the run summary. Annotations make failures visible. They don't fail the step; use one of the checks above for that.

The matcher has two owners:

| Owner                      | Matches                                                       |
| -------------------------- | ------------------------------------------------------------- |
| `filemoverexpress-error`   | `ERROR  [timestamp] message` and `FATAL  [timestamp] message` |
| `filemoverexpress-warning` | `WARNING[timestamp] message`                                  |

To stop annotating, for example around a step where warnings are expected, remove the matcher:

```yaml
- run: echo "::remove-matcher owner=filemoverexpress-warning::"
```

Use `owner=filemoverexpress-error` to drop error annotations too.

## Check validate-credentials output

`filemoverexpress validate-credentials` also exits 0 when it can't list the bucket. Use the action's `validate-credentials: true` input instead of calling it yourself; the action checks for the `Validated credentials for <profile>` line and fails the step if it's missing.
