# Exit codes

Most CI tools fail a step through the exit code. File Mover Express exits 0 after failed transfers, so a workflow that relies on the exit code alone reports success for an upload that sent nothing. This page explains where that comes from and how the action and the docs work around it.

## What the CLI does

These behaviors are from File Mover Express 1.1.1 tested against moto. The [exit code table](../reference/cli.md#exit-codes) lists each situation. The short version: only problems that stop the CLI before any transfer starts produce a non-zero exit. Failed transfers, a missing upload path, and a failed `validate-credentials` all exit 0.

Upstream documents exit codes 1, 2, and 3 for general, configuration, and network errors, but the CLI doesn't use them for per-file failures.

## Why

File Mover Express is built around a transfer service shared with its GUI and daemon. In the CLI source, `upload` hands files to a transfer job, and per-file failures come back as log events. The command returns once the job reaches a final status, and nothing maps failed files to an exit code. That model suits a desktop app, where a person reads the transfer list; it doesn't suit CI, where nobody does.

## How the action handles it

For the one CLI call the action makes on your behalf, `validate-credentials`, it ignores the exit code and looks for the success line instead: `Validated credentials for <transfer-profile>`. If that line is missing, the step fails and shows the `WARNING`, `ERROR`, and `FATAL` lines from the CLI's output.

For your own `upload` and `download` steps, the action can't wrap the command, so it gives you two tools:

- A problem matcher that turns `ERROR`, `FATAL`, and `WARNING` lines into annotations, so failures are visible on the run summary even when the step is green
- The `tee` and `grep` recipe in [Fail the job on transfer errors](../how-to/fail-on-errors.md), which turns any `ERROR` or `FATAL` line into a failed step

## Why not wrap the CLI

A wrapper script or a `filemoverexpress` shim that scans output would make the exit code right without the recipe. It would also hide the real binary, break when upstream changes its log format, and behave differently from the CLI documented upstream. Keeping the binary untouched and the check in your workflow makes the check visible and easy to change, and it keeps working unchanged if upstream fixes its exit codes.
