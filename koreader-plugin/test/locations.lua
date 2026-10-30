local root = (arg[0]:match("^(.*)/") or ".") .. "/../homebranch.koplugin/"
local Locations = dofile(root .. "locations.lua")
package.loaded["socket"] = { gettime = os.clock }
local count = 0
local function test(name, run)
    run()
    count = count + 1
    print("ok " .. count .. " - " .. name)
end
local function document()
    return {
        info = { doc_height = 1000 },
        isXPointerInDocument = function(_, point) return tonumber(point) ~= nil end,
        getPosFromXPointer = function(_, point) return tonumber(point) end,
        compareXPointers = function(_, first, second)
            local difference = tonumber(second) - tonumber(first)
            return difference > 0 and 1 or (difference < 0 and -1 or 0)
        end,
        getPageFromXPointer = function(_, point) return math.floor(tonumber(point) / 50) + 1 end,
        getPageXPointer = function(_, page) return tostring((page - 1) * 50) end,
        getPageCount = function() return 20 end,
    }
end
local function map()
    local function item(id, href, start, ending, pointer)
        return { id = id, title = "Same title", href = href, kind = "chapter",
            start = start, ["end"] = ending, anchor = { exact = pointer } }
    end
    return {
        version = 1, formatId = "format", contentHash = "contents", fingerprint = "map",
        resources = {
            item("one", "Text/one.xhtml", 0, 400, "0"),
            item("two", "Other/one.xhtml", 401, 1000, "500"),
        },
        chapters = {
            item("Text/one.xhtml#first", "Text/one.xhtml", 0, 200, "0"),
            item("Text/one.xhtml#second", "Text/one.xhtml", 200, 700, "200"),
            item("Other/one.xhtml#last", "Other/one.xhtml", 700, 1000, "800"),
        },
    }
end
local function prepare(doc, value, missing)
    local prepared = assert(Locations.prepare(doc, value, {
        resolve = function(_, anchor)
            if anchor.exact ~= missing then return { pos0 = anchor.exact } end
        end,
    }))
    for _, chapter in ipairs(value.chapters) do
        assert(Locations.resolve(doc, prepared, nil, {
            version = 1, formatId = value.formatId, contentHash = value.contentHash,
            mapFingerprint = value.fingerprint, href = chapter.href, chapterId = chapter.id,
        }))
    end
    return prepared
end

