# nzb

Collection of tools handling NZB files

## Usage

Each commands can be run under Deno with `deno run -A mod.ts command args`, or
using the pre-built binaries for each platforms in Releases.

## Commands

- [x] `check`: Checks if a NZB file is fetchable.
- [x] `combine`: Combines multiple NZB files into one.
- [x] `extract`: Extracts files in a NZB file into new NZB files.
- [x] `get`: Fetches data specified in a NZB file.
- [x] `mirror`: Mirrors articles in a NZB file with new information.
- [x] `search`: Searches files into a NZB file.
- [x] `serve`: Serves a NZB file as an index webpage.

## `check`

Checks if all articles in the NZB still exist. By default, the check is done
using `STAT` method, which is faster but not as reliable as `HEAD` method. Use
`--method` flag to specify the method to use.

```shell
nzb check source.nzb --method=HEAD
```

## `combine`

Combines one or more NZBs into one. The resulting NZB is written to `stdout` or
a file specifiied in `--out` flag.

```shell
nzb combine source.S01D* > S01.nzb
nzb combine source.S01D* --out S01.nzb
```

## `extract`

Extracts only certain files in the input NZB based on a Glob or RegExp. The
resulting NZB is written to `stdout` or a file specifiied in `--out` flag.

```shell
nzb extract source.nzb "*.part*.rar" > parts.nzb
nzb extract source.nzb ".*\.part[\d]+\.rar" --out parts.nzb
```

## `get`

Fetches segments of specific file in the NZB, yEnc decodes and combines them
back to original file, and writes them to `stdout` or a file specifiied in
`--out` flag.

```shell
nzb get source.nzb test_file.bin > test.bin
nzb get source.nzb test_file.bin --out test.bin
```

`get` also supports range request with `--start` and/or `--end` flags.

## `mirror`

Mirrors the articles in the input NZB, either to the same group or new ones, and
outputs the resulting NZB to stdout or a specified output file.

```shell
nzb mirror \
  --hostname="localhost" \
  --port=119 \
  --username="" \
  --password="" \
  --connections=3 \ # Number of connections
  --connect-retries=1 \ # Number of times to retry to connect.
  --reconnect-delay=15*1000 \ # Microseconds to wait before reconnecting.
  --request-retries=5 \ # Number of times to retry to post if failed.
  --post-retry-delay=0 \ # Microseconds to wait before retrying posting.
  --comment="" \ # Comment to insert before post subject
  --comment2="" \ # Comment to append after post subject
  --subject="" \ # Custom subject to use for posts. See below for available placeholders.
  --from="poster@example.com" \ # Name of poster
  --groups="alt.binaries.test" \ # Groups to post new articles to, separated by commas.
  --date \ # Specific date for each article. Can take a "now" to refer script's start time.
  --message-id="" \ # Format of generated Message-ID. See below for available placeholders.
  source.nzb \ # Source file to mirror from.
  --out=mirror.nzb # Path to a file to write new NZB to.
```

If `--out` is supplied, will write NZB to this file. Can be '-' which writes the
NZB to `stdout`. The following placeholders are also supported (see below for
details):

```
{files}
{filename}
{fnamebase}
{filesize}
{fileksize} also {filemsize} etc
{fileasize}
```

### Placeholders

The following placeholders can be used in `--subject` and `--message-id` flags.

```
{filenum}   Current file number in collection
{0filenum}  Current file number in collection,
            pre-padded with 0's
{files}     Number of files in collection
{filename}  File's name
{fnamebase} File's name without extension;
            uses same logic as `--group-files`
{filesize}  File's size in bytes
{fileksize} File's size in KiB, rounded to 2dp
            Replace the 'k' with 'm', 'g', 't'
            for sizes in MiB, GiB and TiB
            respectively, e.g. {filemsize}
{fileasize} Friendly formatted file size, e.g.
            '4.85 MiB' or '35.1 GiB'
{part}      Article part number
{0part}     Article part number, pre-padded
            with 0's to be as long as {parts}
{parts}     Number of articles for the file
{size}      Article chunk size (before yEnc)
{comment}   Value from `--comment`
{comment2}  Value from `--comment2`
{timestamp} Unix timestamp of post
${rand(N)}  Random text, N characters long
```

## `search`

Searches for files matching certain query in the Subject and store results in a
NZB file and outputs the resulting NZB to stdout or a specified output file.

```shell
nzb search --group alt.binaries.test --range 1- Big.Buck.Bunny > bunny.nzb
```

## `serve`

Serves the files specified in an input NZB file as a directory listing.

```shell
nzb serve \
  --addr=0.0.0.0:8000 \
  source.nzb # Source NZB file to serve.
```

A [basic listing template](./index.html) is used when serving. If a custom
template is required, specify its full path with `--template` flag.

```shell
nzb serve \
  --addr=0.0.0.0:8000 \
  --template=~/custom.html
  source.nzb # Source NZB file to serve.
```

This can be useful to display files in the NZB creatively.

Each files in the NZB has a route to fetch it via the browser. Regular files are
downloaded, whereas media files are streamed if browser supports.

`source.nzb` can be a local or remote URL, and can be gzipped.
