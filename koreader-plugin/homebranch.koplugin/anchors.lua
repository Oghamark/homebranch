local Anchors = {}

function Anchors.normalize(text)
    return (text or ""):gsub("%s+", " "):gsub("^ ", ""):gsub(" $", "")
end

local function matches(document, start, ending, exact)
    return type(start) == "string" and type(ending) == "string"
        and document:isXPointerInDocument(start) and document:isXPointerInDocument(ending)
        and Anchors.normalize(document:getTextFromXPointers(start, ending)) == Anchors.normalize(exact)
end

function Anchors.capture(document, item)
    if not item.drawer or not matches(document, item.pos0, item.pos1,
        document:getTextFromXPointers(item.pos0, item.pos1)) then
        return nil, "Only valid EPUB text highlights can be synchronized."
    end
    local exact = document:getTextFromXPointers(item.pos0, item.pos1)
    if Anchors.normalize(exact) == "" then return nil, "The selected range contains no text." end
    local before, after = document:getSelectedWordContext(exact, 8, item.pos0, item.pos1)
    return {
        version = 1,
        exact = exact,
        prefix = before,
        suffix = after,
        native = { pos0 = item.pos0, pos1 = item.pos1 },
    }
end

function Anchors.resolve(document, anchor, options)
    if type(anchor) ~= "table" or anchor.version ~= 1
        or type(anchor.exact) ~= "string" or Anchors.normalize(anchor.exact) == "" then
        return nil, "Invalid annotation anchor."
    end
    local function context_matches(start, ending)
        local before, after = document:getSelectedWordContext(anchor.exact, 32, start, ending)
        before, after = Anchors.normalize(before), Anchors.normalize(after)
        local prefix, suffix = Anchors.normalize(anchor.prefix), Anchors.normalize(anchor.suffix)
        return (prefix == "" or before:sub(-#prefix) == prefix)
            and (suffix == "" or after:sub(1, #suffix) == suffix)
    end
    local native = anchor.native
    if native and matches(document, native.pos0, native.pos1, anchor.exact)
        and context_matches(native.pos0, native.pos1) then
        return { pos0 = native.pos0, pos1 = native.pos1 }
    end
    -- Chapter lookups can try a short prefix, but independent full-body counting
    -- must still prove coverage of occurrences split by inline elements.
    local token = anchor.exact:match("^%s*(%S+)")
    local exact = Anchors.normalize(anchor.exact)
    local prefix = options and options.batch and options.prefix_search ~= false
        and exact:match("^(%S+%s+%S+)")
    if prefix and #prefix > 64 then prefix = nil end
    local function first_token()
        local fallback = {}
        for key, value in pairs(options) do fallback[key] = value end
        fallback.prefix_search = false
        return Anchors.resolve(document, anchor, fallback)
    end
    local function checkpoint()
        if options and options.checkpoint then options.checkpoint() end
    end
    checkpoint()
    local hits = document:findAllText(prefix or token, false, 32, 257, false) or {}
    checkpoint()
    if prefix and #hits == 0 then return first_token() end
    if #hits >= 257 then return nil, "Too many matching passages." end
    local candidates = {}
    local budget = 16384
    for _, hit in ipairs(hits) do
        checkpoint()
        local ending = hit["end"]
        for _ = 1, math.min(#anchor.exact * 2 + 32, 8192) do
            checkpoint()
            local current = Anchors.normalize(document:getTextFromXPointers(hit.start, ending))
            if current == exact then break end
            if exact:sub(1, #current) ~= current then break end
            local endings = {}
            for step = 1, options and options.batch and 32 or 1 do
                budget = budget - 1
                if budget <= 0 then return nil, "Passage search exceeded its safe work limit." end
                local previous = endings[step - 1] or ending
                local next_char = document:getNextVisibleChar(previous)
                if not next_char or next_char == previous then break end
                endings[step] = next_char
            end
            if #endings == 0 then break end
            ending = endings[#endings]
            if #endings > 1 then
                local expanded = Anchors.normalize(document:getTextFromXPointers(hit.start, ending))
                if #expanded >= #exact then
                    local low, high = 1, #endings
                    while low <= high do
                        checkpoint()
                        local middle = math.floor((low + high) / 2)
                        local value = Anchors.normalize(document:getTextFromXPointers(hit.start, endings[middle]))
                        if value == exact then ending = endings[middle]; break end
                        if #value < #exact then low = middle + 1 else high = middle - 1 end
                    end
                    break
                end
            end
        end
        if matches(document, hit.start, ending, anchor.exact) then
            candidates[#candidates + 1] = { pos0 = hit.start, pos1 = ending }
        end
    end
    -- A token can itself be split by markup. Count the complete literal quote
    -- independently before claiming that token search found every occurrence.
    checkpoint()
    local body = document:getTextFromXPointer("/body")
    if type(body) ~= "string" or #body > 4 * 1024 * 1024 then
        return nil, "The publication cannot be checked safely for duplicate passages."
    end
    if not (options and options.normalized_body) then body = Anchors.normalize(body) end
    local occurrences, offset = 0, 1
    while true do
        checkpoint()
        local start = body:find(exact, offset, true)
        if not start then break end
        occurrences, offset = occurrences + 1, start + 1
        if occurrences >= 257 then return nil, "Too many matching passages." end
    end
    if occurrences ~= #candidates then
        if prefix then return first_token() end
        return nil, "The publication layout prevents safe passage matching."
    end
    if #candidates == 1 then return candidates[1] end
    local contextual = {}
    for _, candidate in ipairs(candidates) do
        if context_matches(candidate.pos0, candidate.pos1) then contextual[#contextual + 1] = candidate end
    end
    if #contextual == 1 then return contextual[1] end
    if #candidates ~= 1 then
        return nil, #candidates == 0 and "Passage not found with matching context." or "Passage is ambiguous."
    end
    return candidates[1]
end

return Anchors
