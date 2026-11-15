# Client ingestion benchmarks

Run the ingestion cases separately from the normal test suite:

```sh
vp test bench ingestion --run
```

To save individual samples and latency distributions:

```sh
vp test bench ingestion --run --reporter=json --outputFile=/tmp/ingestion.json
```

The fixture contains two paginated project collections with 20, 100, or 1,000
records each. Projects include varied serialized document state, scalar arrays,
shared or distinct authors, embedded statistics, field aliases, and username-based refetch
locators. The largest workload runs with both 20 shared authors and 2,000 distinct
authors, so improvements must hold when nested entities are unique as well as
repeated. IDs and collection order stay fixed when scalar and embedded values
change. Responses are precomputed; no real server, database, or network is involved.

The cases separate:

- GraphQL JSON decoding and response normalization, without cache ingestion.
- Cache ingestion of an unchanged snapshot, without transport decoding.
- Complete requests into fresh clients, including client construction.
- Unchanged and changed-data refreshes through native and GraphQL transports.
- Cached reads of the parent view and all project views.

Both transport variants decode JSON rather than returning a shared in-memory
object. The direct-write case intentionally reuses a decoded snapshot to isolate
normalization. Cached project views are warmed before measurement. Benchmarks use
stable, parameter-bound views and validate real selections, arguments, aliases,
and refetch configuration.

Run comparisons with the same Node version and idle machine, without concurrent
builds or tests. Compare distributions and repeated runs, not single timings.
The 1,000-record collections stress scaling beyond a typical page; they are not a
recommendation to fetch thousands of records at once. No result here measures
browser rendering, network latency, or backend query performance.

## Client schema performance and memory

Run the package benchmark suite separately from ordinary tests:

```sh
vp test bench client-state --run
```

It covers setup, cached reads, leaf and parent mutations, changed and unchanged
relationship replacement, create/delete cycles, and initializing, reading, and
collecting many computed entities, at 100, 1,000, and 5,000 records. The collection
case includes preparation and reads; it is not an isolated GC latency measurement.

For minified production browser bundles and allocation/retention measurements:

```sh
node scripts/benchmark-client-state.mjs chromium 1000 30 /tmp/client-state-chromium.json
node scripts/benchmark-client-state.mjs webkit 5000 30 /tmp/client-state-webkit.json
node scripts/benchmark-client-state.mjs node 1000 100 /tmp/client-state-memory.json
```

Arguments are engine, related record count, sample count (iterations for Node),
and an optional JSON report path. An installed Playwright browser is required
for browser runs. The runner builds in a temporary directory and removes it on
completion. Run comparisons sequentially on an idle machine without concurrent
builds or tests. Use the same dependencies, fixture, and Node version.

To substitute runtime source from an earlier commit without changing the checkout
or the current benchmark fixture:

```sh
FATE_BENCH_BASELINE=5a733e6 node scripts/benchmark-client-state.mjs chromium 5000 30 /tmp/client-state-before.json
FATE_BENCH_BASELINE=5a733e6 node scripts/benchmark-client-state.mjs node 1000 100 /tmp/client-state-memory-before.json
```

The fixture contains a parent with a scalar counter, related task records, and a
computed aggregate of task titles. Mutations use the public API, including input
validation where applicable. The changed replacement alternates every task's
`done` value. The unchanged replacement repeatedly supplies the same rows. One
case has 100 store listeners that increment a counter. Correctness checks verify
related records, computed values, invalidation, and notification counts.

Schema/view declarations and payloads are prepared before timing. Setup constructs
fresh clients with warm code, excluding download, module parsing, and initial JIT
compilation. Graph initialization uses `client.write`; relationship replacement
uses a transaction through the mutation API. Core read/write controls use the
same normalized graph without a client schema; direct writes omit mutation
validation, staging, and detached return snapshots.

Browser cases warm up for at least 100 ms and ten iterations. Fast cases use
batches targeting at least 5 ms to accommodate clock rounding. Reported p50/p95
values describe per-operation **batch averages**, not individual-call tail
latencies. Each sample starts after an animation frame. The browser runs exclude
persistence, network, framework rendering, and mobile hardware.

