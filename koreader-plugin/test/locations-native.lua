-- Run in an extracted KOReader directory with repository, EPUB and map JSON paths.
require("setupkoenv")
local cre = require("libs/libkoreader-cre")
local json = require("rapidjson")
local socket = require("socket")
local root = arg[1] .. "/koreader-plugin/homebranch.koplugin/"
local Locations = dofile(root .. "locations.lua")
local Anchors = dofile(root .. "anchors.lua")
local Identity = dofile(root .. "identity.lua")
local function coldProgress(document, current, expected, map)
    local callbacks, notices = {}, {}
    local function widget()
        return { new = function(_, value) return value end, extend = function(_, value) return value end }
    end
    for _, name in ipairs({ "confirmbox", "infomessage", "inputdialog", "container/widgetcontainer" }) do
        package.loaded["ui/widget/" .. name] = widget()
    end
    local directory = arg[2] .. ".location-cache"
    package.loaded["datastorage"] = { getSettingsDir = function() return directory end }
    package.loaded["device"] = { model = "Native proof" }
    package.loaded["ui/event"] = {}
    package.loaded["ui/network/manager"] = { isOnline = function() return true end }
    package.loaded["ui/trapper"] = {
        dismissableRunInSubprocess = function(_, callback) return true, callback() end,
    }
    package.loaded["ui/uimanager"] = {
        show = function(_, notice) notices[#notices + 1] = notice end,
        scheduleIn = function(_, delay, callback)
            if delay == 0.05 then callbacks[#callbacks + 1] = callback end
        end,
        unschedule = function() end,
    }
    local Homebranch = dofile(root .. "main.lua")
    local point = document:getPageXPointer(1)
    local dom_version = cre.getLatestDomVersion()
    document.file = arg[2]
    local plugin = setmetatable({ path = root, ui = {
        document = document,
        menu = { registerToMainMenu = function() end },
        annotation = { annotations = {} },
        rolling = {
            getLastProgress = function() return point end,
            getLastPercent = function() return document:getPosFromXPointer(point) / document.info.doc_height end,
        },
        doc_settings = { readSetting = function(_, key)
            if key == "cre_dom_version" then return dom_version end
            if key == "partial_md5_checksum" then return string.rep("a", 32) end
        end },
    } }, { __index = Homebranch })
    plugin:init()
    plugin.settings.server = "https://example.test/koreader"
    plugin.settings.account = { username = "native-proof", deviceId = "proof-device" }
    plugin:onReaderReady()
    point = current
    plugin:onPageUpdate()
    local original = assert(plugin.current_state.pendingProgress)
    assert(original.location == nil, "The cold page-turn snapshot must precede map preparation.")
    local uploaded, remote
    plugin.syncAnnotations = function() end
    plugin.transport.request = function(_, method, path, body)
        if path == "/documents/resolve" then
            return { body = { bookId = "fixture", formatId = map.formatId, capabilities = { portableLocation = 1 } } }
        end
        if path:find("/location%-map") then return { body = map } end
        if method == "PUT" then
            assert(plugin.current_state.pendingProgressDraft == nil)
            assert(body.location and body.location.chapterId == expected,
                "The first cold-sync upload must carry the native reading point's verified chapter.")
            assert(body.location.passage, "The first unsent upload must include its bounded passage.")
            assert(body.progress == original.progress and body.percentage == original.percentage)
            assert(body.mutationId ~= original.mutationId and original.location == nil)
            uploaded = body
            remote = { source = "koreader", nativeProgress = body.progress, percentage = body.percentage, revision = "1" }
        end
        return { body = remote }
    end
    local passes, longest = 0, 0
    repeat
        passes = passes + 1
        local worker = coroutine.create(function() plugin:sync(false) end)
        local started = socket.gettime()
        assert(coroutine.resume(worker))
        longest = math.max(longest, socket.gettime() - started)
        while coroutine.status(worker) ~= "dead" do
            local callback = assert(table.remove(callbacks, 1), "Mapping must schedule its UI continuation.")
            assert(document:isXPointerInDocument(current))
            socket.sleep(0.05)
            started = socket.gettime()
            callback()
            longest = math.max(longest, socket.gettime() - started)
        end
        assert(#notices == 0, notices[1] and notices[1].text)
    until uploaded or passes >= 20
    assert(uploaded and longest < 0.25, "Cold progress mapping must finish without stalling the UI.")
    assert(plugin.current_state.pendingProgress == nil and plugin.current_state.pendingProgressDraft == nil)
    local persisted = require("luasettings"):open(plugin.store.file):readSetting("settings")
    assert(persisted.account.documents[plugin.current_state.documentKey].seenProgress == "1")
    assert(os.remove(plugin.store.file))
    print(string.format("Verified cold plugin upload: %d bounded sync passes, longest native/UI slice %.3fs.",
        passes, longest))
end
local file = assert(io.open(arg[3], "rb"))
local map = json.decode(file:read("*a"))
map.capabilities = { passageAnchor = 1 }
file:close()
cre.initCache(arg[2] .. ".location-cache", 8 * 1024 * 1024)
cre.initHyphDict("./data/hyph/")
cre.registerFont("fonts/noto/NotoSerif-Regular.ttf")

local boundary_cache, reading_point
local passage_samples = {}
for _, layout in ipairs({ { 600, 800, 18 }, { 320, 640, 26 } }) do
    local native = cre.newDocView(layout[1], layout[2], 1)
    native:setStringProperty("font.face.default", "Noto Serif")
    native:setFontSize(layout[3])
    assert(native:loadDocument(arg[2]), "Fixture failed to load.")
    native:renderDocument()
    local calls = { searches = 0, ranges = 0, bodies = 0 }
    local document = {
        info = { doc_height = native:getFullHeight() },
        isXPointerInDocument = function(_, xp) return native:isXPointerInDocument(xp) end,
        getTextFromXPointers = function(_, a, b) return native:getTextFromXPointers(a, b, false, false) end,
        getNextVisibleChar = function(_, xp) return native:getNextVisibleChar(xp) end,
        getPrevVisibleChar = function(_, xp) return native:getPrevVisibleChar(xp) end,
        getTextFromXPointer = function(_, xp) return native:getTextFromXPointer(xp) end,
        getHTMLFromXPointer = function(_, xp, flags)
            calls.bodies = calls.bodies + 1
            return native:getHTMLFromXPointer(xp, flags)
        end,
        getHTMLFromXPointers = function(_, a, b, flags, full)
            calls.ranges = calls.ranges + 1
            return native:getHTMLFromXPointers(a, b, flags, full)
        end,
        getPosFromXPointer = function(_, xp) return native:getPosFromXPointer(xp) end,
        getPageFromXPointer = function(_, xp) return native:getPageFromXPointer(xp) end,
        getPageXPointer = function(_, page) return native:getPageXPointer(page) end,
        getPageCount = function() return native:getPages() end,
        compareXPointers = function(_, a, b) return native:compareXPointers(a, b) end,
        getDocumentFileContent = function(_, path) return native:getDocumentFileContent(path) end,
        findAllText = function(_, text, insensitive, context, limit, regex)
            calls.searches = calls.searches + 1
            return native:findAllText(text, insensitive, regex, limit, true, context)
        end,
        getSelectedWordContext = function(_, _, _, a, b)
            local before = native:getPrevVisibleWordStart(a) or a
            local after = native:getNextVisibleWordEnd(b) or b
            return native:getTextFromXPointers(before, a, false, false),
                native:getTextFromXPointers(b, after, false, false)
        end,
    }
    assert(Identity.contentHash(document, require("ffi/sha2").sha256) == map.contentHash,
        "API map must be bound to the exact native EPUB content.")
    local prepared = assert(Locations.prepare(document, map, Anchors, {
        cache = boundary_cache, domVersion = cre.getLatestDomVersion(),
    }))
    if arg[4] == "--scale" then
        assert(#map.chapters >= 90, "Use a synthetic book-scale EPUB and its actual API map.")
        local chapter = map.chapters[math.floor(#map.chapters * 0.9)]
        local requested = { version = 1, formatId = map.formatId, contentHash = map.contentHash,
            mapFingerprint = map.fingerprint, href = chapter.href, chapterId = chapter.id,
            chapterProgression = 0.5, resourceProgression = 0.5, basis = "rendered" }
        local current = reading_point or native:getPageXPointer(math.floor(native:getPages() / 2))
        reading_point = current
        local toc, expected = native:getToc(), nil
        assert(#toc == #map.chapters, "The synthetic fixture must have one flat TOC entry per section.")
        for index, entry in ipairs(toc) do
            local order = native:compareXPointers(entry.xpointer, current)
            if order and order >= 0 then expected = map.chapters[index].id end
        end
        assert(expected, "The synthetic native reading point must be inside a known section.")
        local started, longest, slices, attempts = socket.gettime(), 0, 0, 0
        local captured, target
        repeat
            attempts = attempts + 1
            local slice = socket.gettime()
            local worker = coroutine.create(function()
                Locations.resolve(document, prepared, current, requested, {
                    budget = 0.5,
                    checkpoint = function()
                        local elapsed = socket.gettime() - slice
                        if elapsed >= 0.025 then
                            longest = math.max(longest, elapsed)
                            coroutine.yield()
                            slice = socket.gettime()
                        end
                    end,
                })
            end)
            repeat
                local ok, err = coroutine.resume(worker)
                assert(ok, err)
                slices = slices + 1
                longest = math.max(longest, socket.gettime() - slice)
                assert(document:isXPointerInDocument(current), "The UI must be able to access the live reader between slices.")
                if coroutine.status(worker) ~= "dead" then socket.sleep(0.05) end
            until coroutine.status(worker) == "dead"
            captured = Locations.capture(document, prepared, current)
            target = Locations.target(document, prepared, requested)
        until (captured and captured.chapterId and target and target.chapter) or attempts >= 20
        assert(captured and captured.chapterId and target and target.chapter, "Mapping must eventually finish, not fall back forever.")
        assert(captured.chapterId == expected, "The current chapter must agree with the synthetic fixture's native TOC.")
        assert(captured.passage, "Native progress must capture a bounded passage during sync.")
        assert(Locations.capture(document, prepared, target.point).chapterId == requested.chapterId,
            "The remote destination must remain in its requested section.")
        assert(attempts < 20 and longest < 0.25, "Native mapping must remain responsive between bounded calls.")
        assert(calls.searches < 40 and calls.bodies <= 1, "Mapping must not repeatedly scan and export the entire publication.")
        print(string.format("Resolved %d-section map: %.3fs, %d sync passes, %d UI slices, longest %.3fs.",
            #map.chapters, socket.gettime() - started, attempts, slices, longest))
        print(string.format("Native searches: %d; HTML range exports: %d; whole-body exports: %d.",
            calls.searches, calls.ranges, calls.bodies))
        local cached = assert(Locations.prepare(document, map, {
            resolve = function() error("Verified cached boundaries must not be searched again.") end,
            normalize = Anchors.normalize,
        }, { cache = prepared.cache, domVersion = cre.getLatestDomVersion() }))
        assert(Locations.resolve(document, cached, current, requested))
        assert(Locations.capture(document, cached, current).chapterId == captured.chapterId)
        assert(Locations.target(document, cached, requested).chapter)
        local passage_point
        for index, item in ipairs(map.chapters) do
            if item.id == captured.chapterId then passage_point = prepared.chapters[index]; break end
        end
        for _ = 1, 2 do passage_point = assert(document:getNextVisibleChar(passage_point)) end
        assert(Locations.resolve(document, prepared, passage_point, nil, { budget = 2 }))
        local passage_location = assert(Locations.capture(document, prepared, passage_point))
        assert(passage_location.passage)
        local verifier = assert(Locations.prepare(document, map, Anchors, {
            cache = prepared.cache, domVersion = cre.getLatestDomVersion(),
        }))
        for _ = 1, 20 do
            if Locations.resolve(document, verifier, nil, passage_location, { budget = 0.5 }) then break end
        end
        local precise = assert(Locations.target(document, verifier, passage_location))
        assert(precise.passage, "Incoming progress must resolve its literal passage, not a chapter percentage: "
            .. (verifier.warning or precise.label))
        assert(precise.point ~= document:getPageXPointer(document:getPageFromXPointer(precise.point)),
            "Verified passage targets must not be rounded to page starts.")
        assert(Locations.resolve(document, verifier, precise.point, nil, { budget = 2 }))
        local recaptured = assert(Locations.capture(document, verifier, precise.point)).passage
        assert(recaptured and recaptured.exact:sub(1, #passage_location.passage.exact) == passage_location.passage.exact)
        print("Verified same-passage native restoration without page-start rounding.")
        coldProgress(document, current, expected, map)
    else
        if os.getenv("HOMEBRANCH_PROBE_VERBOSE") then
            for _, resource in ipairs(map.resources) do
                local point, reason = Anchors.resolve(document, resource.anchor)
                print("Resource boundary", resource.href, point and point.pos0 or reason)
            end
            print("Normalized fixture text", Anchors.normalize(document:getTextFromXPointer("/body")):sub(1, 220))
        end
        local verified = 0
        for index, chapter in ipairs(map.chapters) do
            if chapter.kind == "chapter" then
                assert(Locations.resolve(document, prepared, nil, {
                    version = 1, formatId = map.formatId, contentHash = map.contentHash,
                    mapFingerprint = map.fingerprint, href = chapter.href, chapterId = chapter.id,
                }, { budget = 2 }))
                local start = assert(prepared.chapters[index], "Unresolved chapter: " .. chapter.id)
                local captured = assert(Locations.capture(document, prepared, start), chapter.id)
                assert(captured.chapterId == chapter.id, "Native boundary selected the wrong chapter.")
                assert(captured.chapterProgression == 0, "A chapter starts at zero progression.")
                for _, progress in ipairs({ 0, 0.5, 1 }) do
                    captured.chapterProgression = progress
                    local target = assert(Locations.target(document, prepared, captured))
                    assert(target.chapter and target.pos >= target.start_pos and target.pos < target.end_pos)
                    native:gotoXPointer(target.point)
                    assert(Locations.capture(document, prepared, target.point).chapterId == chapter.id,
                        "The applied native destination must remain in the exact TOC section.")
                end
                verified = verified + 1
                if arg[4] == "--passages" then
                    local point = start
                    for _ = 1, 2 do point = document:getNextVisibleChar(point) or point end
                    assert(Locations.resolve(document, prepared, point, nil, { budget = 2 }))
                    local location = assert(Locations.capture(document, prepared, point))
                    if location.passage and layout[1] == 600 then
                        passage_samples[#passage_samples + 1] = location
                    end
                end
            end
        end
        local spanning = assert(Locations.capture(document, prepared, assert(prepared.resources[2])))
        assert(spanning.href == "OPS/continued chapter.xhtml")
        assert(spanning.chapterId == "OPS/one.xhtml#long" and spanning.chapterProgression > 0,
            "Crossing a resource boundary must not change the active TOC chapter.")
        assert(verified > 1, "The fixture must exercise multiple chapter boundaries.")
        print(string.format("Verified %d native TOC sections at %dx%d, font %d.",
            verified, layout[1], layout[2], layout[3]))
        if arg[4] == "--web-passages" then
            local input = assert(io.open(assert(arg[5]), "rb"))
            local samples = json.decode(input:read("*a"))
            input:close()
            for _, location in ipairs(samples) do
                assert(Locations.resolve(document, prepared, nil, location, { budget = 2 }))
                local target = assert(Locations.target(document, prepared, location))
                assert(target.passage, "A browser passage must resolve without percentage approximation: "
                    .. (prepared.warning or target.label))
                native:gotoXPointer(target.point)
                assert(Locations.resolve(document, prepared, target.point, nil, { budget = 2 }))
                local captured = assert(Locations.capture(document, prepared, target.point))
                assert(captured.chapterId == location.chapterId and captured.passage)
                assert(location.passage.exact:sub(1, #captured.passage.exact) == captured.passage.exact)
            end
            print(string.format("Verified %d browser passages in actual crengine.", #samples))
        end
    end
    boundary_cache = json.decode(json.encode(prepared.cache))
    native:close()
end
if arg[4] == "--passages" then
    assert(#passage_samples >= 3, "The original fixture must produce interoperable native passages.")
    local output = assert(io.open(assert(arg[5]), "wb"))
    output:write(json.encode(passage_samples))
    output:close()
    print("Exported original native passage samples for the browser proof.")
end
