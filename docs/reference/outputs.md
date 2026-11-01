# Outputs

| Output                     | Example                                                            | Description                                                                   |
| -------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| `filemoverexpress-version` | `1.1.1`                                                            | Resolved version, without a `v` prefix.                                       |
| `filemoverexpress-path`    | `/opt/hostedtoolcache/filemoverexpress/1.1.1/x64/filemoverexpress` | Absolute path to the CLI binary.                                              |
| `cache-hit`                | `false`                                                            | `true` when the CLI came from the runner tool cache instead of a download.    |
| `config-dir`               | `/home/runner/work/_temp/filemoverexpress`                         | Directory exported as `FME_CONFIG_DIR`.                                       |
| `config-file`              | `/home/runner/work/_temp/filemoverexpress/configuration.yaml`      | `<config-dir>/configuration.yaml`.                                            |
| `transfer-profile`         | `default`                                                          | Name of the transfer profile the action wrote. Empty when `bucket` isn't set. |

## Using outputs

Give the step an `id` and read outputs from `steps.<id>.outputs`:

```yaml
- id: fme
  uses: lowlysre/setup-filemoverexpress@v1
  with:
    filemoverexpress-version: '1.x'
    bucket: my-media-bucket
    region: us-east-1

- name: Show the generated config
  shell: bash
  env:
    FME_VERSION: ${{ steps.fme.outputs.filemoverexpress-version }}
    FME_CACHE_HIT: ${{ steps.fme.outputs.cache-hit }}
    FME_CONFIG_FILE: ${{ steps.fme.outputs.config-file }}
  run: |
    echo "Version: ${FME_VERSION}"
    echo "Cache hit: ${FME_CACHE_HIT}"
    cat "${FME_CONFIG_FILE}"

- name: Upload with the profile the action wrote
  shell: bash
  env:
    FME_PROFILE: ${{ steps.fme.outputs.transfer-profile }}
  run: filemoverexpress upload "${FME_PROFILE}" ./renders
```

Passing outputs through `env` instead of writing expressions directly inside `run` keeps values out of the script text, which is the pattern linters such as zizmor expect.