Node memory runs are separate from timing. They report V8 heap allocation sampled
at 16 KiB intervals, including objects collected during profiling, divided by the
operation count. Retained heap is measured before and after an unprofiled pass,
with three forced collections in separate event-loop turns at each boundary.
Allocation is an estimate, not peak RSS or retained memory. Small retained-heap
deltas can include JIT/GC noise and may be negative; they are not a leak test.
Forced-GC regression tests independently verify that collected computed results
and committed/rolled-back mutation payloads become unreachable, even when a
settled mutation context remains reachable.

An Apple M5 Max run on 2026-11-09 used Node 26.13.0, Chromium 158.0.8127.18,
and WebKit 27.2. The same final fixture compared the runtime at `5a733e6` with the
optimized working tree, using 30 browser samples. Medians below are milliseconds
per operation for **5,000 related records**:

| Operation                              | Chromium before | Chromium after | WebKit before | WebKit after |
| -------------------------------------- | --------------: | -------------: | ------------: | -----------: |
| Parent scalar mutation                 |            3.66 |           0.78 |          2.80 |         0.60 |
| Parent read-modify-write               |            5.78 |           1.42 |          4.00 |         1.00 |
| Replace unchanged relationship         |           18.30 |          10.00 |         30.00 |        13.00 |
| Replace changed relationship           |           20.80 |          12.30 |         30.00 |        14.00 |
| Leaf mutation + recompute aggregate    |            2.27 |           1.73 |          3.00 |         1.75 |
| Leaf mutation + read invalidated graph |            6.60 |           4.55 |          7.00 |         4.00 |

At 1,000 records, parent scalar mutation medians improved from 0.90 to 0.16 ms in
Chromium and 0.63 to 0.11 ms in WebKit. Cached scalar, computed, and graph reads
remained below 0.001 ms, comparable to the core client without a schema. Leaf
mutations remained below 0.007 ms. Small schema registration with seven mutations
and an empty root remained about 0.01 ms; registering 100 types with 20 fields each
remained about 0.7–0.9 ms. Initializing 5,000 records remained about 3.7/2.5 ms in
Chromium/WebKit. These controls did not show a material regression.

Sampled allocation with **1,000 related records**, 100 iterations per pass,
reported in decimal MB per operation:

| Operation                              | Before, MB/op | After, MB/op | Reduction |
| -------------------------------------- | ------------: | -----------: | --------: |
| Parent scalar mutation                 |          3.86 |         0.41 |       89% |
| Parent read-modify-write               |          5.90 |         0.80 |       86% |
| Replace unchanged relationship         |         16.95 |         7.17 |       58% |
| Replace changed relationship           |         18.36 |         8.62 |       53% |
| Leaf mutation + recompute aggregate    |          1.72 |         1.34 |       22% |
| Leaf mutation + read invalidated graph |          2.67 |         1.99 |       26% |

The populated client graph and cached views occupied approximately 1.82 MB of
additional V8 heap in both versions. The primary memory improvement is reduced
transient allocation and GC pressure, with essentially unchanged retained graph
size in this fixture.

The implementation keeps returned mutation snapshots detached and publishes
staged writes atomically. Existence checks read confirmed records without
materializing graphs or allocating coverage paths. Snapshot copying uses one
output object per record and a traversal-local cycle set. Normalization metadata
is shared only within a commit and partitioned by selection plan; pagination
windows remain isolated between staged writes. Immutable compiled coverage is
shared by rollback snapshots and copied before mutation. Read paths reuse
selection entries within a read and avoid temporary relationship arrays.
Computed results are indexed by entity, with a compact single-result entry and a
field map only when needed, so collecting one entity no longer scans the entire
computed cache. No persistent cache of materialized mutation snapshots is added.