local function passageDocument(positions, large)
    local doc, value = document(), map()
    value.capabilities = { passageAnchor = 1 }
    if large then
        value.resources = { value.resources[1] }
        value.chapters = { value.chapters[1] }
        value.resources[1]["end"], value.chapters[1]["end"] = 70000, 70000
    end
    local exact = "A distinctive saved passage."
    local text = string.rep("x", 1000)
    for index, offset in ipairs(positions) do
        local context = "marker-" .. index .. " "
        text = text:sub(1, offset - #context) .. context .. text:sub(offset + 1)
        text = text:sub(1, offset) .. exact .. text:sub(offset + #exact + 1)
    end
    local searches, exports = 0, 0
    doc.getNextVisibleChar = function(_, point)
        if tonumber(point) < #text then return tostring(tonumber(point) + 1) end
    end
    doc.getPrevVisibleChar = function(_, point)
        if tonumber(point) > 0 then return tostring(tonumber(point) - 1) end
    end
    doc.getTextFromXPointers = function(_, first, last)
        exports = exports + 1
        return text:sub(tonumber(first) + 1, tonumber(last))
    end
    doc.getTextFromXPointer = function() error("Passage matching must not export the whole publication.") end
    doc.getSelectedWordContext = function(_, _, _, first, last)
        return text:sub(math.max(1, tonumber(first) - 63), tonumber(first)),
            text:sub(tonumber(last) + 1, tonumber(last) + 64)
    end
    doc.findAllText = function(_, pattern)
        searches = searches + 1
        local hits, offset = {}, 1
        while true do
            local at = text:find(pattern, offset, true)
            if not at then return hits end
            hits[#hits + 1] = { start = tostring(at - 1), ["end"] = tostring(at + #pattern - 1) }
            offset = at + 1
        end
    end
    local real = dofile(root .. "anchors.lua")
    local prepared = assert(Locations.prepare(doc, value, {
        normalize = real.normalize,
        resolve = function(source, anchor, options)
            if tonumber(anchor.exact) then return { pos0 = anchor.exact } end
            return real.resolve(source, anchor, options)
        end,
    }))
    assert(Locations.resolve(doc, prepared, "253"))
    local location = assert(Locations.capture(doc, prepared, "253"))
    location.passage = { version = 1, exact = exact }
    return doc, prepared, location, function() return searches, exports end
end

test("passage candidates and duplicate proof stay inside the chapter/resource intersection", function()
    local doc, prepared, location, calls = passageDocument({ 253, 650 })
    assert(Locations.resolve(doc, prepared, nil, location))
    local target = assert(Locations.target(doc, prepared, location))
    assert(target.passage and target.point == "253" and target.chapter)
    local searches, exports = calls()
    assert(Locations.resolve(doc, prepared, nil, location))
    assert(Locations.capture(doc, prepared, "253").passage)
    local cached_searches, cached_exports = calls()
    assert(cached_searches == searches and cached_exports == exports,
        "Page capture and repeated resolution must use the existing bounded caches.")
end)

test("ambiguous or missing passages retain an explicitly approximate chapter fallback", function()
    for _, positions in ipairs({ { 253, 353 }, { 650 } }) do
        local doc, prepared, location = passageDocument(positions)
        assert(Locations.resolve(doc, prepared, nil, location))
        local target = assert(Locations.target(doc, prepared, location))
        assert(not target.passage and target.chapter and target.label:find("Passage could not be verified", 1, true))
    end
end)

test("bounded context disambiguates repeated passages within the verified scope", function()
    local doc, prepared, location = passageDocument({ 253, 353 })
    location.passage.prefix = "marker-1"
    assert(Locations.resolve(doc, prepared, nil, location))
    local target = assert(Locations.target(doc, prepared, location))
    assert(target.passage and target.point == "253")
end)

test("over-limit scopes and truncated native candidates cannot claim passage precision", function()
    local doc, prepared, location, calls = passageDocument({ 253 }, true)
    assert(Locations.resolve(doc, prepared, nil, location))
    assert(not Locations.target(doc, prepared, location).passage)
    assert(calls() == 0 and prepared.warning:find("safe text limit", 1, true))
    doc, prepared, location = passageDocument({ 253 })
    doc.findAllText = function()
        local hits = {}
        for index = 1, 257 do hits[index] = { start = "253", ["end"] = "280" } end
        return hits
    end
    assert(Locations.resolve(doc, prepared, nil, location))
    assert(not Locations.target(doc, prepared, location).passage)
    assert(prepared.warning:find("Too many", 1, true))
end)

test("a resumed request cannot reuse a different passage in the same chapter", function()
    local doc, prepared, location = passageDocument({ 253 })
    local clock = 0
    local function now() clock = clock + 0.001; return clock end
    assert(not Locations.resolve(doc, prepared, nil, location, { now = now, budget = 0.008 }))
    assert(prepared.pending_resolution)
    local changed = {}
    for key, value in pairs(location) do changed[key] = value end
    changed.passage = { version = 1, exact = "A different missing passage." }
    assert(Locations.resolve(doc, prepared, nil, changed))
    assert(not Locations.target(doc, prepared, changed).passage)
    assert(Locations.resolve(doc, prepared, nil, location))
    assert(Locations.target(doc, prepared, location).passage)
end)

test("invalid passage limits and unrelated chapter scopes never become verified jumps", function()
    local doc, prepared, location = passageDocument({ 253 })
    location.chapterId = "Other/one.xhtml#last"
    assert(Locations.resolve(doc, prepared, nil, location))
    assert(not Locations.target(doc, prepared, location))
    location.chapterId = "Text/one.xhtml#second"
    for _, exact in ipairs({ string.rep("a", 257), "control\0text", "short" }) do
        location.passage = { version = 1, exact = exact }
        assert(not Locations.target(doc, prepared, location))
    end
end)

test("chapter identity follows native boundaries across resources, not total percentage", function()
    local doc = document()
    local prepared = prepare(doc, map())
    assert(prepared.has_chapters)
    local value = Locations.capture(doc, prepared, "600")
    assert(value.href == "Other/one.xhtml")
    assert(value.chapterId == "Text/one.xhtml#second")
    assert(math.abs(value.chapterProgression - 2 / 3) < 0.00001)
    assert(value.resourceProgression == 0.2 and value.basis == "rendered")
end)

test("failed boundary verification retains a text-free reason for approximate fallback", function()
    local doc = document()
    local prepared = assert(Locations.prepare(doc, map(), {
        resolve = function() return nil, "Passage is ambiguous." end,
    }))
    assert(Locations.resolve(doc, prepared, "600"))
    assert(prepared.resolved_point == "600" and not prepared.pending_resolution)
    assert(prepared.warning:find("Passage is ambiguous", 1, true))
    assert(Locations.capture(doc, prepared, "600") == nil)
end)

test("two sections in the same resource remain distinct despite duplicate titles", function()
    local doc, value = document(), map()
    local prepared = prepare(doc, value)
    assert(Locations.capture(doc, prepared, "199").chapterId == value.chapters[1].id)
    assert(Locations.capture(doc, prepared, "200").chapterId == value.chapters[2].id)
end)

test("a chapter jump stays inside its exclusive endpoint", function()
    local doc, value = document(), map()
    local prepared = prepare(doc, value)
    local location = Locations.capture(doc, prepared, "600")
    location.chapterProgression = 1
    local target = assert(Locations.target(doc, prepared, location))
    assert(target.pos == 799 and target.pos < 800 and target.chapter)
    assert(Locations.capture(doc, prepared, target.point).chapterId == location.chapterId)
    assert(target.label:find("100%% through chapter") and target.label:find("on this device"))
end)

test("a shared page cannot round a chapter jump into the preceding section", function()
    local doc, pages = document(), { 0, 100, 500, 700, 850, 950 }
    doc.getPageCount = function() return #pages end
    doc.getPageXPointer = function(_, page) return tostring(pages[page]) end
    doc.getPageFromXPointer = function(_, point)
        local page = 1
        for index, position in ipairs(pages) do
            if position <= tonumber(point) then page = index end
        end
        return page
    end
    local prepared = prepare(doc, map())
    local location = Locations.capture(doc, prepared, "600")
    location.chapterProgression = 0.1
    local target = assert(Locations.target(doc, prepared, location))
    assert(target.point == "200")
    assert(Locations.capture(doc, prepared, target.point).chapterId == location.chapterId)
end)

test("an unresolved section uses a labeled resource fallback, never another chapter", function()
    local doc, value = document(), map()
    local location = Locations.capture(doc, prepare(doc, value), "600")
    local prepared = prepare(doc, value, "200")
    assert(Locations.capture(doc, prepared, "600").chapterId == nil)
    local target = assert(Locations.target(doc, prepared, location))
    assert(not target.chapter and target.label:find("EPUB resource"))
end)

test("old editions and changed maps cannot resolve even when basenames match", function()
    local doc = document()
    local prepared = prepare(doc, map())
    local location = Locations.capture(doc, prepared, "600")
    location.mapFingerprint = "old-map"
    assert(not Locations.target(doc, prepared, location))
    location.mapFingerprint, location.formatId = "map", "different-edition"
    assert(not Locations.target(doc, prepared, location))
end)

test("invalid fractions, incomplete chapter fields and unrelated resources are rejected", function()
    local doc = document()
    local prepared = prepare(doc, map())
    for _, bad in ipairs({ -1, 2, math.huge }) do
        local location = Locations.capture(doc, prepared, "600")
        location.chapterProgression = bad
        assert(not Locations.target(doc, prepared, location))
    end
    local location = Locations.capture(doc, prepared, "600")
    location.chapterProgression = nil
    assert(not Locations.target(doc, prepared, location))
    location = Locations.capture(doc, prepared, "850")
    location.href = "Text/one.xhtml"
    assert(not Locations.target(doc, prepared, location))
end)

test("missing resource boundaries do not become basename guesses", function()
    local doc = document()
    assert(Locations.capture(doc, prepare(doc, map(), "500"), "600") == nil)
end)

test("sections sharing a layout coordinate use their verified start instead of crossing a boundary", function()
    local doc = document()
    doc.getPosFromXPointer = function(_, point)
        return point == "200" and 0 or tonumber(point)
    end
    local prepared = prepare(doc, map())
    local location = Locations.capture(doc, prepared, "0")
    location.chapterProgression = 0.5
    local target = assert(Locations.target(doc, prepared, location))
    assert(target.first == "0" and target.progression == 0)
    assert(target.label:find("no measurable layout extent"))
end)

test("large maps resolve only requested boundaries and page capture never starts a search", function()
    local doc, value, searches = document(), map(), 0
    value.chapters = {}
    for index = 1, 200 do
        value.chapters[index] = {
            id = "section-" .. index, title = "Section", kind = "chapter",
            href = index <= 80 and "Text/one.xhtml" or "Other/one.xhtml",
            start = (index - 1) * 5, ["end"] = index * 5, anchor = { exact = tostring((index - 1) * 5) },
        }
    end
    local prepared = assert(Locations.prepare(doc, value, {
        resolve = function(_, anchor)
            searches = searches + 1
            return { pos0 = anchor.exact }
        end,
    }))
    assert(searches == 0 and not Locations.capture(doc, prepared, "600"))
    local incoming = {
        version = 1, formatId = value.formatId, contentHash = value.contentHash, mapFingerprint = value.fingerprint,
        href = "Other/one.xhtml", chapterId = "section-190", chapterProgression = 0.5,
        resourceProgression = 0.5, basis = "rendered",
    }
    assert(Locations.resolve(doc, prepared, "600", incoming))
    assert(searches < 20)
    local count_before_capture = searches
    assert(Locations.capture(doc, prepared, "600").chapterId == "section-121")
    assert(Locations.target(doc, prepared, incoming).chapter)
    assert(not Locations.capture(doc, prepared, "10").chapterId)
    assert(searches == count_before_capture)
    for _, chapter in ipairs(value.chapters) do
        incoming.href, incoming.chapterId = chapter.href, chapter.id
        assert(Locations.resolve(doc, prepared, nil, incoming))
    end
    local comparisons, positions = 0, 0
    local compare, position = doc.compareXPointers, doc.getPosFromXPointer
    doc.compareXPointers = function(...)
        comparisons = comparisons + 1
        return compare(...)
    end
    doc.getPosFromXPointer = function(...)
        positions = positions + 1
        return position(...)
    end
    count_before_capture = searches
    assert(Locations.capture(doc, prepared, "600").chapterId == "section-121")
    assert(searches == count_before_capture and comparisons < 20 and positions <= 6)
end)

test("a deadline pauses inside one anchor and later syncs resume its unfinished work", function()
    local doc, value, clock, searches = document(), map(), 0, 0
    local prepared = assert(Locations.prepare(doc, value, {
        resolve = function(_, anchor, options)
            searches = searches + 1
            for _ = 1, 150 do
                clock = clock + 0.001
                options.checkpoint()
            end
            return { pos0 = anchor.exact }
        end,
    }))
    local options = { now = function() return clock end, budget = 0.05 }
    local ok, warning = Locations.resolve(doc, prepared, "600", nil, options)
    assert(not ok and warning:find("time limit") and searches == 1 and clock < 0.06)
    assert(next(prepared.resources) == nil and next(prepared.cache.resources) == nil)
    for _ = 1, 20 do
        if Locations.resolve(doc, prepared, "600", nil, options) then break end
    end
    assert(Locations.capture(doc, prepared, "600").chapterId == value.chapters[2].id)
    assert(prepared.warning == nil and searches == 4 and not prepared.pending_resolution)
end)

test("verified pointer caches survive reopening but never cross map, edition or DOM changes", function()
    local doc, value, searches = document(), map(), 0
    local anchors = { resolve = function(_, anchor)
        searches = searches + 1
        return { pos0 = anchor.exact }
    end }
    local prepared = assert(Locations.prepare(doc, value, anchors, { domVersion = 20240114 }))
    assert(Locations.resolve(doc, prepared, "600"))
    local cache, previous = prepared.cache, searches
    local reopened = assert(Locations.prepare(doc, value, anchors, { cache = cache, domVersion = 20240114 }))
    assert(Locations.resolve(doc, reopened, "600"))
    assert(searches == previous and Locations.capture(doc, reopened, "600").chapterId == value.chapters[2].id)
    doc.getPosFromXPointer = function(_, point) return tonumber(point) * 2 end
    doc.info.doc_height = 2000
    local captured = Locations.capture(doc, reopened, "600")
    assert(Locations.target(doc, reopened, captured).start_pos == 400)
    for _, field in ipairs({ "fingerprint", "contentHash", "formatId", "domVersion" }) do
        local changed = map()
        if field ~= "domVersion" then changed[field] = "changed" end
        local other = assert(Locations.prepare(doc, changed, anchors,
            { cache = cache, domVersion = field == "domVersion" and 20200101 or 20240114 }))
        previous = searches
        assert(Locations.resolve(doc, other, "600"))
        assert(searches > previous and other.cache ~= cache)
    end
    cache.resources["Text/one.xhtml"] = "invalid-pointer"
    local invalid = assert(Locations.prepare(doc, value, anchors, { cache = cache, domVersion = 20240114 }))
    previous = searches
    assert(Locations.resolve(doc, invalid, "600"))
    assert(searches > previous and invalid.cache.resources["Text/one.xhtml"] == "0")
end)

test("cancellation is propagated rather than disguised as an approximate success", function()
    local doc, value, cancelled = document(), map(), {}
    local prepared = assert(Locations.prepare(doc, value, { resolve = function() error("Unexpected search") end }))
    local ok, err = pcall(Locations.resolve, doc, prepared, "600", nil, {
        checkpoint = function() error(cancelled, 0) end,
    })
    assert(not ok and err == cancelled and next(prepared.cache.resources) == nil)
end)

test("resuming an older scan also resolves the newly requested reading point", function()
    local doc, value, clock = document(), map(), 0
    local prepared = assert(Locations.prepare(doc, value, {
        resolve = function(_, anchor, options)
            for _ = 1, 10 do clock = clock + 0.001; options.checkpoint() end
            return { pos0 = anchor.exact }
        end,
    }))
    assert(not Locations.resolve(doc, prepared, "100", nil, { now = function() return clock end, budget = 0.015 }))
    assert(prepared.pending_resolution and prepared.pending_resolution.point == "100")
    assert(Locations.resolve(doc, prepared, "850", nil, { now = function() return clock end, budget = 1 }))
    assert(Locations.capture(doc, prepared, "850").chapterId == value.chapters[3].id)
    assert(not prepared.pending_resolution)
end)

test("publications exceeding duplicate-check capacity fall back before an expensive native scan", function()
    local doc, value = document(), map()
    value.resources[2]["end"], value.chapters[3]["end"] = 5 * 1024 * 1024, 5 * 1024 * 1024
    local prepared = assert(Locations.prepare(doc, value, {
        resolve = function() error("Oversized publications must not start native passage searches.") end,
    }))
    assert(Locations.resolve(doc, prepared, "600"))
    assert(prepared.warning:find("duplicate%-check limit") and not Locations.capture(doc, prepared, "600"))
end)

print("Passed " .. count .. " portable location tests.")
