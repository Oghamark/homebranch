local root = (arg[0]:match("^(.*)/") or ".") .. "/../homebranch.koplugin"
local dialogs, scheduled = {}, {}
local function widget()
    return {
        new = function(_, value) return value end,
        extend = function(_, value) return value end,
    }
end
for _, name in ipairs({ "confirmbox", "infomessage", "inputdialog", "container/widgetcontainer" }) do
    package.loaded["ui/widget/" .. name] = widget()
end
package.loaded["datastorage"] = { getSettingsDir = function() return "/not-written" end }
package.loaded["device"] = { model = "Test reader" }
package.loaded["ui/event"] = { new = function(_, name, value) return { name, value } end }
package.loaded["ui/network/manager"] = {
    isOnline = function() return true end, runWhenOnline = function(_, callback) callback() end,
}
package.loaded["ui/trapper"] = {
    wrap = function(_, callback) callback() end,
    dismissableRunInSubprocess = function(_, callback) return true, callback() end,
}
package.loaded["ui/uimanager"] = {
    show = function(_, dialog) dialogs[#dialogs + 1] = dialog end,
    close = function() end, setDirty = function() end,
    scheduleIn = function(_, delay, callback) scheduled[#scheduled + 1] = { delay, callback } end,
    unschedule = function() end,
}
package.loaded["luasettings"] = { open = function()
    return { readSetting = function(_, _, default) return default end,
        saveSetting = function() end, flush = function() end }
end }
package.loaded["ffi/sha2"] = { sha256 = function(value) return value end }
package.loaded["util"] = { partialMD5 = function() return "digest" end }
package.loaded["logger"] = { warn = function() end }
for _, name in ipairs({ "socket.http", "ltn12", "rapidjson", "socketutil" }) do package.loaded[name] = {} end
package.loaded["socket"] = { gettime = os.clock }

local Homebranch = dofile(root .. "/main.lua")
local function instance()
    local current, percentage = "start", 0.25
    local ui = {
        menu = { registerToMainMenu = function() end },
        document = {
            file = "test.epub", isXPointerInDocument = function() return true end,
            getTextFromXPointers = function() return "Exact quote" end,
            getSelectedWordContext = function() return "Before ", " after" end,
            findAllText = function() return {} end,
            getDocumentFileContent = function() return nil end,
        },
        rolling = { getLastProgress = function() return current end, getLastPercent = function() return percentage end },
        annotation = { annotations = {}, updateAnnotations = function() end },
        doc_settings = { readSetting = function() return "digest" end,
            saveSetting = function() end, flush = function() end },
        toc = { getTocTitleByPage = function() return "Chapter" end },
    }
    function ui:handleEvent(event)
        current = event[1] == "GotoXPointer" and event[2] or "approximate"
        percentage = event[1] == "GotoPercent" and event[2] / 100 or percentage
    end
    local plugin = setmetatable({ path = root, ui = ui }, { __index = Homebranch })
    plugin:init()
    plugin.settings.server = "https://example.test/koreader"
    plugin.settings.account = { username = "device-user", key = "sync-only-key", deviceId = "device" }
    plugin:onReaderReady()
    return plugin, function(position, fraction) current, percentage = position, fraction end
end
local count = 0
local function test(name, run)
    run()
    count = count + 1
    print("ok " .. count .. " - " .. name)
end

local function progressSync(plugin)
    local uploaded, remote = {}, nil
    plugin.current_state.bookId = "book"
    plugin.link_verified = true
    plugin.syncAnnotations = function() end
    plugin.transport.request = function(_, method, _, body)
        if method == "PUT" then
            assert(plugin.current_state.pendingProgressDraft == nil)
            uploaded[#uploaded + 1] = body
            remote = { percentage = body.percentage, nativeProgress = body.progress, revision = "accepted" }
        end
        return { body = remote }
    end
    return uploaded
end
local function mappedLocation(plugin)
    plugin.location_bounds = { cache = { domVersion = "digest" }, map = {}, has_chapters = true }
    plugin.locations.compatible = function(_, location) return type(location) == "table" end
    plugin.locations.capture = function(_, bounds, point)
        if bounds.resolved_point == point then
            return { chapterId = "chapter-two", chapterProgression = 0.4 }
        end
    end
end

test("first sync enriches a never-attempted page-turn snapshot after chapter mapping", function()
    local plugin, move = instance()
    local uploaded = progressSync(plugin)
    mappedLocation(plugin)
    local mappings = 0
    plugin.locations.resolve = function(_, bounds, point)
        mappings = mappings + 1
        bounds.resolved_point = point
        return true
    end
    move("cold-pointer", 0.6)
    plugin:onPageUpdate()
    local original = plugin.current_state.pendingProgress
    assert(mappings == 0 and original.location == nil)
    plugin:sync(false)
    assert(mappings == 1 and #uploaded == 1)
    assert(uploaded[1].progress == "cold-pointer" and uploaded[1].percentage == 0.6)
    assert(uploaded[1].location.chapterId == "chapter-two")
    assert(uploaded[1].mutationId ~= original.mutationId and original.location == nil)
end)
test("passage-capable drafts wait for extraction and receive a new immutable operation", function()
    local plugin, move = instance()
    local uploaded = progressSync(plugin)
    mappedLocation(plugin)
    plugin.location_bounds.map.capabilities = { passageAnchor = 1 }
    local ready = false
    plugin.locations.capture = function(_, bounds, point)
        if bounds.resolved_point == point then
            return { chapterId = "chapter-two", passage = ready and { version = 1, exact = "A verified passage." } or nil }
        end
    end
    plugin.locations.resolve = function(_, bounds, point)
        bounds.resolved_point = point
        bounds.pending_resolution = not ready and {} or nil
        return ready
    end
    move("cold-pointer", 0.6)
    plugin:onPageUpdate()
    local original = plugin.current_state.pendingProgress
    plugin:sync(false)
    assert(#uploaded == 0 and plugin.current_state.pendingProgress == original)
    ready = true
    plugin:sync(false)
    assert(#uploaded == 1 and uploaded[1].location.passage.exact == "A verified passage.")
    assert(uploaded[1].mutationId ~= original.mutationId and original.location == nil)
end)
test("paused mapping retains an unsent snapshot and resumes before its first upload", function()
    local plugin, move = instance()
    local uploaded = progressSync(plugin)
    mappedLocation(plugin)
    local passes = 0
    plugin.locations.resolve = function(_, bounds, point)
        passes = passes + 1
        if passes == 1 then bounds.pending_resolution = {}; return false, "Paused" end
        bounds.pending_resolution, bounds.resolved_point = nil, point
        return true
    end
    move("cold-pointer", 0.6)
    plugin:onPageUpdate()
    local original = plugin.current_state.pendingProgress
    scheduled = {}
    plugin:sync(false)
    assert(#uploaded == 0 and plugin.current_state.pendingProgress == original)
    assert(plugin.current_state.pendingProgressDraft.mutationId == original.mutationId)
    assert(#scheduled == 1 and scheduled[1][1] == 1)
    plugin:sync(false)
    assert(#uploaded == 1 and uploaded[1].location.chapterId == "chapter-two")
end)
test("an ambiguous upload is retried unchanged even when chapter mapping becomes available", function()
    local plugin, move = instance()
    plugin.current_state.bookId = "book"
    move("cold-pointer", 0.6)
    plugin:onPageUpdate()
    local original = plugin.current_state.pendingProgress
    plugin.transport.request = function()
        assert(plugin.current_state.pendingProgressDraft == nil)
        return { error = "Interrupted after server acceptance" }
    end
    assert(not pcall(function() plugin:pushProgress(plugin.current_state) end))
    assert(plugin.current_state.pendingProgress == original and original.location == nil)
    mappedLocation(plugin)
    plugin.locations.capture = function() error("Attempted payloads must not be recaptured.") end
    plugin.transport.request = function(_, method, _, body)
        if method == "PUT" then assert(body == original and body.location == nil) end
        return { body = { nativeProgress = original.progress, revision = "accepted" } }
    end
    plugin:pushProgress(plugin.current_state)
    assert(plugin.current_state.pendingProgress == nil)
end)
test("movement during mapping is resolved before uploading the newer page-turn snapshot", function()
    local plugin, move = instance()
    local uploaded = progressSync(plugin)
    mappedLocation(plugin)
    local passes = 0
    plugin.locations.resolve = function(_, bounds, point)
        passes = passes + 1
        bounds.resolved_point = point
        if passes == 1 then move("newer-pointer", 0.9); plugin:onPageUpdate() end
        return true
    end
    move("cold-pointer", 0.6)
    plugin:onPageUpdate()
    local original = plugin.current_state.pendingProgress
    plugin:sync(false)
    assert(#uploaded == 0 and plugin.current_state.pendingProgress.progress == "newer-pointer")
    plugin:sync(false)
    assert(#uploaded == 1 and uploaded[1].progress == "newer-pointer" and uploaded[1].percentage == 0.9)
    assert(uploaded[1].location.chapterId == "chapter-two" and original.location == nil)
end)
test("incoming chapter jumps wait for paused mapping instead of offering a premature whole-book fallback", function()
    local plugin = instance()
    mappedLocation(plugin)
    plugin.current_state.bookId, plugin.link_verified = "book", true
    plugin.syncAnnotations = function() end
    local ready = false
    plugin.locations.resolve = function(_, bounds)
        bounds.pending_resolution = not ready and {} or nil
        return ready, ready and nil or "Paused"
    end
    plugin.locations.target = function()
        if ready then return { point = "chapter-pointer", chapter = true, label = "Chapter two, approximately 40% through chapter" } end
        return nil, "Chapter mapping is pending."
    end
    plugin.transport.request = function(_, method)
        assert(method == "GET")
        return { body = { percentage = 0.6, source = "web", revision = "incoming",
            location = { chapterId = "chapter-two" }, device = "Browser" } }
    end
    local before = #dialogs
    plugin:sync(false)
    assert(#dialogs == before and plugin.current_state.seenProgress ~= "incoming")
    ready = true
    plugin:sync(false)
    assert(dialogs[#dialogs].text:find("Chapter two") and dialogs[#dialogs].text:find("through chapter"))
    dialogs[#dialogs].ok_callback()
    plugin:onPageUpdate()
    assert(plugin.current_state.pendingProgress == nil and plugin.current_state.pendingProgressDraft == nil)
    assert(plugin.current_state.seenProgress == "incoming")
end)
test("verified passage confirmation cannot silently downgrade after its cache changes", function()
    local plugin = instance()
    mappedLocation(plugin)
    plugin.locations.target = function()
        return { point = "passage-pointer", passage = true, chapter = true, label = "Verified saved passage" }
    end
    plugin:offerProgress({ percentage = 0.6, source = "web", revision = "incoming",
        location = { chapterId = "chapter-two", passage = { version = 1, exact = "A verified passage." } } })
    local prompt = dialogs[#dialogs]
    assert(prompt.ok_text == "Jump" and prompt.text:find("Verified saved passage", 1, true))
    plugin.locations.target = function()
        return { point = "approximate-pointer", chapter = true, label = "An approximate chapter target" }
    end
    prompt.ok_callback()
    assert(plugin.ui.rolling:getLastProgress() == "start" and plugin.current_state.seenProgress ~= "incoming")
    assert(dialogs[#dialogs].text:find("No jump was applied", 1, true))
end)
test("a failed attempted-state checkpoint prevents upload and leaves the draft safely retryable", function()
    local plugin, move = instance()
    local uploaded = progressSync(plugin)
    mappedLocation(plugin)
    move("cold-pointer", 0.6)
    plugin:onPageUpdate()
    plugin.location_bounds.resolved_point = "cold-pointer"
    local flush = plugin.store.flush
    plugin.store.flush = function() error("Disk unavailable") end
    assert(not pcall(function() plugin:pushProgress(plugin.current_state) end))
    assert(#uploaded == 0)
    assert(plugin.current_state.pendingProgressDraft.mutationId == plugin.current_state.pendingProgress.mutationId)
    plugin.store.flush = flush
    plugin:pushProgress(plugin.current_state)
    assert(#uploaded == 1 and uploaded[1].location.chapterId == "chapter-two")
end)
test("a silent settings write failure cannot leave an attempted operation marked as an unsent draft", function()
    local plugin, move = instance()
    local uploaded = progressSync(plugin)
    mappedLocation(plugin)
    move("cold-pointer", 0.6)
    plugin:onPageUpdate()
    local state = plugin.current_state
    local persisted = { account = { username = plugin.settings.account.username, documents = {
        [state.documentKey] = { pendingProgress = state.pendingProgress, pendingProgressDraft = state.pendingProgressDraft },
    } } }
    plugin.store.file = "/not-written/homebranch.lua"
    local settings = package.loaded["luasettings"]
    local open = settings.open
    settings.open = function()
        return { readSetting = function() return persisted end }
    end
    plugin.location_bounds.resolved_point = "cold-pointer"
    local ok, err = pcall(function() plugin:pushProgress(state) end)
    settings.open = open
    assert(not ok and err:find("Could not checkpoint") and #uploaded == 0)
    assert(state.pendingProgressDraft.mutationId == state.pendingProgress.mutationId)
end)
test("a DOM change cannot attach new chapter coordinates to an older native snapshot", function()
    local plugin, move = instance()
    progressSync(plugin)
    move("cold-pointer", 0.6)
    plugin:onPageUpdate()
    local original = plugin.current_state.pendingProgress
    mappedLocation(plugin)
    plugin.ui.doc_settings.readSetting = function() return 20260101 end
    plugin.locations.capture = function() error("Do not recapture a snapshot from another DOM.") end
    plugin:pushProgress(plugin.current_state)
    assert(original.location == nil and plugin.current_state.pendingProgress == nil)
end)

test("initial sync reads remote before publishing and does not echo remote jumps", function()
    local plugin = instance()
    local requests = {}
    plugin.transport.request = function(_, method, path)
        requests[#requests + 1] = method .. " " .. path
        if path == "/documents/resolve" then return { body = { bookId = "book", formatId = "format" } } end
        if path:match("/annotations") then return { body = { items = {}, cursor = "0" } } end
        return { body = { percentage = 0.75, source = "web", accuracy = "approximate", revision = "2", device = "Browser" } }
    end
    plugin:sync(false)
    assert(requests[2] == "GET /books/book/progress")
    assert(not table.concat(requests, "\n"):find("PUT"))
    local dialog = dialogs[#dialogs]
    assert(dialog.text:find("approximately"))
    dialog.ok_callback()
    plugin:onPageUpdate()
    assert(plugin.current_state.pendingProgress == nil)
    assert(plugin.current_state.seenProgress == "2")
end)
test("chapter-aware jumps are offered even when whole-book percentages coincide", function()
    local plugin = instance()
    plugin.ui.document.info = { doc_height = 1000 }
    local rendered_position = 400
    plugin.locations.target = function()
        return { point = "chapter-two-" .. rendered_position, label = "Chapter two, approximately 50% through chapter" }
    end
    plugin:offerProgress { percentage = 0.25, revision = "chapter-revision", source = "web",
        location = {}, device = "Browser" }
    local dialog = dialogs[#dialogs]
    assert(dialog.text:find("Chapter two") and dialog.text:find("through chapter"))
    rendered_position = 600
    dialog.ok_callback()
    assert(plugin.ui.rolling:getLastProgress() == "chapter-two-600")
    plugin:onPageUpdate()
    assert(plugin.current_state.pendingProgress == nil)
end)
test("new maps do not retrofit portable fields into an already queued operation", function()
    local plugin = instance()
    local operation = { mutationId = "queued-before-upgrade", progress = "old-pointer", percentage = 0.1 }
    plugin.current_state.pendingProgress = operation
    plugin.locations.prepare = function(_, map) return { map = map } end
    plugin.transport.request = function(_, method, path)
        assert(method == "GET" and path == "/books/book/location-map?formatId=format")
        return { body = { formatId = "format", contentHash = "contents" } }
    end
    plugin:loadLocationMap { bookId = "book", formatId = "format", capabilities = { portableLocation = 1 } }
    assert(plugin.current_state.pendingProgress == operation and operation.location == nil)
    assert(operation.mutationId == "queued-before-upgrade")
    plugin.current_state.bookId = "book"
    plugin.locations.capture = function() error("Pre-upgrade operations must not be recaptured.") end
    plugin.transport.request = function(_, method, _, body)
        if method == "PUT" then assert(body == operation and body.location == nil) end
        return { body = { nativeProgress = operation.progress, revision = "accepted" } }
    end
    plugin:pushProgress(plugin.current_state)
end)
test("new reading changes capture portable coordinates after map verification", function()
    local plugin, move = instance()
    plugin.location_bounds = { map = {} }
    plugin.locations.capture = function(_, bounds, point)
        assert(bounds == plugin.location_bounds and point == "new-pointer")
        return { version = 1, chapterId = "Text/chapter.xhtml#second", chapterProgression = 0.4 }
    end
    plugin.ui.doc_settings.readSetting = function(_, key)
        return key == "cre_dom_version" and 20240114 or "digest"
    end
    move("new-pointer", 0.6)
    plugin:onPageUpdate()
    local queued = plugin.current_state.pendingProgress
    assert(queued.progress == "new-pointer" and queued.location.chapterProgression == 0.4)
    assert(queued.location.chapterId == "Text/chapter.xhtml#second")
    assert(queued.location.native.engine == "crengine" and queued.location.native.domVersion == 20240114)
end)
test("portable native pointers require matching DOM provenance before precise restoration", function()
    for _, dom_version in ipairs({ 20240114, 20200101 }) do
        local plugin = instance()
        plugin.ui.document.info = { doc_height = 1000 }
        plugin.ui.doc_settings.readSetting = function(_, key)
            return key == "cre_dom_version" and 20240114 or "digest"
        end
        plugin.locations.compatible = function() return true end
        plugin.locations.target = function()
            return { point = "chapter-estimate", label = "Chapter, approximately 50% through chapter" }
        end
        plugin:offerProgress { percentage = 0.8, revision = "dom-version", source = "koreader",
            nativeProgress = "native-pointer", location = { native = { engine = "crengine", domVersion = dom_version } } }
        dialogs[#dialogs].ok_callback()
        if dom_version == 20240114 then assert(plugin.ui.rolling:getLastProgress() == "native-pointer")
        else assert(plugin.ui.rolling:getLastProgress() == "chapter-estimate") end
    end
end)
test("native confirmation refuses a DOM version changed while the prompt was open", function()
    local plugin = instance()
    local dom_version = 20240114
    plugin.ui.doc_settings.readSetting = function(_, key)
        return key == "cre_dom_version" and dom_version or "digest"
    end
    plugin.locations.compatible = function() return true end
    plugin:offerProgress { percentage = 0.8, revision = "changed-dom", source = "koreader",
        nativeProgress = "native-pointer", location = { native = { engine = "crengine", domVersion = dom_version } } }
    local dialog = dialogs[#dialogs]
    dom_version = 20200101
    dialog.ok_callback()
    assert(plugin.ui.rolling:getLastProgress() == "start")
    assert(plugin.current_state.seenProgress ~= "changed-dom")
    assert(dialogs[#dialogs].text:find("DOM version changed"))
end)
test("interrupted uploads retain the same mutation until acknowledged", function()
    local plugin = instance()
    plugin.current_state.bookId = "book"
    plugin.ui.annotation.annotations = {
        { drawer = "lighten", text = "Exact quote", pos0 = "a", pos1 = "b", color = "yellow" },
    }
    plugin:collect()
    local mutation = plugin.current_state.pending[1].body.mutationId
    plugin.transport.request = function() return { error = "Interrupted" } end
    assert(not pcall(function() plugin:syncAnnotations() end))
    assert(plugin.current_state.pending[1].body.mutationId == mutation)
    plugin.transport.request = function(_, method)
        return { body = method == "GET" and { items = {}, cursor = "1" } or {} }
    end
    plugin:syncAnnotations()
    assert(#plugin.current_state.pending == 0)
end)
test("remote application produces no annotation mutation echo", function()
    local plugin = instance()
    local remote = { id = "a", quote = "Exact quote", note = "From web", color = "#ffff00", deleted = false,
        anchor = { version = 1, exact = "Exact quote", href = "chapter.xhtml",
            native = { pos0 = "a", pos1 = "b" } } }
    assert(plugin:apply(remote))
    plugin:collect()
    assert(#plugin.current_state.pending == 0)
    assert(plugin.current_state.known.a.body.anchor.href == "chapter.xhtml")
    assert(plugin.ui.annotation.annotations[1].note == "From web")
    assert(plugin.ui.annotation.annotations[1].homebranch_owner == "device-user")
end)
test("a new local position during upload is not discarded by an older acknowledgement", function()
    local plugin = instance()
    local state = plugin.current_state
    state.bookId = "book"
    state.pendingProgress = { mutationId = "first", progress = "a" }
    plugin.transport.request = function(_, method)
        if method == "PUT" then
            state.pendingProgress = { mutationId = "second", progress = "b" }
            state.pendingProgressDraft = { mutationId = "second" }
            return { body = {} }
        end
        return { body = { revision = "3", nativeProgress = "a" } }
    end
    plugin:pushProgress(state)
    assert(state.pendingProgress.mutationId == "second")
    assert(state.pendingProgressDraft.mutationId == "second")
end)
test("account changes cancel in-flight response application", function()
    local plugin = instance()
    plugin.transport.request = function()
        plugin.epoch = plugin.epoch + 1
        return { body = {} }
    end
    local ok, err = pcall(function() plugin:request("GET", "/users/auth") end)
    assert(not ok and err:find("cancelled"))
end)
test("an annotation application error cannot leave mutation capture suppressed", function()
    local plugin = instance()
    plugin.anchors.resolve = function() error("Reader unavailable") end
    local ok = pcall(function() plugin:apply({ id = "a", anchor = {}, deleted = false }) end)
    assert(not ok and not plugin.applying)
end)
test("pairing persists only scoped credential and isolates account state", function()
    local plugin = instance()
    plugin.settings.account = nil
    plugin.pairing = { deviceCode = "poll-secret", expires_at = os.time() + 100 }
    plugin.transport.request = function()
        return { body = { state = "approved", username = "new-user", key = "new-key", deviceId = "new-device" } }
    end
    plugin:claimPairing()
    assert(plugin.settings.account.key == "new-key")
    assert(next(plugin.settings.account.documents) == nil)
    assert(plugin.pairing == nil)
    assert(plugin.settings.account.password == nil)
end)
test("switching accounts does not upload another pairing's native annotations", function()
    local plugin = instance()
    plugin.ui.annotation.annotations = {
        { drawer = "lighten", text = "Exact quote", pos0 = "a", pos1 = "b", color = "yellow" },
    }
    plugin:collect()
    local original = plugin.ui.annotation.annotations[1]
    local previous = plugin.current_state.known[original.homebranch_id]
    assert(original.homebranch_owner == "device-user")
    plugin.settings.account = { username = "other-account-device", documents = {} }
    plugin.current_state = plugin.state_ops.document(plugin.settings.account, "digest")
    plugin.current_state.known[original.homebranch_id] = previous
    plugin:collect()
    assert(#plugin.current_state.pending == 0)
    assert(plugin.excluded_annotations == 1)
    assert(original.homebranch_owner == "device-user")
end)
test("replaced EPUB content gets separate state even when sparse checksums collide", function()
    local plugin = instance()
    plugin.identity.contentHash = function() return "original-spine-hash" end
    plugin:onReaderReady()
    plugin.ui.annotation.annotations = {
        { drawer = "lighten", text = "Exact quote", pos0 = "a", pos1 = "b", color = "yellow" },
    }
    plugin:collect()
    local original = plugin.current_state
    plugin.identity.contentHash = function() return "replacement-spine-hash" end
    plugin:onReaderReady()
    plugin:collect()
    assert(plugin.current_state ~= original)
    assert(#plugin.current_state.pending == 0)
    assert(#original.pending == 1)
    plugin.identity.contentHash = function() return "original-spine-hash" end
    plugin:onReaderReady()
    assert(plugin.current_state == original)
end)
test("cached EPUB links are reverified before a reopened document synchronizes", function()
    local plugin = instance()
    plugin.current_state.bookId, plugin.current_state.formatId = "book", "format"
    plugin.transport.request = function(_, _, path, body)
        assert(path == "/documents/resolve" and body.formatId == "format")
        return { error = "Replaced edition no longer matches" }
    end
    assert(not pcall(function() plugin:sync(false) end))
end)
test("stale progress prompts cannot move a newly opened book", function()
    local plugin = instance()
    plugin:offerProgress { percentage = 0.8, revision = "1", source = "web" }
    local dialog = dialogs[#dialogs]
    plugin.epoch = plugin.epoch + 1
    plugin:onReaderReady()
    dialog.ok_callback()
    assert(plugin.ui.rolling:getLastProgress() == "start")
    dialog.cancel_callback()
    assert(plugin.current_state.pendingProgress == nil)
end)
test("interrupted remote batches recover before local changes are collected", function()
    for _, sidecar_written in ipairs({ false, true }) do
        local plugin = instance()
        plugin.current_state.bookId = "book"
        local remote = { id = "a", quote = "Exact quote", note = "From web", color = "#ffff00", deleted = false,
            anchor = { version = 1, exact = "Exact quote", native = { pos0 = "a", pos1 = "b" } } }
        plugin.transport.request = function()
            return { body = { items = { remote }, cursor = "4" } }
        end
        local flushes = 0
        plugin.ui.doc_settings.flush = function()
            flushes = flushes + 1
            if flushes == 2 then error("Interrupted sidecar checkpoint") end
        end
        assert(not pcall(function() plugin:syncAnnotations() end))
        assert(plugin.current_state.incoming and not plugin.applying)
        plugin.current_state.known = {}
        plugin.current_state.cursor = "0"
        if not sidecar_written then plugin.ui.annotation.annotations = {} end
        plugin.ui.doc_settings.flush = function() end
        plugin:onReaderReady()
        assert(plugin.current_state.incoming == nil and plugin.current_state.cursor == "4")
        assert(#plugin.ui.annotation.annotations == 1 and plugin.ui.annotation.annotations[1].note == "From web")
        plugin:collect()
        assert(#plugin.current_state.pending == 0)
    end
end)

test("chapter preparation yields to the UI and cancels safely on document or account changes", function()
    local original_wrap = package.loaded["ui/trapper"].wrap
    local original_time = package.loaded["socket"].gettime
    for _, change in ipairs({ "document", "account", "dom", "reopen" }) do
        local plugin, move = instance()
        move("600", 0.6)
        local state, searches, after_mapping, clock, worker = plugin.current_state, 0, false, 0
        local pending = { mutationId = "immutable-before-mapping", progress = "old-pointer", percentage = 0.2 }
        state.pendingProgress = pending
        local dom_version = 20240114
        plugin.ui.doc_settings.readSetting = function(_, key)
            return key == "cre_dom_version" and dom_version or "digest"
        end
        plugin.ui.document.compareXPointers = function() return 1 end
        plugin.anchors.resolve = function(_, _, options)
            searches = searches + 1
            for _ = 1, 1000 do options.checkpoint() end
            error("Mapping did not yield or stop at its time limit.")
        end
        plugin.syncAnnotations = function() after_mapping = true end
        local map = { version = 1, formatId = "format", contentHash = "contents", fingerprint = "map",
            resources = { { href = "one.xhtml", start = 0, ["end"] = 1000, anchor = { exact = "First" } } },
            chapters = {} }
        plugin.transport.request = function(_, _, path)
            if path == "/documents/resolve" then
                return { body = { bookId = "book", formatId = "format", capabilities = { portableLocation = 1 } } }
            end
            if path:find("/location%-map") then return { body = map } end
            return { body = { percentage = 0.8, source = "web", revision = "unseen" } }
        end
        package.loaded["socket"].gettime = function() clock = clock + 0.001; return clock end
        package.loaded["ui/trapper"].wrap = function(_, callback)
            worker = coroutine.create(callback)
            assert(coroutine.resume(worker))
        end
        scheduled = {}
        plugin:startSync(false)
        assert(plugin.busy and searches == 1 and coroutine.status(worker) == "suspended")
        assert(#scheduled == 1 and scheduled[1][1] == 0.05)
        assert(state.pendingProgress == pending and pending.location == nil)
        if change == "document" then plugin:onCloseDocument()
        elseif change == "account" then
            plugin.epoch = plugin.epoch + 1
            plugin.settings.account = { username = "other", documents = {} }
            plugin.current_state = nil
        elseif change == "dom" then dom_version = 20200101
        else plugin:onReaderReady() end
        local saves = 0
        plugin.store.flush = function() saves = saves + 1 end
        scheduled[1][2]()
        assert(coroutine.status(worker) == "dead" and not plugin.busy and not after_mapping)
        assert(searches == 1 and saves == 0 and not state.locationCache)
        assert(state.pendingProgress == pending and pending.mutationId == "immutable-before-mapping")
        assert(dialogs[#dialogs].text:find("cancelled"))
    end
    package.loaded["ui/trapper"].wrap = original_wrap
    package.loaded["socket"].gettime = original_time
end)

test("automatic chapter deadlines leave sync and immutable queued progress usable", function()
    local plugin, move = instance()
    move("600", 0.6)
    local clock, searches, annotations = 0, 0, false
    local original_time = package.loaded["socket"].gettime
    package.loaded["socket"].gettime = function() return clock end
    plugin.anchors.resolve = function(_, _, options)
        searches = searches + 1
        for _ = 1, 1000 do clock = clock + 0.001; options.checkpoint() end
        error("Time limit was not checked inside the anchor.")
    end
    plugin.current_state.bookId = "book"
    local pending = { mutationId = "unchanged", progress = "old", percentage = 0.2 }
    plugin.current_state.pendingProgress = pending
    plugin.link_verified = true
    plugin.location_bounds = assert(plugin.locations.prepare(plugin.ui.document, {
        version = 1, formatId = "format", contentHash = "contents", fingerprint = "map",
        resources = { { href = "one.xhtml", start = 0, ["end"] = 1000, anchor = { exact = "First" } } },
        chapters = {},
    }, plugin.anchors, { domVersion = "digest" }))
    plugin.syncAnnotations = function() annotations = true end
    plugin.transport.request = function(_, method, _, body)
        if method == "PUT" then assert(body == pending and body.location == nil) end
        return { body = { nativeProgress = "old", revision = "known" } }
    end
    plugin.current_state.seenProgress = "known"
    plugin:startSync(false)
    assert(annotations and searches == 1 and clock < 0.51 and not plugin.busy)
    assert(plugin.location_bounds.warning:find("time limit") and not plugin.current_state.pendingProgress)
    package.loaded["socket"].gettime = original_time
end)
print("Passed " .. count .. " plugin lifecycle tests.")