Parent snapshots and whole-relationship replacement still scale with the graph.
Changing 5,000 related records took 12.3/14.0 ms median and 13.3/17.0 ms p95 in
Chromium/WebKit in this run. Those remain meaningful main-thread costs before
rendering. Targeted leaf mutations and small settings entities remain the best
fit for frequent interactive updates. Re-run with application payloads,
subscribers, persistence, and target devices before setting production budgets.

## Browser client persistence

Run the IndexedDB benchmark in an installed Playwright browser.

```sh
node scripts/benchmark-client-persistence.mjs chromium 100 15
node scripts/benchmark-client-persistence.mjs webkit 100 15
```

The arguments after the browser are the document count and sample count. The
fixture stores documents with serialized state and history, then measures a
settings update, an edit to one document's history, a fresh client restoring the
graph, and a bulk import into an empty graph. Bulk imports run up to five
samples. Bytes are measured at the storage adapter. Frame gaps are
requestAnimationFrame intervals and give a coarse view of main-thread delays.

An Apple M5 Max run with 100 documents used about 7.9 MB of encoded state.
The table shows median elapsed milliseconds before and after incremental writes,
using the same fixture and the original monolithic runtime at `91539bd` as
the baseline.

| Operation        | Chromium before | Chromium after | WebKit before | WebKit after |
| ---------------- | --------------: | -------------: | ------------: | -----------: |
| Settings update  |            23.6 |            0.6 |            10 |            1 |
| Save one history |            25.2 |            1.9 |            11 |            2 |
| Cold restore     |             7.0 |           10.0 |             5 |            7 |
| Bulk import      |            19.9 |           21.9 |             7 |            9 |

In this run a settings update read 112 bytes and wrote 300 bytes. A history
edit wrote about 75 kB. Both previously read and wrote the whole graph. A cold
restore still reads all saved entries. These are desktop headless measurements.

## Normalization optimization measurements

An idle-machine run on an Apple M5 Max with Node 24.22.1 compared the fixture at
`629c3b2` with `f8e8733`. Times below are per-operation medians, in milliseconds,
for 1,000 projects and 1,000 templates:

| Case                                                | Before | After |
| --------------------------------------------------- | -----: | ----: |
| GraphQL JSON decoding and selection normalization   |  21.68 | 10.70 |
| Unchanged cache write, excluding transport decoding |  40.34 | 22.76 |
| Native request into a fresh client                  |  44.89 | 27.06 |
| Native unchanged refresh                            |  46.65 | 29.43 |
| Native changed-data refresh                         |  47.14 | 30.24 |
| GraphQL request into a fresh client                 |  64.12 | 34.96 |
| GraphQL unchanged refresh                           |  66.23 | 37.49 |
| GraphQL changed-data refresh                        |  66.36 | 37.97 |
| Cached reads of all project views                   |   1.08 |  1.06 |

The optimizations index response aliases, normalize connections in one pass,
reuse selection and storage-path metadata within each response, and reduce
temporary coverage allocations. The metadata is scoped to one write rather than
retained globally. These numbers describe this fixture and machine; rerun the
benchmark for an application's actual selections and payloads.

## Response ingestion and retained metadata

A subsequent run on an Apple M5 Max with Node 26.12.1 compares the v1.11.1
runtime with `3456e10`. Both use the same current fixture and dependencies. The
baseline configuration substitutes the tagged runtime source before transformation;
it does not substitute older fixtures. Times are per-operation medians in
milliseconds. Each collection contains 1,000 records.

| Case                                                | 20 authors, v1.11.1 | 20 authors, optimized | 2,000 authors, v1.11.1 | 2,000 authors, optimized |
| --------------------------------------------------- | ------------------: | --------------------: | ---------------------: | -----------------------: |
| GraphQL JSON decoding and selection normalization   |               10.71 |                  7.12 |                  10.02 |                     7.15 |
| Unchanged cache write, excluding transport decoding |               19.70 |                  6.73 |                  17.14 |                     6.62 |
| Native request into a fresh client                  |               30.32 |                 14.09 |                  33.35 |                    14.37 |
| Native unchanged refresh                            |               25.96 |                 12.14 |                  25.49 |                    12.27 |
| Native changed-data refresh                         |               30.33 |                 13.71 |                  34.75 |                    14.16 |
| GraphQL request into a fresh client                 |               36.59 |                 16.09 |                  37.31 |                    16.49 |
| GraphQL unchanged refresh                           |               30.76 |                 14.30 |                  31.42 |                    14.49 |
| GraphQL changed-data refresh                        |               33.64 |                 16.62 |                  34.51 |                    19.00 |

