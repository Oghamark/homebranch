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
            return { body = {} }
        end
        return { body = { revision = "3", nativeProgress = "a" } }
    end
    plugin:pushProgress(state)
    assert(state.pendingProgress.mutationId == "second")
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
print("Passed " .. count .. " plugin lifecycle tests.")
