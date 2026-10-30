local Locations = {}
local passageScope

local function units(text)
    local count = 0
    for byte in text:gmatch("[^\128-\191]") do count = count + (byte:byte() >= 240 and 2 or 1) end
    return count
end

local function passageKey(location)
    local anchor = location and location.passage
    local function valid(value, limit, minimum)
        return type(value) == "string" and #value <= limit * 4
            and not value:find("[%z\1-\31]") and units(value) <= limit
            and units(value:match("^%s*(.-)%s*$")) >= minimum
    end
    if type(anchor) ~= "table" or type(location.href) ~= "string"
        or anchor.version ~= 1 or not valid(anchor.exact, 256, 8)
        or (anchor.prefix ~= nil and not valid(anchor.prefix, 64, 1))
        or (anchor.suffix ~= nil and not valid(anchor.suffix, 64, 1)) then return nil end
    return location.href .. "\0" .. (location.chapterId or "") .. "\0"
        .. anchor.exact .. "\0" .. (anchor.prefix or "") .. "\0" .. (anchor.suffix or "")
end

local function locationDocument(document, anchors, checkpoint, limited)
    if not document.getHTMLFromXPointer or not document.getHTMLFromXPointers then return document end
    local parser = require("htmlparser")
    local util = require("util")
    local blocks = {}
    for tag in ("address article aside blockquote br caption dd details div dl dt fieldset figcaption figure "
        .. "footer form h1 h2 h3 h4 h5 h6 header hr li main nav ol p pre section table tbody td th thead tr ul "
        .. "docfragment"):gmatch("%S+") do blocks[tag] = true end
    local function text(html)
        checkpoint()
        if type(html) ~= "string" or #html > (limited and 256 * 1024 or 4 * 1024 * 1024) then return "" end
        local tags = 0
        for _ in html:gmatch("<[%w%-]+[%s/>]") do
            tags = tags + 1
            if tags % 128 == 0 then checkpoint() end
            if tags > (limited and 2048 or 16384) then return "" end
        end
        local tree = parser.parse(html, tags + 8)
        checkpoint()
        local pieces = {}
        local function visit(node, depth)
            checkpoint()
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
            checkpoint()
            value = value:gsub(space, " ")
        end
        for byte = 128, 138 do
            checkpoint()
            value = value:gsub("\226\128" .. string.char(byte), " ")
        end
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