Fresh-client cases include construction; refresh cases reuse the client. These
package benchmarks differ from application benchmarks that exclude construction.
They remain manual and do not add work to the normal test run. Cases where both
versions complete in less than 1 ms are omitted here.

The changes share compiled coverage until a record needs its own mask, compact
single-entry reference indexes, reuse response-local field metadata and list
ownership, and avoid write-history allocations without competing requests. They
retain response isolation, optimistic rebasing, stale-response protection, and
store change notifications. Record-specific coverage is copied before mutation;
normalization metadata is released after each write.

## GraphQL input readers

GraphQL request cases run with both default and custom identity functions. The
default case reads wire fields during cache normalization, avoiding intermediate
entity snapshots. Custom identity functions receive canonical snapshots because
they may inspect nested values. Both paths use the same cache writer, including
coverage, pagination, write ordering, optimistic rebasing, and notifications.

The GraphQL input reader also materializes results for direct transport calls,
mutations, value queries, and live events. Alias mapping, identity decoding, and
connection conversion stay shared between those results and cache ingestion.
Scalar objects and arrays are copied before entering the cache; wire records are
never mutated. Reader metadata belongs to the response rather than the retained
store.

Use the native and custom-identity cases as controls when changing the direct
path. These benchmarks remain separate from the normal test run.

## Mounted view updates

```sh
node scripts/benchmark-view-updates.mjs chromium 1000 15 /tmp/view-updates.json
FATE_BENCH_BASELINE=6705d4a node scripts/benchmark-view-updates.mjs chromium 1000 15 /tmp/view-updates-before.json
```

This production browser fixture mounts a React `useView` reader over an inline
list of records. Every sample changes every row's `done` field, measures the
synchronous write (including subscriber reads), and verifies the rendered count
after React commits. It excludes initial mount and payload construction, warms
up for at least ten updates and 100 ms of timed work, and reports
individual-operation p50/p95 and snapshot read counts. It does not measure
network latency or full application paint time.
The baseline option substitutes core and React runtime sources from a commit,
while keeping the current fixture and dependencies.

On 2026-11-13, Chromium 158.0.8127.18 with 1,000 records and 15 measured updates
compared `6705d4a` with all four optimizations. Bulk writes improved from 748.6 ms
median to 1.9 ms, with p95 improving from 778.1 to 2.7 ms. Synchronous
snapshot reads dropped from 2,000 to two per write. The store now publishes cache
invalidations immediately and coalesces subscriber callbacks at synchronous
response/update boundaries. It does not hold notifications across network awaits
or deferred response chunks, and failed partial writes still notify readers.

The mounted benchmark also updates a parent counter above memoized rows that
read masked child views. It measures through the parent layout-effect commit,
counts row renders, and checks the DOM. In the same final comparison, parent
updates improved from 3.5 to 2.1 ms median, with p95 improving from 5.5 to 2.8 ms.
Row renders dropped from 1,000 to zero per counter update through stable child
refs and selection result recycling. These rows deliberately do little
rendering work; applications with more expensive rows can benefit differently.
Recycling compares only selected containers, keeps scalar objects opaque, and
holds invalidated results weakly so unmounted readers do not keep stale graphs
alive. Inline graph reads still traverse their selections; this change targets
reference stability and downstream rendering rather than eliminating that walk.

## Selective client mutations

