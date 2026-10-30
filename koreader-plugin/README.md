# Homebranch for KOReader

This plugin synchronizes private EPUB highlights, notes, and reading progress with Homebranch. Books are still browsed and downloaded using Homebranch's existing OPDS catalog. It does not mirror files or upload books.

## Install and pair

1. Install matching Homebranch API and web versions with KOReader integration enabled.
2. Copy `homebranch.koplugin` into the reader's `koreader/plugins/` directory and restart KOReader.
3. Open an EPUB, then open **Tools > Homebranch > Sync URL**. Enter the HTTPS API sync URL, normally `https://your-homebranch.example/api/koreader`.
4. Select **Pair device**. In a signed-in Homebranch browser, open **Settings > KOReader**, enter the displayed code, and explicitly approve that device. The code expires; use **Check pairing** if polling was interrupted.
5. Select **Sync now**. The EPUB must match a visible EPUB in the Homebranch library. If it cannot be verified, no annotation is applied to a guessed book.

The plugin owns its progress scheduling and speaks the native KOReader progress protocol directly. Do not also enable built-in KOSync automatic synchronization against the same Homebranch endpoint.

If several visible EPUB formats have identical content, open the desired EPUB in
the Homebranch reader and copy its format ID from the annotation panel. Enter it
under **Homebranch > EPUB format link**, then sync again. The ID selects a
candidate but does not bypass checksum verification or access checks. An already
linked EPUB is never silently reassigned to a different book.

For book downloads, add the OPDS catalog separately, normally `https://your-homebranch.example/api/opds/v1/catalog`, using its existing account login. Pairing credentials are not general-purpose OPDS or account credentials.

## Credential safety

Pairing does not ask for your Homebranch password on the reader, store it, or derive an MD5 from it. Browser approval issues a separate, random, revocable sync-only credential. The server stores a verifier rather than its usable value.

**The device credential is stored in ordinary KOReader settings, not encrypted storage.** Anyone who can read `settings/homebranch.lua` can use it to access that account's permitted sync data. This limited credential is deliberately separate from your account password and browser tokens. Treat reader backups containing this file as sensitive. Revoke lost or copied devices in Homebranch's KOReader settings.

**Forget device** removes the local credential and that account's pending work after confirmation. It does not imply server revocation: revoke the device in Homebranch settings as well. Forget before changing accounts or servers so another account cannot receive the previous account's queued edits.

Managed native highlights are also tagged with their pairing. Re-pairing never
automatically uploads a previous pairing's local notes into a new account.
Existing server annotations can be pulled into the new pairing normally. This
does not hide local sidecar files from someone with filesystem access to the
reader.

Canonical spine identity is recalculated when an EPUB opens, and its server
link is reverified before syncing. Different canonical contents keep separate
queues even if their sparse native checksums collide. Managed sidecar notes
from a different canonical edition are not silently uploaded to its replacement.

TLS verification checks both the server certificate chain and its subject alternative names against KOReader's bundled CA store. Plain HTTP, redirects, untrusted certificates, and mismatched hostnames are not accepted. Use a publicly trusted HTTPS certificate or maintain an appropriately trusted KOReader CA bundle. Never disable certificate verification to make a connection work.

## Synchronization behavior

- **Automatic sync** runs on reading/annotation activity and network reconnection with bounded retries. **Sync now** also captures note edits that do not emit a KOReader mutation event.
- Queued changes and acknowledgements are persisted. An interrupted upload retries the same mutation ID. An accepted retry is not a new edit.
- Remote pages are journaled before sidecar updates. After an interrupted checkpoint, replay finishes before local diffing so partially installed highlights are not mistaken for new edits or deletions.
- Conflicts use the latest server-accepted mutation, not the reader's clock or the furthest reading percentage. An explicit delete propagates; a later newly accepted edit can restore an annotation.
- On opening a book, a previously unseen remote reading position is offered before a local position is uploaded. A compatible native pointer is preferred. With chapter-aware API support, web-to-KOReader jumps use a verified table-of-contents section and progress within that section, rather than deriving a chapter from whole-book percentage.
- Chapter identity and passage precision are separate: the section can be exact while placement within it remains **approximate**. Multiple sections can share a resource, and a section can span resources. Repeated titles are not identifiers. The dialog shows the section and its percentage, with an approximate chapter page for the current device when calculable.
- Chapter jumps select a verified in-section native pointer, not a whole-book page percentage. A paginated page can also display preceding-section text; the selected logical reading point still belongs to the requested chapter. Applying a remote jump does not automatically overwrite its source coordinate.
- Missing, ambiguous, or stale chapter boundaries use an explicitly labeled resource or whole-book approximation. Boundary matching has a bounded work budget; a large or unsupported publication can retain fallback behavior rather than guessing a chapter. Old servers without the chapter-location capability continue using the legacy progress protocol.
- Chapter mapping resolves only the current or incoming section and its needed boundaries, with cooperative UI checkpoints. Automatic sync gives mapping a 0.5-second wall-time budget; **Sync now** allows 2 seconds. Budget checks occur between native calls and bounded HTML parsing steps, not inside them. Unfinished scans resume on later syncs instead of starting over. Verified native boundaries are cached per edition, chapter map, and reader DOM version; rendered positions are recalculated after layout changes. Page turns only consult the cache and never start a chapter search.
- Exact matching uses the verified EPUB plus the original native text range or literal quoted text. Repeated text must be disambiguated by context. The plugin never uses fuzzy matching or guesses a range.
- Unresolved annotations retain their quote and note under **Unresolved annotations** and in Homebranch. They are retried on later syncs and are not silently deleted.
- Only EPUB text highlights and associated notes are supported. PDF coordinates, standalone page bookmarks, PDF/audio progress bridging, and shared/public annotations are outside this integration.

