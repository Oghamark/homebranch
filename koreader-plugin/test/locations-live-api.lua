require("setupkoenv")
local json = require("rapidjson")
local cre = require("libs/libkoreader-cre")
local root, fixture = assert(arg[1]), assert(arg[2])
local plugin = root .. "/koreader-plugin/homebranch.koplugin/"
local Transport = dofile(plugin .. "transport.lua")
local TLS = dofile(plugin .. "tls.lua")
local Anchors = dofile(plugin .. "anchors.lua")
local Identity = dofile(plugin .. "identity.lua")
local Locations = dofile(plugin .. "locations.lua")
local base = assert(os.getenv("HOMEBRANCH_NATIVE_API"))
io.stdout:setvbuf("no")
local function signal(event, fields)
    fields = fields or {}
    fields.event = event
    io.write("HOMEBRANCH_NATIVE ", json.encode(fields), "\n")
    local reply = assert(json.decode(assert(io.read("*l"))))
    assert(reply.ok, "API control channel rejected " .. event)
end
local account
local function request(method, path, body, anonymous)
    local response = Transport.request(base, method, path, body, not anonymous and account or nil, TLS)
    assert(not response.error, response.error)
    return response.body
end
cre.initCache(fixture .. ".live.cache", 8 * 1024 * 1024)
cre.initHyphDict("./data/hyph/")
cre.registerFont("fonts/noto/NotoSerif-Regular.ttf")
local native = cre.newDocView(600, 800, 1)
native:setStringProperty("font.face.default", "Noto Serif")
assert(native:loadDocument(fixture))
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
        return native:getTextFromXPointers(native:getPrevVisibleWordStart(a) or a, a, false, false),
            native:getTextFromXPointers(b, native:getNextVisibleWordEnd(b) or b, false, false)
    end,
}
local pairing = request("POST", "/pairings", { deviceName = "Native chapter fixture" }, true)
signal("pairing", { userCode = pairing.userCode })
local claim = request("POST", "/pairings/claim", { deviceCode = pairing.deviceCode }, true)
assert(claim.state == "approved")
account = { username = claim.username, key = claim.key, deviceId = claim.deviceId }
local digest = assert(require("util").partialMD5(fixture))
local hash = assert(Identity.contentHash(document, require("ffi/sha2").sha256))
local match = request("POST", "/documents/resolve", { document = digest, contentHash = hash })
assert(match.capabilities.portableLocation == 1)
signal("chapter-linked", { bookId = match.bookId, formatId = match.formatId })
local prefix = "/books/" .. match.bookId
local map = request("GET", prefix .. "/location-map?formatId=" .. match.formatId)
assert(map.contentHash == hash)
local prepared = assert(Locations.prepare(document, map, Anchors))
local chosen
for index, item in ipairs(map.chapters) do
    if item.id == "OPS/one.xhtml#long" then chosen = prepared.chapters[index] end
end
assert(chosen, "The spanning chapter boundary must resolve in the real native engine.")
local location = assert(Locations.capture(document, prepared, chosen))
assert(location.chapterId == "OPS/one.xhtml#long")
location.native = { engine = "crengine", domVersion = cre.getLatestDomVersion() }
local operation = { document = digest, progress = chosen, percentage = 0.27,
    device = "Actual native chapter fixture", device_id = claim.deviceId,
    mutationId = "native-chapter-progress", location = location }
local acknowledgement = request("PUT", "/syncs/progress", operation)
local accepted = request("GET", prefix .. "/progress")
assert(accepted.location.chapterId == location.chapterId)
local target = {
    version = 1, formatId = map.formatId, contentHash = hash, mapFingerprint = map.fingerprint,
    href = "OPS/last.xhtml", resourceProgression = 0.5,
    chapterId = "OPS/last.xhtml#last", chapterProgression = 0.5, basis = "text",
}
signal("chapter-native-progress", { location = location, target = target })
local remote = request("GET", prefix .. "/progress")
assert(remote.source == "web" and remote.location.chapterId == target.chapterId)
local jump = assert(Locations.target(document, prepared, remote.location))
assert(jump.chapter and jump.pos >= jump.start_pos and jump.pos < jump.end_pos)
native:gotoXPointer(jump.point)
assert(Locations.capture(document, prepared, jump.point).chapterId == target.chapterId)
local retried = request("PUT", "/syncs/progress", operation)
assert(retried.timestamp == acknowledgement.timestamp)
assert(request("GET", prefix .. "/progress").revision == remote.revision,
    "An old retry must not replace the newer chapter or advance its revision.")
signal("chapter-legacy-write", { href = "OPS/last.xhtml" })
local legacy = request("GET", prefix .. "/progress")
assert(legacy.location == nil or legacy.location == json.null)
assert(legacy.percentage == 0.2)
local raw = request("GET", "/syncs/progress/" .. digest)
assert(raw.progress == chosen and raw.percentage == 0.27)
signal("revoke", { deviceId = claim.deviceId })
local refused = Transport.request(base, "PUT", "/syncs/progress", operation, account, TLS)
assert(refused.code == 401)
native:close()
signal("done")