The client-state browser fixture includes `parent scalar without snapshot` and
`projected read + patch`. These call `store.patch` and the field-selection overload
of `store.get`. When benchmarking an older runtime, the fixture performs the same
write with `update` and discards its result; older `get` implementations ignore
the third argument and materialize the whole graph. The existing full-snapshot
cases remain as controls. This measures an opt-in API improvement, not a change
to the return semantics of existing calls.

```sh
FATE_BENCH_BASELINE=6b7a056 node scripts/benchmark-client-state.mjs chromium 10000 15 /tmp/mutations-before.json
node scripts/benchmark-client-state.mjs chromium 10000 15 /tmp/mutations-after.json
```

Chromium 158.0.8127.18 medians on 2026-11-13, milliseconds per operation:

| Operation                                                | Before |  After |
| -------------------------------------------------------- | -----: | -----: |
| Parent scalar write, ignoring its snapshot               |   1.22 | 0.0055 |
| Projected counter read followed by patch                 |   2.36 | 0.0057 |
| Unchanged relationship replacement, full return snapshot |   20.2 |   10.0 |
| Changed relationship replacement, full return snapshot   |   24.6 |   25.6 |

The unchanged replacement improves without API changes. Scalar leaves are checked
against current records at commit, not when the resolver stages them, so async
mutations still overwrite intervening changes correctly. Coverage, invalidation,
and competing response generations remain part of the fast-path checks.
Changed replacements still process every changed child and are not materially
faster. Full-snapshot parent reads/writes retain their graph-proportional cost.

## Drizzle nested pagination

```sh
node scripts/benchmark-drizzle.mjs 100 15 0 /tmp/drizzle-local.json
node scripts/benchmark-drizzle.mjs 100 15 2 /tmp/drizzle-latency.json
FATE_BENCH_BASELINE=18bf0e2 node scripts/benchmark-drizzle.mjs 100 15 2 /tmp/drizzle-before.json
```

Arguments are parent count, measured samples, simulated latency per query in
milliseconds, and an optional JSON report. This bundles the actual Drizzle
adapter and runs queries against in-memory SQLite through Drizzle's proxy driver.
The fixture has eight children per populated parent, one empty parent, nullable
ordering fields, and shared many-to-many children. It verifies each result against
the individual-parent query path, warms each scenario three times, and excludes
seeding and result verification from timing. Adapter/plan construction is timed.
A git baseline substitutes runtime sources while retaining the same fixture.

Node 26.13.1 medians on 2026-11-13, 100 parents and 15 samples:

| Scenario                  | Queries before → after | Local ms before → after | With 2 ms/query before → after |
| ------------------------- | ---------------------- | ----------------------- | ------------------------------ |
| First child pages         | 101 → 2                | 2.24 → 0.87             | 30.66 → 6.00                   |
| Cursor child pages        | 201 → 5                | 4.36 → 1.63             | 56.60 → 15.27                  |
| Two sibling relationships | 201 → 3                | 5.98 → 1.66             | 61.05 → 7.08                   |

The 2 ms delay models transport latency; it is not a measurement from a remote
production database. Cursor pages use smaller parent batches to bound SQL bind
parameters. Queries use the existing ordering and cursor comparisons inside a
partitioned `row_number()` window and fetch at most page size plus one row per
parent. This bounds returned rows, not the database's internal ranking work;
very large collections with excellent indexes can favor the individual-query
path. `nestedPaginationBatching: false` keeps that fallback available.

Tests execute forward/backward/cursor and many-to-many queries against SQLite,
compare complete pages and metadata to the fallback, check large-batch splitting
and recursive query limits, and exercise SQL generation and row decoding through
PostgreSQL and MySQL proxy drivers. Those driver tests do not run PostgreSQL or
MySQL database servers.

## Incremental updates and persistence, November 2026

Run the response/selection benchmark in Node and the storage benchmark in an
installed Playwright browser:

