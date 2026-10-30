local root = (arg[0]:match("^(.*)/") or ".") .. "/../homebranch.koplugin/"
local Locations = dofile(root .. "locations.lua")
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
    return assert(Locations.prepare(doc, value, {
        resolve = function(_, anchor)
            if anchor.exact ~= missing then return { pos0 = anchor.exact } end
        end,
    }))
end

test("chapter identity follows native boundaries across resources, not total percentage", function()
    local doc = document()
    local value = Locations.capture(doc, prepare(doc, map()), "600")
    assert(value.href == "Other/one.xhtml")
    assert(value.chapterId == "Text/one.xhtml#second")
    assert(math.abs(value.chapterProgression - 2 / 3) < 0.00001)
    assert(value.resourceProgression == 0.2 and value.basis == "rendered")
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

print("Passed " .. count .. " portable location tests.")
