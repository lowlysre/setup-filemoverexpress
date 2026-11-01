# Upload and download faster

`filemoverexpress upload` and `download` take the transfer profile as their first argument. This page covers where downloaded files land, how to hand files between jobs, and the flags that control throughput. Each example assumes configure-aws-credentials and the action ran earlier in the job, as in [Authenticate with configure-aws-credentials](./aws-credentials.md). Wrap real transfer steps in the check from [Fail the job on transfer errors](./fail-on-errors.md).

## Download a prefix

```yaml
- name: Download
  shell: bash
  run: |
    filemoverexpress download default ./incoming "builds/${GITHUB_RUN_ID}/" 2>&1 | tee fme.log
    if grep -qE '^(ERROR|FATAL)' fme.log; then exit 1; fi
```

The arguments are the transfer profile, a local destination, and the S3 prefix, in that order. Use a relative destination; upstream documents only relative destinations for downloads. Downloads need `s3:ListBucket` and `s3:GetObject`, which the [tutorial's policy](../tutorials/first-upload.md) covers.

The CLI recreates the full key under the destination. It doesn't strip the prefix:

| Object key                                    | Local path                                             |
| --------------------------------------------- | ------------------------------------------------------ |
| `builds/1234567890/renders/built-at.txt`      | `incoming/builds/1234567890/renders/built-at.txt`      |
| `builds/1234567890/renders/frames/commit.txt` | `incoming/builds/1234567890/renders/frames/commit.txt` |

Point later steps at the full path, or move the directory:

```yaml
- shell: bash
  run: mv "incoming/builds/${GITHUB_RUN_ID}/renders" ./renders
```

Objects stored as `glacier` or `deep_archive` need an S3 restore first; see [Set the storage class](./transfer-profiles.md#set-the-storage-class).

## Hand files between jobs

Upload with a run-scoped prefix in one job and download the same prefix in the next. `GITHUB_RUN_ID` stays the same across jobs and reruns of one workflow run, so both jobs agree on it:

```yaml
jobs:
  render:
    runs-on: ubuntu-latest
    permissions:
      id-token: write
      contents: read
    steps:
      - uses: actions/checkout@v7
      - uses: aws-actions/configure-aws-credentials@v6
        with:
          role-to-assume: arn:aws:iam::123456789012:role/gha-media-upload
          aws-region: us-east-1
      - uses: lowlysre/setup-filemoverexpress@v1
        with:
          bucket: my-media-bucket
      - run: ./render.sh # writes ./renders
      - shell: bash
        run: |
          filemoverexpress upload default renders --prefix "runs/${GITHUB_RUN_ID}" 2>&1 | tee fme.log
          if grep -qE '^(ERROR|FATAL)' fme.log; then exit 1; fi

  publish:
    needs: render
    runs-on: ubuntu-latest
    permissions:
      id-token: write
      contents: read
    steps:
      - uses: aws-actions/configure-aws-credentials@v6
        with:
          role-to-assume: arn:aws:iam::123456789012:role/gha-media-upload
          aws-region: us-east-1
      - uses: lowlysre/setup-filemoverexpress@v1
        with:
          bucket: my-media-bucket
      - shell: bash
        run: |
          filemoverexpress download default ./in "runs/${GITHUB_RUN_ID}/" 2>&1 | tee fme.log
          if grep -qE '^(ERROR|FATAL)' fme.log; then exit 1; fi
          ls -R "in/runs/${GITHUB_RUN_ID}/renders"
```

Add an S3 lifecycle rule on `runs/` to expire these objects after a few days.

## Tune throughput

File Mover Express splits each file into chunks and moves several files at once. The defaults suit a general-purpose machine; tune them when transfers are slower than the runner's network allows.

| Flag                       | Default | Controls                                              |
| -------------------------- | ------- | ----------------------------------------------------- |
| `--max-active-transfers n` | `100`   | Files in flight at once                               |
| `--threads n`              | `10`    | Parallel chunk requests per file                      |
| `--chunk-size MB`          | `25`    | Multipart chunk size                                  |
| `--max-active-checksums n` | `1`     | Files checksummed at once before upload (upload only) |
| `--auto-tuning`            | off     | Lets the CLI pick values for the machine it's on      |

`--auto-max-active-transfers` is a narrower option: it scales only the active transfer count from CPU cores and the open-file limit, and overrides `--max-active-transfers`.

Start with `--auto-tuning` and compare its wall-clock time against the defaults before tuning by hand:

```yaml
- run: filemoverexpress upload default ./renders --auto-tuning
```

### A few large files

Video masters, disk images, and model weights gain the most from more parallelism per file and bigger chunks:

```yaml
- run: >-
    filemoverexpress upload default ./masters
    --max-active-transfers 4
    --threads 32
    --chunk-size 64
```

S3 caps a multipart upload at 10,000 parts, so the chunk size also sets the largest file you can upload. At the default 25 MB that's about 250 GB; at 64 MB it's about 640 GB.

### Many small files

Thousands of small files are bound by request count, not bandwidth. Keep threads low and raise the file count:

```yaml
- run: >-
    filemoverexpress upload default ./thumbnails
    --max-active-transfers 200
    --threads 2
```

### With checksums turned on

When the transfer profile has a checksum algorithm set, uploads hash each file first, one file at a time by default. Raise `--max-active-checksums` up to the runner's core count so hashing doesn't become the bottleneck:

```yaml
- run: filemoverexpress upload default ./renders --max-active-checksums 4
```

### Limits

- `--max-active-transfers` times `--threads` is roughly the number of files the CLI opens. If it exceeds the runner's open-file limit, the CLI refuses to start and names both numbers. Lower one of the flags, or raise the limit with `ulimit -n` in the same `run` step
- The CLI warns when the machine has less than 6 GiB of RAM. Standard GitHub-hosted runners have more; small self-hosted runners may not
- Runner network bandwidth is the ceiling no matter what the flags say
- [Transfer Acceleration](./transfer-profiles.md#use-transfer-acceleration) helps when the runner is far from the bucket's region

## Sync or delete

File Mover Express copies files; it doesn't mirror a directory. The CLI has no option to delete objects or local files that no longer exist on the other side, and its documentation describes no comparison of size or modified time to skip unchanged files.

For a one-way sync that deletes, use the AWS CLI or [s5cmd](https://github.com/peak/s5cmd) in the same job. Both read the credentials that configure-aws-credentials exports.

```yaml
- run: aws s3 sync ./site "s3://my-build-bucket/site" --delete
```

```yaml
- run: s5cmd sync --delete ./site/ "s3://my-build-bucket/site/"
```

To upload only recent files with File Mover Express, combine `upload` with `--max-age`, for example `--max-age 1d`. This skips old files but never removes anything from the bucket. Run `filemoverexpress upload --help` to see the flags your installed version supports.