```sh
FATE_BENCH_BASELINE=550572c node scripts/benchmark-incremental.mjs 25 /tmp/incremental-before.json
node scripts/benchmark-incremental.mjs 25 /tmp/incremental-after.json
FATE_BENCH_BASELINE=550572c node scripts/benchmark-cache-performance.mjs chromium 9 /tmp/cache-before.json
node scripts/benchmark-cache-performance.mjs chromium 9 /tmp/cache-after.json
node scripts/benchmark-cache-performance.mjs webkit 5 /tmp/cache-webkit.json
```

The baseline substitutes runtime sources from the specified commit while retaining
the current fixture and dependencies. Run comparisons sequentially without builds
or tests running concurrently. Both runners verify resulting data and fail on
incorrect output. They run separately from the test suite.

On 2026-11-14, Node 26.13.1 and Chromium 158.0.8127.18 compared `550572c` with the
five subsequent optimizations. Times below are median elapsed milliseconds:

| Operation                                                                        | Before | After |
| -------------------------------------------------------------------------------- | -----: | ----: |
| Fetch 1,000 IDs with 50 pending optimistic edits, Node                           |  69.01 |  1.05 |
| Edit one row and read a 10,000-row inline graph, Node                            |  12.37 |  7.41 |
| Edit a parent counter and read an unchanged 10,000-row computed dependency, Node |   4.75 |  2.90 |
| Restore a cached 1,000-row nested graph, Chromium/IndexedDB                      | 114.90 | 25.30 |
| Restore a cached 1,000-ID request, Chromium/IndexedDB                            | 125.10 | 25.40 |
| Update a setting after another client's edit, with 1,000 saved documents         |  18.40 |  0.40 |

The Node fixture warms each case for at least ten iterations and 100 ms, then
records 25 individual operations. Transport returns prepared in-memory records;
there is no simulated network delay. Response normalization replays pending
optimistic edits 50 times instead of 50,000 times. Sparse graph reads perform
30,007 store reads instead of 40,006; unchanged computed dependencies require
10,004 instead of 20,005. Completeness checks and array assembly still scale with
the selected graph. These changes do not make arbitrary graph reads constant-time.

The browser storage fixture uses real IndexedDB, one unmeasured warmup, and nine
measured samples. Each remote sample starts with a fresh client after its
persistence session is ready; seeding, initial session setup, and subsequent
flushes are excluded. It verifies that restoration does not access the network.
For the nested graph, storage read calls fell from 1,009 to 41, with batches of at
most 32 keys. Legacy adapters without `readMany` use bounded concurrent reads.
Browser task yielding remains enabled, without nested-timer delays.

The ID-request fixture read 8,412,577 serialized bytes before and 460,302 after.
Long request keys previously repeated the complete ID array in every record's
claim. Stable SHA-256 identifiers now keep those claims small, with the request
descriptor stored once per root. Existing keys remain readable and migrate on
save. These byte counts measure JSON-encoded values returned by the storage
adapter, not physical IndexedDB disk usage.

The cross-client fixture disables change notifications to simulate a suspended
tab, alternates two clients sharing storage, and checks the resulting counter.
Each document has a 4 KiB string. Reconciliation read approximately 4.30 MB before
and 1.85 kB after the revision history filled. Same-client setting updates stayed
below 1 ms. History is bounded to 16 revisions, 256 changed-entry references, and
16 KiB, and can shrink further to respect the storage budget. Cold starts,
history gaps, legacy writers, and schema migrations retain the full-restore path.

The mounted React control benchmark used 1,000 rows and 40 measured updates.
Bulk updates remained comparable: 4.9 to 4.6 ms median and 7.0 to 7.3 ms p95.
Parent-only updates improved from 2.1 to 1.6 ms, retaining zero child rerenders.
Bulk timings varied between runs; the implementation avoids per-row dependency
graphs for flat rows so sparse-update caching does not require that allocation
on every bulk change. Scalar writes without graph reads remained about 0.001 ms
in the Node control. These desktop measurements do not predict mobile frame
times, network performance, or an application's complete paint time.

## Follow-up review: isolated commits and retained memory

