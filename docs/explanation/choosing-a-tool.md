# File Mover Express, the AWS CLI, and s5cmd

This action installs File Mover Express, which copies files between the runner and Amazon S3. The AWS CLI and [s5cmd](https://github.com/peak/s5cmd) also move files to and from S3, and each fits a different job. Pick by what the step has to do, and use more than one tool in a job when that's the better fit.

## What each tool is for

File Mover Express is built for media workflows: large files, integrity checks, and transfers that need to survive interruptions. It moves files between a local machine and S3. Its upstream [README](https://github.com/awslabs/filemoverexpress) lists multipart uploads, pause and resume, optional XXH3, XXHash, and MD5 checksums, and hot folders for watched directories.

The AWS CLI is the general S3 tool. It copies, syncs, deletes, and moves objects between buckets, and it covers the wider S3 API through `aws s3api`. GitHub-hosted runner images include it.

s5cmd is a standalone tool built for fast parallel S3 operations, with wildcard support and a batch mode. It's not preinstalled, so install it from its releases page before the step that uses it.

## Which one to use

| Need                                                  | File Mover Express                               | AWS CLI                  | s5cmd                 |
| ----------------------------------------------------- | ------------------------------------------------ | ------------------------ | --------------------- |
| Upload or download a directory or prefix              | Yes                                              | Yes                      | Yes                   |
| Mirror a directory and delete what's gone             | No                                               | `aws s3 sync --delete`   | `s5cmd sync --delete` |
| Skip files that haven't changed                       | No, but `--max-age` skips old files              | `aws s3 sync`            | `s5cmd sync`          |
| Store XXH3, XXHash, or MD5 checksums with the objects | Yes                                              | No                       | No                    |
| Filter by regular expression or file age              | `--filter`, `--max-age`                          | Glob include and exclude | Wildcards             |
| Copy between buckets, presign URLs, manage objects    | No                                               | Yes                      | Copy and remove       |
| Tune parallelism and chunking per transfer           | `--max-active-transfers`, `--threads`, `--chunk-size`, `--auto-tuning` | `max_concurrent_requests` and related config | `--numworkers`, `--concurrency` |
| Fail the step when a transfer fails                   | Needs a [log check](../how-to/fail-on-errors.md) | Non-zero exit code       | Non-zero exit code    |

The table states what each tool documents. It doesn't rank speed, because that depends on the file sizes, the runner, and the bucket's region.

## Choose by the job

Use File Mover Express when:

- The files are large or numerous and you want the same CLI you use elsewhere, with the same [transfer profiles](../how-to/transfer-profiles.md).
- You want a checksum stored with each object, for later verification.
- You need a regular-expression or file-age filter on what gets uploaded.

Use the AWS CLI or s5cmd when:

- A deploy has to leave the bucket matching a directory, which needs `--delete`.
- You only want to transfer what changed since the last run.
- You copy between buckets or manage objects rather than moving local files.
- You want the step to fail on a transfer error without scanning a log.

## Use them together

All three tools read the credentials that aws-actions/configure-aws-credentials exports, so one authentication step serves the whole job. A common split is File Mover Express for the bulk upload and the AWS CLI for anything it doesn't do:

```yaml
- uses: lowlysre/setup-filemoverexpress@v1
  with:
    bucket: my-build-bucket

- name: Upload renders
  shell: bash
  run: |
    filemoverexpress upload default ./renders --prefix "builds/${GITHUB_RUN_ID}" 2>&1 | tee fme.log
    if grep -qE $'^(\033\\[[0-9;]*m)*(ERROR|FATAL)' fme.log; then exit 1; fi

- name: Confirm the objects landed
  run: aws s3 ls "s3://my-build-bucket/builds/${GITHUB_RUN_ID}/" --recursive
```

The last step is only an example of calling the AWS CLI alongside File Mover Express. The [first upload tutorial](../tutorials/first-upload.md) uses the same check.

See [Sync or delete](../how-to/transfers.md#sync-or-delete) for ready-to-copy mirror commands.
