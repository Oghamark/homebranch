local Identity = {}

local function attribute(text, name)
    return text:match("%f[%w]" .. name .. '="([^"]*)"')
end

function Identity.contentHash(document, sha256)
    local container = document:getDocumentFileContent("META-INF/container.xml")
    if not container then return nil, "EPUB container could not be read." end
    local opf_path = attribute(container, "full%-path")
    if not opf_path then return nil, "EPUB package path is unsupported." end
    local opf = document:getDocumentFileContent(opf_path)
    if not opf then return nil, "EPUB package could not be read." end
    local base = opf_path:match("^(.*)/") or ""
    if base ~= "" then base = base .. "/" end
    local manifest = {}
    for attrs in opf:gmatch("<item%s+([^>]+)/>") do
        local id, href, media = attribute(attrs, "id"), attribute(attrs, "href"), attribute(attrs, "media%-type")
        if id and href and media and (media:find("xhtml", 1, true) or media:find("html", 1, true)) then
            manifest[id] = base .. href
        end
    end
    local spine = opf:match("<spine[^>]*>(.-)</spine>")
    if not spine then return nil, "EPUB reading order could not be read." end
    local update, count, bytes = sha256(), 0, 0
    for attrs in spine:gmatch("<itemref%s+([^>]+)>") do
        local href = manifest[attribute(attrs, "idref")]
        if href then
            local decoded = href:gsub("%%(%x%x)", function(hex) return string.char(tonumber(hex, 16)) end)
            local content = document:getDocumentFileContent(href) or document:getDocumentFileContent(decoded)
            if not content then return nil, "An EPUB reading-order resource could not be read." end
            bytes = bytes + #content
            if bytes > 64 * 1024 * 1024 then return nil, "EPUB content exceeds the identity verification limit." end
            update(content)
            count = count + 1
        end
    end
    if count == 0 then return nil, "EPUB has no supported reading-order resources." end
    return update()
end

return Identity