The follow-up review measures each optimization against its immediate parent,
so the commit titles attribute the gain to that commit. The first response
benchmark uses 25 measured Node samples, the final selection benchmark uses 100,
and the storage benchmarks use nine Chromium samples, all after the warmup
specified above. These are separate runs from the combined baseline comparison.

| Commit    | Isolated operation                             | Before → after, ms | Speedup |
| --------- | ---------------------------------------------- | -----------------: | ------: |
| `234ad95` | 1,000 records with 50 optimistic layers        |     67.185 → 1.065 |   63.1x |
| `c4cbfd6` | Restore 1,000-row persisted graph              |       113.5 → 25.5 |   4.45x |
| `6efffed` | Restore 1,000-ID persisted request             |        35.4 → 27.5 |   1.29x |
| `87147e5` | Sparse edit and 10,000-row graph read          |       12.67 → 7.37 |   1.72x |
| `aa4e156` | Cross-tab setting update among 1,000 documents |         19.4 → 0.4 |   48.5x |

The review found and fixed a memory regression in the original fourth commit.
A global `WeakSet` tracking shared coverage sets retained approximately 64 MiB
of backing-table capacity after bursts of computed reads, even after the clients
were collected. Coverage ownership now belongs to each walk; completed coverage
is copied before modification. The fix and regression tests are folded into
that commit. The memory guard was also run against the unpatched implementation
and rejected its retained growth.

Dependency tracking has a bounded cost. The review reduced allocation by reusing
unchanged field sets and revision metadata, and stops constructing a separate
revision index after repeated computed-cache misses. Stable reads re-enable it.
Earlier paired runs measured about 11–15% overhead for a 10,000-row computation
whose inputs change on every read. After the final hot-path adjustment, the
100-sample paired control measured 4.73 → 4.70 ms median, but 5.37 → 5.76 ms p95
(about 7% worse). Treat this path as comparable at the median with some tail
cost and run variance, not as a universal speedup. Unchanged-input reads measure
4.63 → 2.88 ms. Mounted React bulk changes remain
comparable at 4.4 → 4.2 ms median and 7.3 → 7.3 ms p95; parent-only changes measure
2.1 → 1.6 ms, with no child rerenders. Scalar-write controls remain about 0.001 ms.

Run the retained-memory checks separately from timing benchmarks:

```sh
FATE_BENCH_BASELINE=550572c node scripts/benchmark-memory.mjs node /tmp/memory-before.json
node scripts/benchmark-memory.mjs node /tmp/memory-after.json
FATE_BENCH_BASELINE=550572c node scripts/benchmark-memory.mjs chromium /tmp/browser-memory-before.json
node scripts/benchmark-memory.mjs chromium /tmp/browser-memory-after.json
```

Node runs use `--expose-gc`; Chromium uses the DevTools garbage collector and
`Runtime.getHeapUsage`. Each workload records six post-GC checkpoints after
warmup. Ordinary Node operations yield between reads so `WeakRef` probes do not
keep an entire batch alive in one JavaScript job. A separate computed-burst case
intentionally runs 200 operations per task, covering the original regression.
The checks include 1,100 flat graph updates, 1,100 computed reads, 6,000 nested-row
updates, 270 responses with optimistic edits, 120 released clients, 110 browser
restore/dispose cycles, and 1,040 cross-tab mutations.

Final checkpoint heap values, in MiB, compared with `550572c`:

| Node workload                                   | Before | After |
| ----------------------------------------------- | -----: | ----: |
| Live 10,000-row flat graph                      |  17.24 | 17.10 |
| Live 10,000-row changing computation            |  16.44 | 16.54 |
| Live 1,000 nested rows                          |   7.73 |  8.62 |
| Optimistic-response workload                    |   6.98 |  6.59 |
| All clients released, including after the burst |   6.35 |  5.92 |

Nested subtree caching adds about 0.89 MiB in this fixture. Old snapshots and
replaced subtrees were collectible; only the current snapshot and 1,000 current
subtrees remained. All 120 released Node clients were collected. The harness
fails if released heap exceeds its initial value by 16 MiB; this is a generous
regression guard, not a general application memory limit. Small checkpoint
increases include JIT warmup and the benchmark's own growing array of weak probes.

