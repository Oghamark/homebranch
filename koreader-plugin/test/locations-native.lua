-- Run in an extracted KOReader directory with repository, EPUB and map JSON paths.
require("setupkoenv")
local cre = require("libs/libkoreader-cre")
local json = require("rapidjson")
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

for _, layout in ipairs({ { 600, 800, 18 }, { 320, 640, 26 } }) do
    local native = cre.newDocView(layout[1], layout[2], 1)
    native:setStringProperty("font.face.default", "Noto Serif")
    native:setFontSize(layout[3])
    assert(native:loadDocument(arg[2]), "Fixture failed to load.")
    native:renderDocument()
    local document = {
        info = { doc_height = native:getFullHeight() },
        isXPointerInDocument = function(_, xp) return native:isXPointerInDocument(xp) end,
        getTextFromXPointers = function(_, a, b) return native:getTextFromXPointers(a, b, false, false) end,
        getNextVisibleChar = function(_, xp) return native:getNextVisibleChar(xp) end,
        getTextFromXPointer = function(_, xp) return native:getTextFromXPointer(xp) end,
        getHTMLFromXPointer = function(_, xp, flags) return native:getHTMLFromXPointer(xp, flags) end,
        getHTMLFromXPointers = function(_, a, b, flags, full) return native:getHTMLFromXPointers(a, b, flags, full) end,
        getPosFromXPointer = function(_, xp) return native:getPosFromXPointer(xp) end,
        getPageFromXPointer = function(_, xp) return native:getPageFromXPointer(xp) end,
        getPageXPointer = function(_, page) return native:getPageXPointer(page) end,
        getPageCount = function() return native:getPages() end,
        compareXPointers = function(_, a, b) return native:compareXPointers(a, b) end,
        getDocumentFileContent = function(_, path) return native:getDocumentFileContent(path) end,
        findAllText = function(_, text, insensitive, context, limit, regex)
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
    local prepared = assert(Locations.prepare(document, map, Anchors))
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
    native:close()
end
