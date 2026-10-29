-- Invoked by the API acceptance harness over its private approval control channel.
require("setupkoenv")
local json = require("rapidjson")
local cre = require("libs/libkoreader-cre")
local root, fixture = assert(arg[1]), assert(arg[2])
local base = assert(os.getenv("HOMEBRANCH_NATIVE_API"))
local Transport = dofile(root .. "/koreader-plugin/homebranch.koplugin/transport.lua")
local TLS = dofile(root .. "/koreader-plugin/homebranch.koplugin/tls.lua")
local Anchors = dofile(root .. "/koreader-plugin/homebranch.koplugin/anchors.lua")
local Identity = dofile(root .. "/koreader-plugin/homebranch.koplugin/identity.lua")
io.stdout:setvbuf("no")
local function signal(event, fields)
    fields = fields or {}
    fields.event = event
    io.write("HOMEBRANCH_NATIVE ", json.encode(fields), "\n")
    local line = assert(io.read("*l"), "Live harness closed its control channel.")
    local reply = assert(json.decode(line), "Invalid live harness reply.")
    assert(reply.ok, "Live harness rejected " .. event)
    return reply
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
native:setIntProperty("crengine.render.dpi", 96)
assert(native:loadDocument(fixture))
native:renderDocument()
local document = {
    isXPointerInDocument = function(_, xp) return native:isXPointerInDocument(xp) end,
    getTextFromXPointers = function(_, a, b) return native:getTextFromXPointers(a, b, false, false) end,
    getNextVisibleChar = function(_, xp) return native:getNextVisibleChar(xp) end,
    getTextFromXPointer = function(_, xp) return native:getTextFromXPointer(xp) end,
    findAllText = function(_, text, insensitive, context, limit, regex)
        return native:findAllText(text, insensitive, regex, limit, true, context)
    end,
    getSelectedWordContext = function(_, _, _, a, b)
        local before, after = native:getPrevVisibleWordStart(a) or a, native:getNextVisibleWordEnd(b) or b
        return native:getTextFromXPointers(before, a, false, false),
            native:getTextFromXPointers(b, after, false, false)
    end,
    getDocumentFileContent = function(_, path) return native:getDocumentFileContent(path) end,
}
request("GET", "/healthcheck", nil, true)
local pairing = request("POST", "/pairings", { deviceName = "Actual native integration fixture" }, true)
signal("pairing", { userCode = pairing.userCode })
local claim = request("POST", "/pairings/claim", { deviceCode = pairing.deviceCode }, true)
assert(claim.state == "approved" and claim.username and claim.key and claim.deviceId)
account = { username = claim.username, key = claim.key, deviceId = claim.deviceId }
request("GET", "/users/auth")
local digest = assert(require("util").partialMD5(fixture))
local hash = assert(Identity.contentHash(document, require("ffi/sha2").sha256))
assert(digest == "840a5c4dd0419dd389ea956f985f8b8d")
assert(hash == "1060596e6363adce9ac22c3b7781a05134ba7947353e4f3059d9c0e57d0d7204")
local match = request("POST", "/documents/resolve", { document = digest, contentHash = hash })
local prefix = "/books/" .. match.bookId
local setup = signal("linked", { bookId = match.bookId, formatId = match.formatId, deviceId = claim.deviceId })
local browser_id = assert(setup.annotationId)
local function annotation(id)
    local response = request("GET", prefix .. "/annotations?after=0")
    for _, item in ipairs(response.items) do if item.id == id then return item end end
    error("Expected live annotation was absent: " .. id)
end
local browser = annotation(browser_id)
assert(browser.note == "Browser created" and browser.color == "#90ee90")
local position = assert(Anchors.resolve(document, browser.anchor))
position.drawer = "lighten"
local portable = assert(Anchors.capture(document, position))
local changed = {
    mutationId = "11111111-2222-4333-a444-555555555551",
    quote = browser.quote, note = "Native edited", color = browser.color, anchor = portable,
}
local accepted = request("PUT", prefix .. "/annotations/" .. browser_id, changed)
local retry = request("PUT", prefix .. "/annotations/" .. browser_id, changed)
assert(accepted.revision == retry.revision)
signal("native-edited", { annotationId = browser_id, revision = accepted.revision })
changed.mutationId = "11111111-2222-4333-a444-555555555552"
changed.deleted = true
request("PUT", prefix .. "/annotations/" .. browser_id, changed)
signal("native-deleted", { annotationId = browser_id })
local native_id = "11111111-2222-4333-a444-555555555553"
local second = assert(Anchors.resolve(document, {
    version = 1, exact = "A final distinct annotation can cross multiple text nodes.",
}))
second.drawer = "lighten"
local created = {
    mutationId = "11111111-2222-4333-a444-555555555554",
    quote = "A final distinct annotation can cross multiple text nodes.",
    note = "Native created", color = "#87cefa",
    anchor = assert(Anchors.capture(document, second)),
}
local first_native = request("PUT", prefix .. "/annotations/" .. native_id, created)
signal("native-created", { annotationId = native_id })
local edited = annotation(native_id)
assert(edited.note == "Browser edited" and not edited.deleted)
assert(Anchors.resolve(document, edited.anchor))
signal("browser-delete", { annotationId = native_id })
local deleted = annotation(native_id)
assert(deleted.deleted)
local replay = request("PUT", prefix .. "/annotations/" .. native_id, created)
assert(replay.revision == first_native.revision)
assert(annotation(native_id).deleted)
local progress = {
    document = digest, progress = position.pos0, percentage = 0.27,
    device = "Actual native fixture", device_id = claim.deviceId,
    mutationId = "11111111-2222-4333-a444-555555555555",
}
request("PUT", "/syncs/progress", progress)
local native_progress = request("GET", prefix .. "/progress")
assert(native_progress.source == "koreader" and native_progress.nativeProgress == position.pos0)
request("PUT", "/syncs/progress", progress)
assert(request("GET", prefix .. "/progress").revision == native_progress.revision)
signal("native-progress", { percentage = 0.27 })
local web_progress = request("GET", prefix .. "/progress")
assert(web_progress.source == "web" and web_progress.accuracy == "approximate")
assert(math.abs(web_progress.percentage - 0.71) < 0.00001)
assert(not web_progress.nativeProgress or web_progress.nativeProgress == json.null)
progress.percentage = 0.12
progress.progress = second.pos0
progress.mutationId = "11111111-2222-4333-a444-555555555556"
request("PUT", "/syncs/progress", progress)
assert(math.abs(request("GET", prefix .. "/progress").percentage - 0.12) < 0.00001)
signal("revoke", { deviceId = claim.deviceId })
local refused = Transport.request(base, "GET", prefix .. "/annotations?after=0", nil, account, TLS)
assert(refused.code == 401 and refused.error)
refused = Transport.request(base, "PUT", "/syncs/progress", progress, account, TLS)
assert(refused.code == 401 and refused.error)
native:close()
signal("done", { assertions = "pairing, verified identity, native/browser annotations, deletion, retries, progress, revocation" })
