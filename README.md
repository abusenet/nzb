# nzb

Collection of tools handling NZB files

## Usage

Each commands can be run under Deno with `deno run -A mod.ts command args`, or
using the pre-built binaries for each platforms in Releases.

## Commands

- [x] `nzb mirror`: Mirrors articles in a NZB file with new information
- [ ] `nzb get`: Downloads data specified in a NZB file.
- [x] `nzb extract`: Extracts files in a NZB file into new NZB files.
- [ ] `nzb merge`: Merges multiple NZB files into one.
- [x] `nzb serve`: Serves a NZB file as an index webpage.
- [ ] `nzb stream`: Streams data specified in a NZB file.

## `nzb-mirror`

Mirrors the articles in the input NZB, either to the same group or new ones, and
outputs the resulting NZB to stdout or a specified output file.

```shell
nzb mirror \
  --hostname=localhost \
  --port=119 \
  --username= \
  --password= \
  --connections=3 \ # Number of connections
  --connect-retries=1 \ # Number of times to retry to connect.
  --reconnect-delay=15*1000 \ # Microseconds to wait before reconnecting.
  --request-retries=5 \ # Number of times to retry to post if failed.
  --post-retry-delay=0 \ # Microseconds to wait before retrying posting.
  --from="poster@example.com" \ # Name of poster
  --groups=alt.binaries.test \ # Groups to post new articles to, separated by commas.
  --date \ # Specific date for each article. Can take a "now" to refer script's start time.
  source.nzb \ # Source file to mirror from.
  --out=mirror.nzb # Path to a file to write new NZB to.
```

## `nzb-extract`

Extracts only certain files in the input NZB based on a Glob or RegExp. The
resulting NZB is written to `stdout` or a file specifiied in `--out` flag.

```shell
nzb extract source.nzb "*.part*.rar" > parts.nzb
nzb extract source.nzb ".*\.part[\d]+\.rar" --out parts.nzb
```

## `nzb-serve`

Serves the files specified in an input NZB file as a directory listing.

```shell
nzb serve \
  --hostname=0.0.0.0 \
  --port=8000 \
  source.nzb # Source NZB file to serve.
```

A [basic listing template](./index.html) is used when serving. If a custom
template is required, specify its full path with `--template` flag.

```shell
nzb serve \
  --hostname=0.0.0.0 \
  --port=8000 \
  --template=~/custom.html
  source.nzb # Source NZB file to serve.
```

This can be useful to display files in the NZB creatively.
