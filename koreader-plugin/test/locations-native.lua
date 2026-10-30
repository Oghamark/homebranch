-- Run in an extracted KOReader directory with repository, EPUB and map JSON paths.
require("setupkoenv")
local cre = require("libs/libkoreader-cre")
local json = require("rapidjson")
local socket = require("socket")
local root = arg[1] .. "/koreader-plugin/homebranch.koplugin/"
local Locations = dofile(root .. "locations.lua")
local Anchors = dofile(root .. "anchors.lua")
local Identity = dofile(root .. "identity.lua")
local file = assert(io.open(arg[3], "rb"))
local map = json.decode(file:read("*a"))
file:close()
cre.initCache(arg[2] .. ".location-cache", 8 * 1024 * 1024)
cre.initHyphDict("./data/hyph/")
cre.registerFont("fonts/noto/NotoSerif-Regular.ttf")

local boundary_cache, reading_point
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
        }, { cache = prepared.cache, domVersion = cre.getLatestDomVersion() }))
        assert(Locations.resolve(document, cached, current, requested))
        assert(Locations.capture(document, cached, current).chapterId == captured.chapterId)
        assert(Locations.target(document, cached, requested).chapter)
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
            end
        end
        local spanning = assert(Locations.capture(document, prepared, assert(prepared.resources[2])))
        assert(spanning.href == "OPS/continued chapter.xhtml")
        assert(spanning.chapterId == "OPS/one.xhtml#long" and spanning.chapterProgression > 0,
            "Crossing a resource boundary must not change the active TOC chapter.")
        assert(verified > 1, "The fixture must exercise multiple chapter boundaries.")
        print(string.format("Verified %d native TOC sections at %dx%d, font %d.",
            verified, layout[1], layout[2], layout[3]))
    end
    boundary_cache = json.decode(json.encode(prepared.cache))
    native:close()
end
