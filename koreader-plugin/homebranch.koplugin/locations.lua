local Locations = {}

local function locationDocument(document, anchors)
    if not document.getHTMLFromXPointer or not document.getHTMLFromXPointers then return document end
    local parser = require("htmlparser")
    local util = require("util")
    local blocks = {}
    for tag in ("address article aside blockquote br caption dd details div dl dt fieldset figcaption figure "
        .. "footer form h1 h2 h3 h4 h5 h6 header hr li main nav ol p pre section table tbody td th thead tr ul "
        .. "docfragment"):gmatch("%S+") do blocks[tag] = true end
    local function text(html)
        if type(html) ~= "string" or #html > 4 * 1024 * 1024 then return "" end
        local tags = 0
        for _ in html:gmatch("<[%w%-]+[%s/>]") do tags = tags + 1 end
        if tags > 16384 then return "" end
        local tree = parser.parse(html, tags + 8)
        local pieces = {}
        local function visit(node, depth)
            if depth > 128 then return false end
            local tag = node.name:lower()
            local attrs = node.attributes
            local style = (attrs.style or ""):lower()
            if tag == "script" or tag == "style" or tag == "noscript" or tag == "template"
                or attrs.hidden ~= nil or attrs["aria-hidden"] == "true"
                or style:match("display%s*:%s*none") or style:match("visibility%s*:%s*hidden") then return true end
            local first = tag == "root" and 1 or node._openend + 1
            local last = tag == "root" and #html + 1 or node._closestart
            if blocks[tag] then pieces[#pieces + 1] = " " end
            for _, child in ipairs(node.nodes) do
                pieces[#pieces + 1] = html:sub(first, child._openstart - 1)
                if not visit(child, depth + 1) then return false end
                first = child._closeend + 1
            end
            if first < last then pieces[#pieces + 1] = html:sub(first, last - 1) end
            if blocks[tag] then pieces[#pieces + 1] = " " end
            return true
        end
        if not visit(tree, 0) then return "" end
        local value = util.htmlEntitiesToUtf8(table.concat(pieces))
        for _, space in ipairs({ "\194\160", "\225\154\128", "\226\128\168", "\226\128\169",
            "\226\128\175", "\226\129\159", "\227\128\128", "\239\187\191" }) do
            value = value:gsub(space, " ")
        end
        for byte = 128, 138 do value = value:gsub("\226\128" .. string.char(byte), " ") end
        return anchors.normalize(value)
    end
    -- crengine's plain text joins adjacent blocks. Its public HTML range
    -- preserves the boundaries needed by the shared publication text model.
    return setmetatable({
        getTextFromXPointer = function(_, point) return text(document:getHTMLFromXPointer(point, 0)) end,
        getTextFromXPointers = function(_, first, last)
            return text(document:getHTMLFromXPointers(first, last, 0, true))
        end,
    }, { __index = function(_, key)
        local value = document[key]
        if type(value) ~= "function" then return value end
        return function(_, ...) return value(document, ...) end
    end })
end

local function fraction(value)
    return type(value) == "number" and value == value and value >= 0 and value <= 1
end

local function clamp(value)
    return math.max(0, math.min(1, value))
end

function Locations.compatible(prepared, location)
    local map = prepared and prepared.map
    return type(location) == "table" and map and location.version == 1
        and location.formatId == map.formatId and location.contentHash == map.contentHash
        and location.mapFingerprint == map.fingerprint
end

local function height(document)
    local value = document.info and document.info.doc_height
    return type(value) == "number" and value > 0 and value < math.huge and value or nil
end

function Locations.prepare(document, map, anchors)
    if type(map) ~= "table" or map.version ~= 1 or type(map.resources) ~= "table"
        or type(map.chapters) ~= "table" or #map.resources > 4096 or #map.chapters > 4096
        or type(map.formatId) ~= "string" or type(map.contentHash) ~= "string"
        or type(map.fingerprint) ~= "string" then
        return nil, "Invalid EPUB location map."
    end
    local prepared = { map = map, resources = {}, chapters = {} }
    local source = locationDocument(document, anchors)
    local body, work, resolved = nil, 0, {}
    local cached_document = setmetatable({
        getTextFromXPointer = function(_, pointer)
            if pointer ~= "/body" then return source:getTextFromXPointer(pointer) end
            if body == nil then body = source:getTextFromXPointer(pointer) or false end
            return body or nil
        end,
    }, { __index = function(_, key)
        local value = source[key]
        if type(value) ~= "function" then return value end
        return function(_, ...) return value(source, ...) end
    end })
    local function resolve(items, target, chapters)
        for index, item in ipairs(items) do
            if type(item) ~= "table" or type(item.href) ~= "string"
                or type(item.start) ~= "number" or type(item["end"]) ~= "number"
                or item.start % 1 ~= 0 or item["end"] % 1 ~= 0
                or item.start < 0 or item["end"] < item.start or item["end"] > 64 * 1024 * 1024
                or (chapters and (type(item.id) ~= "string" or type(item.title) ~= "string"
                    or (item.kind ~= "chapter" and item.kind ~= "resource"))) then
                return nil, "Invalid EPUB section boundaries."
            end
            if type(item.anchor) == "table" and type(item.anchor.exact) == "string" then
                local key = item.anchor.exact .. "\0" .. (item.anchor.prefix or "") .. "\0" .. (item.anchor.suffix or "")
                local point = resolved[key]
                if point == nil then
                    if work >= 128 * 1024 * 1024 then
                        prepared.warning = "Chapter mapping reached its safe work limit; unresolved sections use approximate fallback."
                        point = false
                    else
                        local position = anchors.resolve(cached_document, item.anchor)
                        point = position and position.pos0 or false
                        work = work + (type(body) == "string" and #body or #item.anchor.exact)
                    end
                    resolved[key] = point
                end
                if point then target[index] = point end
            end
        end
        return true
    end
    local ok, err = resolve(map.resources, prepared.resources)
    if not ok then return nil, err end
    ok, err = resolve(map.chapters, prepared.chapters, true)
    if not ok then return nil, err end
    return prepared
end

local function range(document, items, pointers, index)
    local first = pointers[index]
    if not first or not document:isXPointerInDocument(first) then return nil end
    local ending = pointers[index + 1]
    if index < #items and (not ending or not document:isXPointerInDocument(ending)) then return nil end
    local start_pos = document:getPosFromXPointer(first)
    local end_pos = ending and document:getPosFromXPointer(ending) or height(document)
    if type(start_pos) ~= "number" or type(end_pos) ~= "number" or start_pos < 0
        or start_pos ~= start_pos or end_pos < start_pos or end_pos >= math.huge or end_pos ~= end_pos then return nil end
    return { first = first, ending = ending, start_pos = start_pos, end_pos = end_pos }
end

local function containing(document, items, pointers, point)
    for index, item in ipairs(items) do
        local bounds = range(document, items, pointers, index)
        if bounds then
            local after_start = document:compareXPointers(bounds.first, point)
            local before_end = bounds.ending and document:compareXPointers(bounds.ending, point)
            if after_start and after_start >= 0 and (not bounds.ending or (before_end and before_end < 0)) then
                return item, bounds
            end
        end
    end
end

local function progression(document, point, bounds)
    local value = document:getPosFromXPointer(point)
    if type(value) ~= "number" or value < 0 or value >= math.huge or value ~= value then return nil end
    return bounds.end_pos > bounds.start_pos
        and clamp((value - bounds.start_pos) / (bounds.end_pos - bounds.start_pos)) or 0
end

local function destination(document, bounds, pos)
    -- Page percentages and document-height fractions differ. Choose a verified
    -- in-section pointer so pagination cannot select an adjacent chapter.
    if not document.getPageXPointer or not document.getPageFromXPointer or not document.getPageCount then
        return bounds.first
    end
    local low = document:getPageFromXPointer(bounds.first)
    local high = bounds.ending and document:getPageFromXPointer(bounds.ending) or document:getPageCount()
    if type(low) ~= "number" or type(high) ~= "number" or low < 1 or high < low or high > 1000000 then
        return bounds.first
    end
    local point = bounds.first
    while low <= high do
        local page = math.floor((low + high) / 2)
        local candidate = document:getPageXPointer(page)
        if not candidate or not document:isXPointerInDocument(candidate) then break end
        local y = document:getPosFromXPointer(candidate)
        if type(y) ~= "number" or y ~= y then break end
        if y > pos then high = page - 1
        else
            local after_start = document:compareXPointers(bounds.first, candidate)
            local before_end = bounds.ending and document:compareXPointers(bounds.ending, candidate)
            if after_start and after_start >= 0 and (not bounds.ending or (before_end and before_end < 0)) then
                point = candidate
            end
            low = page + 1
        end
    end
    return point
end

function Locations.capture(document, prepared, point)
    if not prepared or not document:isXPointerInDocument(point) then return nil end
    local map = prepared.map
    local resource, resource_bounds = containing(document, map.resources, prepared.resources, point)
    if not resource then return nil end
    local resource_progression = progression(document, point, resource_bounds)
    if not resource_progression then return nil end
    local result = {
        version = 1, formatId = map.formatId, contentHash = map.contentHash,
        mapFingerprint = map.fingerprint, href = resource.href,
        resourceProgression = resource_progression, basis = "rendered",
    }
    local chapter, chapter_bounds = containing(document, map.chapters, prepared.chapters, point)
    if chapter and chapter.kind == "chapter" then
        result.chapterId = chapter.id
        result.chapterProgression = progression(document, point, chapter_bounds)
    end
    return result
end

function Locations.target(document, prepared, location)
    if type(location) ~= "table" or location.version ~= 1
        or not fraction(location.resourceProgression)
        or (location.basis ~= "text" and location.basis ~= "rendered")
        or ((location.chapterId == nil) ~= (location.chapterProgression == nil))
        or (location.chapterProgression ~= nil and not fraction(location.chapterProgression)) then
        return nil, "Invalid portable EPUB location."
    end
    local map = prepared and prepared.map
    if not Locations.compatible(prepared, location) then
        return nil, "The saved chapter belongs to an unverified edition or chapter map."
    end
    local resource
    for _, item in ipairs(map.resources) do
        if item.href == location.href then resource = item; break end
    end
    if not resource then return nil, "The saved EPUB resource is not in this edition." end
    local items, pointers, key, value = map.resources, prepared.resources, location.href, location.resourceProgression
    if location.chapterId then
        items, pointers, key, value = map.chapters, prepared.chapters, location.chapterId, location.chapterProgression
    end
    for index, item in ipairs(items) do
        if (location.chapterId and item.id == key) or (not location.chapterId and item.href == key) then
            if item["end"] <= resource.start or item.start >= resource["end"] then
                return nil, "The saved resource does not belong to this chapter."
            end
            local bounds = range(document, items, pointers, index)
            if not bounds then
                if location.chapterId then
                    local fallback = {}
                    for name, field in pairs(location) do fallback[name] = field end
                    fallback.chapterId, fallback.chapterProgression = nil, nil
                    return Locations.target(document, prepared, fallback)
                end
                return nil, "The resource boundary could not be resolved without guessing."
            end
            local pos = bounds.start_pos + value * (bounds.end_pos - bounds.start_pos)
            pos = math.max(bounds.start_pos, math.min(pos, math.max(bounds.start_pos, bounds.end_pos - 1)))
            local point = destination(document, bounds, pos)
            local is_chapter = location.chapterId ~= nil and item.kind == "chapter"
            local label = is_chapter and (item.title .. ", approximately "
                .. math.floor(value * 100 + 0.5) .. "% through chapter")
                or ("EPUB resource " .. item.href .. ", approximately " .. math.floor(value * 100 + 0.5) .. "%")
            local target_progression = value
            if bounds.end_pos == bounds.start_pos then
                target_progression = 0
                label = (is_chapter and item.title or ("EPUB resource " .. item.href))
                    .. " (start; no measurable layout extent for an in-section estimate)"
            end
            if is_chapter and document.getPageFromXPointer and document.getPageCount then
                local first_page = document:getPageFromXPointer(bounds.first)
                local last_page = bounds.ending and document:getPageFromXPointer(bounds.ending) or document:getPageCount()
                if type(first_page) == "number" and type(last_page) == "number" and last_page >= first_page then
                    local pages = last_page - first_page + 1
                    local target_page = document:getPageFromXPointer(point)
                    if type(target_page) == "number" then
                        label = label .. string.format(" (about page %d of %d in this chapter on this device)",
                            math.max(1, math.min(pages, target_page - first_page + 1)), pages)
                    end
                end
            end
            return { pos = pos, point = point, first = bounds.first, progression = target_progression, label = label,
                chapter = is_chapter, start_pos = bounds.start_pos, end_pos = bounds.end_pos }
        end
    end
    return nil, "The saved chapter could not be verified."
end

return Locations