## Compatibility and limits

The native anchor probe and reader-loading smoke check use KOReader **v2026.07.1** on Linux. The plugin uses public reader annotation/XPointer methods and the `AnnotationsModified`, `ReaderReady`, page/position, network, and close events. Other platforms need the same LuaJIT, LuaSec, secure random source, and reader APIs.

The separate codecs preserve native anchors and portable quote/context selectors. They do not claim that a crengine XPointer is a Readium locator or that CFI round-trips were implemented.

To keep search bounded on e-readers, resolution stops at 257 search hits or its character-work limit. A very common opening word, an unsupported layout, changed EPUB content, or ambiguous surrounding text can therefore leave an annotation unresolved instead of producing an unsafe placement. Full-quote crengine searches do not span inline elements; the plugin verifies candidates by extending public character pointers and checking the complete extracted quote. Chapter searches try a short prefix and extend ranges in batches, retrying first-token search when needed. Independent full-book duplicate checking still prevents a missed inline occurrence from being treated as unique. Annotation matching retains its existing first-token behavior.

Pending queues and cursors are per paired account and EPUB identity. Tombstones are not inferred from a missing page of remote results. Replacing an EPUB with a different edition requires a newly verified identity rather than reusing old positions.

Chapter-aware locations are an additive extension. Upgrade the API and apply its
registered migrations before updating clients. Existing native positions,
serialized web positions, and already queued operation IDs remain usable.
Upgrading does not retrofit a guessed chapter into an old percentage-only
position. See the [portable EPUB location contract](../homebranch-api/docs/epub-portable-location.md)
for the map identity, measurement basis, and compatibility rules. Font size and
screen size change approximate page counts; those counts are never stored as
universal page numbers.

The web/API deployment must publish the sync root under any reverse-proxy prefix, including all device-pairing and annotation extension routes. No extra Docker service or separate public KOSync account registration is required.

## Development checks

From the workspace root:

```sh
luajit koreader-plugin/test/unit.lua
luajit koreader-plugin/test/main.lua
luajit koreader-plugin/test/transport.lua
luajit koreader-plugin/test/locations.lua
```

The lifecycle tests cover pairing, account-change cancellation, stable retry IDs, no mutation echo after a remote application, approximate jump confirmation, and preserving a newer local position during an older upload acknowledgement. They use an in-memory transport, not a claim of network interoperability.

To exercise actual crengine against the original test EPUB sources, package a temporary EPUB:

```sh
python koreader-plugin/test/package-fixture.py /absolute/temporary/path/fixture.epub
cd /path/to/extracted/koreader
./luajit /absolute/workspace/koreader-plugin/test/native.lua \
  /absolute/workspace /absolute/temporary/path/fixture.epub
```

The native test initializes crengine, opens the EPUB, resolves inline multi-node highlights across chapters, captures and resolves native pointers, and rejects repeated or missing passages. It writes its own crengine cache beside the temporary EPUB. Use a disposable directory, not a real reader's data directory.

The fixtures are original minimal EPUB content containing repeated quotes, multiple chapters, inline emphasis, and an encoded resource path. `package-fixture.py` emits a deterministic archive without committing generated binaries.

`fixtures/chapter-locations` adds nested and fragment-based TOC entries, unequal
section lengths, repeated section titles, and a chapter that continues across
resources. Pass that directory as the packager's optional second argument.
`test/locations-native.lua` consumes that EPUB and its actual API-generated map
JSON to check the same section identities under different native layouts.
For a synthetic book with at least 90 sections and its API-generated map, add
`--scale` after those arguments to exercise bounded sync passes, UI scheduling
checkpoints, eventual section resolution, and cache reuse across layouts. This
mode reports total mapping time and the longest uninterrupted native slice; it
does not substitute for checking an actual e-reader.
`test/locations-live-api.lua` is a second driver for the native acceptance harness;
it checks chapter-aware native/browser progress, replay ordering, legacy writes,
and revocation over verified HTTPS.

For the real API/PostgreSQL round-trip, `test/live-api.lua` is driven by the API's
native acceptance harness over a private approval control channel. It exercises
the actual verified HTTPS transport and crengine, without writing credentials.
See [API acceptance setup](../homebranch-api/docs/koreader-api.md#repeatable-api-and-native-acceptance-commands)
for the disposable database, isolated runtime, and executable commands.