function Locations.prepare(document, map, anchors, options)
    if type(map) ~= "table" or map.version ~= 1 or type(map.resources) ~= "table"
        or type(map.chapters) ~= "table" or #map.resources > 4096 or #map.chapters > 4096
        or type(map.formatId) ~= "string" or type(map.contentHash) ~= "string"
        or type(map.fingerprint) ~= "string" then
        return nil, "Invalid EPUB location map."
    end
    options = options or {}
    local cache = options.cache
    if type(cache) ~= "table" or cache.version ~= 1 or cache.formatId ~= map.formatId
        or cache.contentHash ~= map.contentHash or cache.mapFingerprint ~= map.fingerprint
        or type(options.domVersion) ~= "number" or options.domVersion <= 0
        or options.domVersion % 1 ~= 0 or cache.domVersion ~= options.domVersion
        or type(cache.resources) ~= "table" or type(cache.chapters) ~= "table" then
        cache = { version = 1, formatId = map.formatId, contentHash = map.contentHash,
            mapFingerprint = map.fingerprint, domVersion = options.domVersion, resources = {}, chapters = {} }
    end
    local prepared = { document = document, map = map, resources = {}, chapters = {}, cache = cache,
        resource_indices = {}, chapter_indices = {} }
    local active_checkpoint = function() end
    local function checkpoint() active_checkpoint() end
    local source = locationDocument(document, anchors, checkpoint)
    local passage_source = locationDocument(document, anchors, checkpoint, true)
    local body, resolved = nil, {}
    local cached_document = setmetatable({
        getTextFromXPointer = function(_, pointer)
            if pointer ~= "/body" then return source:getTextFromXPointer(pointer) end
            checkpoint()
            if body == nil then body = source:getTextFromXPointer(pointer) or false end
            return body or nil
        end,
    }, { __index = function(_, key)
        local value = source[key]
        if type(value) ~= "function" then return value end
        return function(_, ...) return value(source, ...) end
    end })
    local function validate(items, chapters)
        for index, item in ipairs(items) do
            if type(item) ~= "table" or type(item.href) ~= "string"
                or type(item.start) ~= "number" or type(item["end"]) ~= "number"
                or item.start % 1 ~= 0 or item["end"] % 1 ~= 0
                or item.start < 0 or item["end"] < item.start or item["end"] > 64 * 1024 * 1024
                or (index > 1 and items[index - 1]["end"] > item.start)
                or (chapters and (type(item.id) ~= "string" or type(item.title) ~= "string"
                    or (item.kind ~= "chapter" and item.kind ~= "resource"))) then
                return nil, "Invalid EPUB section boundaries."
            end
            if chapters and item.kind == "chapter" then prepared.has_chapters = true end
        end
        return true
    end
    local ok, err = validate(map.resources)
    if not ok then return nil, err end
    ok, err = validate(map.chapters, true)
    if not ok then return nil, err end
    local last = map.resources[#map.resources]
    if last and last["end"] > 4 * 1024 * 1024 then
        prepared.limit_warning = "The publication exceeds the safe duplicate-check limit; unresolved sections use approximate fallback."
        prepared.warning = prepared.limit_warning
    end

    local function resolve(items, pointers, saved, index, chapters)
        checkpoint()
        local item = items[index]
        if not item or pointers[index] ~= nil then return pointers[index] end
        local function remember(point)
            pointers[index] = point
            if point then
                local indices = chapters and prepared.chapter_indices or prepared.resource_indices
                local low, high = 1, #indices
                while low <= high do
                    local middle = math.floor((low + high) / 2)
                    if indices[middle] < index then low = middle + 1 else high = middle - 1 end
                end
                table.insert(indices, low, index)
                saved[chapters and item.id or item.href] = point
            end
            return point
        end
        local key = chapters and item.id or item.href
        local point = saved[key]
        if type(point) == "string" and #point <= 4096 and document:isXPointerInDocument(point) then
            return remember(point)
        end
        saved[key] = nil
        if prepared.limit_warning or type(item.anchor) ~= "table" or type(item.anchor.exact) ~= "string" then
            pointers[index] = false
            return nil
        end
        local anchor_key = item.anchor.exact .. "\0" .. (item.anchor.prefix or "") .. "\0" .. (item.anchor.suffix or "")
        point = resolved[anchor_key]
        if point == nil then
            local position, reason = anchors.resolve(cached_document, item.anchor, {
                batch = true, normalized_body = source ~= document, checkpoint = checkpoint,
            })
            checkpoint()
            if not position then
                prepared.resolution_warning = "A chapter or resource boundary could not be verified: "
                    .. (reason or "Exact text anchor unavailable.")
            end
            point = position and position.pos0 or false
            resolved[anchor_key] = point
        end
        return remember(point)
    end
    local function ensure(items, pointers, saved, index, chapters)
        if resolve(items, pointers, saved, index, chapters) then
            resolve(items, pointers, saved, index + 1, chapters)
        end
    end
    local function current(items, pointers, saved, point, chapters)
        local low, high, found = 1, #items, nil
        while low <= high do
            local middle = math.floor((low + high) / 2)
            local boundary = resolve(items, pointers, saved, middle, chapters)
            if not boundary then return end
            local order = document:compareXPointers(boundary, point)
            if not order then return end
            if order >= 0 then found, low = middle, middle + 1 else high = middle - 1 end
        end
        if found then ensure(items, pointers, saved, found, chapters) end
    end
    local function passageTarget(location)
        local key = passageKey(location)
        if not key or (prepared.incoming_passage and prepared.incoming_passage.key == key) then return end
        local scope, reason = passageScope(document, prepared, location, checkpoint)
        local position
        if scope and scope.length <= 65536 then
            local function inside(first, last)
                local after = document:compareXPointers(scope.first, first)
                local before = document:compareXPointers(last, scope.ending)
                return after and after >= 0 and before and before >= 0
            end
            local scoped = setmetatable({
                findAllText = function(_, ...)
                    local hits = document:findAllText(...) or {}
                    if #hits >= 257 then return hits end
                    local filtered = {}
                    for _, hit in ipairs(hits) do
                        checkpoint()
                        if inside(hit.start, hit["end"]) then filtered[#filtered + 1] = hit end
                    end
                    return filtered
                end,
                getNextVisibleChar = function(_, point)
                    local next_point = document:getNextVisibleChar(point)
                    if next_point and inside(point, next_point) then return next_point end
                end,
                getSelectedWordContext = function(_, _, _, first, last)
                    local before, after = first, last
                    for _ = 1, 64 do
                        checkpoint()
                        local previous = document.getPrevVisibleChar and document:getPrevVisibleChar(before)
                        if not previous or previous == before or not inside(previous, first) then break end
                        before = previous
                    end
                    for _ = 1, 64 do
                        checkpoint()
                        local following = document:getNextVisibleChar(after)
                        if not following or following == after or not inside(last, following) then break end
                        after = following
                    end
                    return passage_source:getTextFromXPointers(before, first),
                        passage_source:getTextFromXPointers(last, after)
                end,
                getTextFromXPointer = function(_, point)
                    assert(point == "/body", "Passage verification must stay inside its resource.")
                    local cache = prepared.passage_text
                    if not cache or cache.first ~= scope.first or cache.ending ~= scope.ending then
                        cache = { first = scope.first, ending = scope.ending,
                            text = passage_source:getTextFromXPointers(scope.first, scope.ending) or "" }
                        if units(cache.text) > 65536 then cache.text = false end
                        prepared.passage_text = cache
                    end
                    return cache.text or nil
                end,
            }, { __index = function(_, name)
                local value = passage_source[name]
                if type(value) ~= "function" then return value end
                return function(_, ...) return value(passage_source, ...) end
            end })
            position, reason = anchors.resolve(scoped, location.passage, {
                batch = true, normalized_body = passage_source ~= document, checkpoint = checkpoint,
                search_prefix = #location.passage.exact <= 64 and location.passage.exact
                    or location.passage.exact:sub(1, 64):match("^(.*)%s"),
            })
        elseif scope then reason = "The passage scope exceeds its safe text limit." end
        prepared.incoming_passage = { key = key, point = position and position.pos0 or false,
            ending = position and position.pos1,
            first = scope and scope.first, scope_ending = scope and scope.ending,
            chapter = scope and scope.chapter, warning = reason }
    end
    local function capturePassage(point)
        if prepared.outgoing_passage and prepared.outgoing_passage.point == point then return end
        local location = Locations.capture(document, prepared, point)
        local scope, reason
        if location then scope, reason = passageScope(document, prepared, location, checkpoint) end
        local anchor
        if scope and document.getNextVisibleChar then
            local function walk(first, count, reverse)
                local cursor = first
                for _ = 1, count do
                    checkpoint()
                    local next_point
                    if reverse then next_point = document:getPrevVisibleChar(cursor)
                    else next_point = document:getNextVisibleChar(cursor) end
                    if not next_point or next_point == cursor then break end
                    local order
                    if reverse then order = document:compareXPointers(scope.first, next_point)
                    else order = document:compareXPointers(next_point, scope.ending) end
                    if not order or order < 0 then break end
                    cursor = next_point
                end
                return cursor
            end
            local ending = walk(point, 64)
            local exact = passage_source:getTextFromXPointers(point, ending) or ""
            if units(exact) >= 8 and units(exact) <= 256 then
                anchor = { version = 1, exact = exact }
                local before = document.getPrevVisibleChar and walk(point, 16, true) or point
                local after = walk(ending, 16)
                local prefix = passage_source:getTextFromXPointers(before, point) or ""
                local suffix = passage_source:getTextFromXPointers(ending, after) or ""
                if prefix ~= "" and units(prefix) <= 64 then anchor.prefix = prefix end
                if suffix ~= "" and units(suffix) <= 64 then anchor.suffix = suffix end
            else reason = "The reading point has no bounded text excerpt." end
        elseif scope then reason = "The reader does not support bounded passage extraction." end
        prepared.outgoing_passage = { point = point, anchor = anchor or false, warning = reason }
    end
    prepared.resolve = function(point, location, control)
        active_checkpoint = control
        if Locations.compatible(prepared, location) then
            for index, item in ipairs(map.resources) do
                if item.href == location.href then
                    ensure(map.resources, prepared.resources, cache.resources, index)
                    break
                end
            end
            if location.chapterId then
                for index, item in ipairs(map.chapters) do
                    if item.id == location.chapterId then
                        ensure(map.chapters, prepared.chapters, cache.chapters, index, true)
                        break
                    end
                end
                if map.capabilities and map.capabilities.passageAnchor == 1 then passageTarget(location) end
            end
        end
        if point and document:isXPointerInDocument(point) then
            current(map.resources, prepared.resources, cache.resources, point)
            current(map.chapters, prepared.chapters, cache.chapters, point, true)
            if map.capabilities and map.capabilities.passageAnchor == 1 then capturePassage(point) end
        end
    end
    return prepared
end

function Locations.resolve(document, prepared, point, location, options)
    if not prepared then return true end
    assert(prepared.document == document, "Chapter mapping belongs to a different reader document.")
    options = options or {}
    local now = options.now or require("socket").gettime
    local deadline, expired = now() + (options.budget or 0.5), {}
    local function checkpoint()
        if now() >= deadline then error(expired, 0) end
        if options.checkpoint then options.checkpoint() end
        if now() >= deadline then error(expired, 0) end
    end
    local requested = Locations.compatible(prepared, location) and location or nil
    local function same_request(job)
        return job.point == point and job.href == (requested and requested.href)
            and job.chapterId == (requested and requested.chapterId)
            and job.passage == passageKey(requested)
    end
    local function job()
        return {
            point = point, href = requested and requested.href, chapterId = requested and requested.chapterId,
            passage = passageKey(requested),
            thread = coroutine.create(function()
                -- Keep partially scanned quotes and HTML traversal across sync
                -- budgets instead of restarting the same expensive anchor.
                prepared.resolve(point, requested, function() coroutine.yield() end)
            end),
        }
    end
    local ok, err = pcall(function()
        while true do
            checkpoint()
            local pending = prepared.pending_resolution or job()
            prepared.pending_resolution = pending
            local resumed, reason = coroutine.resume(pending.thread)
            if not resumed then error(reason, 0) end
            if coroutine.status(pending.thread) == "dead" then
                prepared.pending_resolution = nil
                if same_request(pending) then return end
            end
        end
    end)
    if not ok and err ~= expired then prepared.pending_resolution = nil; error(err, 0) end
    if ok then prepared.resolved_point = point end
    prepared.warning = not ok and
        "Chapter mapping paused at its time limit. Later syncs resume; pending chapter-aware positions are retained."
        or prepared.limit_warning or prepared.resolution_warning
        or (requested and prepared.incoming_passage and prepared.incoming_passage.key == passageKey(requested)
            and prepared.incoming_passage.warning)
        or (point and prepared.outgoing_passage and prepared.outgoing_passage.point == point
            and prepared.outgoing_passage.warning)
    return ok, prepared.warning
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

passageScope = function(document, prepared, location, checkpoint)
    local resource, resource_range
    for index, item in ipairs(prepared.map.resources) do
        if item.href == location.href then
            resource, resource_range = item, range(document, prepared.map.resources, prepared.resources, index)
            break
        end
    end
    if not resource_range then return nil, "The passage resource boundaries are unverified." end
    local first, ending = resource_range.first, resource_range.ending
    local start, finish, chapter = resource.start, resource["end"], false
    if location.chapterId then
        local found = false
        for index, item in ipairs(prepared.map.chapters) do
            if item.id == location.chapterId then
                found = true
                if item["end"] <= start or item.start >= finish then
                    return nil, "The passage resource does not belong to its chapter."
                end
                local bounds = range(document, prepared.map.chapters, prepared.chapters, index)
                if not bounds then return nil, "The passage chapter boundaries are unverified." end
                if item.start > start then first, start = bounds.first, item.start end
                if item["end"] < finish then ending, finish = bounds.ending, item["end"] end
                chapter = item.kind == "chapter"
                break
            end
        end
        if not found then return nil, "The passage chapter is not in this edition." end
    end
    if not ending then
        ending = prepared.final_point
        if not ending and document.getPageXPointer and document.getPageCount and document.getNextVisibleChar then
            ending = document:getPageXPointer(document:getPageCount())
            for step = 1, 4096 do
                checkpoint()
                local next_point = ending and document:getNextVisibleChar(ending)
                if not next_point or next_point == ending then prepared.final_point = ending; break end
                ending = next_point
                if step == 4096 then return nil, "The publication endpoint exceeds its safe work limit." end
            end
        end
    end
    if not ending or not document:isXPointerInDocument(ending) then return nil, "The passage endpoint is unavailable." end
    local order = document:compareXPointers(first, ending)
    if finish <= start or not order or order <= 0 then return nil, "The passage scope is empty or invalid." end
    return { first = first, ending = ending, length = finish - start, chapter = chapter }
end

local function containing(document, items, pointers, indices, point)
    local low, high, found = 1, #indices, nil
    while low <= high do
        local middle = math.floor((low + high) / 2)
        local boundary = pointers[indices[middle]]
        if not document:isXPointerInDocument(boundary) then return nil end
        local order = document:compareXPointers(boundary, point)
        if not order then return nil end
        if order >= 0 then found, low = indices[middle], middle + 1 else high = middle - 1 end
    end
    local bounds = found and range(document, items, pointers, found)
    if bounds then
        local before_end = bounds.ending and document:compareXPointers(bounds.ending, point)
        if not bounds.ending or (before_end and before_end < 0) then return items[found], bounds end
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
    if not prepared or prepared.document ~= document or not document:isXPointerInDocument(point) then return nil end
    local map = prepared.map
    local resource, resource_bounds = containing(document, map.resources, prepared.resources, prepared.resource_indices, point)
    if not resource then return nil end
    local resource_progression = progression(document, point, resource_bounds)
    if not resource_progression then return nil end
    local result = {
        version = 1, formatId = map.formatId, contentHash = map.contentHash,
        mapFingerprint = map.fingerprint, href = resource.href,
        resourceProgression = resource_progression, basis = "rendered",
    }
    local chapter, chapter_bounds = containing(document, map.chapters, prepared.chapters, prepared.chapter_indices, point)
    if chapter and chapter.kind == "chapter" then
        result.chapterId = chapter.id
        result.chapterProgression = progression(document, point, chapter_bounds)
    end
    local passage = prepared.outgoing_passage
    if passage and passage.point == point and passage.anchor then result.passage = passage.anchor end
    return result
end

function Locations.target(document, prepared, location)
    if type(location) ~= "table" or location.version ~= 1
        or not fraction(location.resourceProgression)
        or (location.basis ~= "text" and location.basis ~= "rendered")
        or (location.passage ~= nil and not passageKey(location))
        or ((location.chapterId == nil) ~= (location.chapterProgression == nil))
        or (location.chapterProgression ~= nil and not fraction(location.chapterProgression)) then
        return nil, "Invalid portable EPUB location."
    end
    local map = prepared and prepared.map
    if not Locations.compatible(prepared, location) or prepared.document ~= document then
        return nil, "The saved chapter belongs to an unverified edition or chapter map."
    end
    local resource
    for _, item in ipairs(map.resources) do
        if item.href == location.href then resource = item; break end
    end
    if not resource then return nil, "The saved EPUB resource is not in this edition." end
    local passage = prepared.incoming_passage
    if passage and passage.key == passageKey(location) and passage.point
        and document:isXPointerInDocument(passage.point) and document:isXPointerInDocument(passage.first)
        and document:isXPointerInDocument(passage.scope_ending) then
        local after = document:compareXPointers(passage.first, passage.point)
        local before = document:compareXPointers(passage.point, passage.scope_ending)
        if after and after >= 0 and before and before > 0 then
            return { point = passage.point, passage = true, chapter = passage.chapter, label = "Verified saved passage" }
        end
    end
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
            if location.passage then label = "Passage could not be verified. " .. label end
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