Node RSS is recorded as well. The maximum sampled RSS during ordinary workloads
was 271 → 260 MiB; during the deliberate single-task burst it was 634 → 631 MiB.
RSS includes allocator reserves and does not return to initial process size just
because the live JavaScript objects have been collected. These are checkpoint
samples, not a continuous peak-RSS trace. Browser measurements cover the page's
JavaScript heap, not the entire browser process or IndexedDB disk usage.

Chromium's final checkpoints were 19.51 → 11.47 MiB for the two live cross-tab
clients, and 3.69 → 4.70 MiB after repeated remote-cache restores and disposal.
The latter is approximately 1 MiB of additional warmed page heap; it plateaued
rather than increasing with every restored client. All 110 disposed clients were
collectible. The cross-tab history stayed at 16 batches, 16 entry references, and
1,531 serialized bytes after 1,040 mutations. These results demonstrate bounded
behavior for the exercised workloads, not a guarantee for every application.

The source review covered grouped normalization under optimistic layers,
bounded batch reads and failure settlement, legacy-key migration and eviction,
selection/computed invalidation, and atomic cross-tab restoration and fallback.
No correctness regressions were found in the reviewed paths. `vp check --fix`
and `vp run test:all` passed, including 1,586 tests in 144 files; additional WebKit
persistence checks also passed. The known costs above are retained explicitly
rather than claiming that every workload becomes faster or uses less memory.

## Completeness traversal scaling

`node scripts/benchmark-core-scaling.mjs 50 /tmp/core.json` measures a sparse
row edit followed by a complete graph read. Set `FATE_BENCH_BASELINE=969a0b6`
to build the same fixture against the pre-change runtime. Node v26.13.1,
minified build, ten warmup iterations and 50 samples, run sequentially:
10,000 rows with ten fields took 20.57 → 13.53 ms median (1.52x faster).
Scalar coverage checks avoid splitting paths; storage field keys are reused
only within one traversal, so no cache survives the read or changes its coverage semantics.

## Shared request observers

The core scaling runner also measures ten independent observers over the same
request (cache-only and the result observer used by React). Against `8bb7034`,
30 samples on Node v26.13.1: a 10,000-row unselected-field edit with ten
cache-only observers took 87.79 → 3.17 ms median (27.70x faster).
The result-observer variant took 55.225 → 0.004 ms.
Dependency sets and revision-scoped completeness checks are shared only while
readers are subscribed. Scalar edits preserve dependency topology; list changes,
reference changes and rebases rebuild it. Snapshot reads are included; React
rendering is not.

## Batched client-record deletion

The core scaling runner measures a real client mutation deleting all records
from a related list. Seeding is excluded; staging, committing, cleanup and
completion are included. Seven fresh clients per size, discard the first two,
report the median of five. Against `1048f21` on Node v26.13.1, 3,000 deletes
took 969.11 → 2.82 ms (343.38x faster). Consecutive staged deletions
and persisted remote deletion batches share reference cleanup. An intervening
write flushes the batch to preserve delete/recreate ordering. Individual
low-level `deleteRecord` calls retain their synchronous semantics.

## Fresh cache-hit flushes

The browser cache runner now reports restore and subsequent flush separately,
including node writes. Run `node scripts/benchmark-cache-performance.mjs chromium 7 /tmp/cache.json`
with and without `FATE_BENCH_BASELINE=8b26975`. For 1,000 IDs, seven measured
restores after a warmup: subsequent flush 297.50 → 2.30 ms median
(129.35x faster), node writes 1,000 → 0. These are asynchronous elapsed
times on real IndexedDB, not continuous main-thread blocking. The fast path
requires the exact fresh root, the same TTL, and no pending/recovery node updates.
It refreshes LRU metadata even when the request was served directly from memory.
Policy changes, legacy migration, overlapping new requests and cache misses
retain the existing collection/save path.
