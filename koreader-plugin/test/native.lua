-- Run from an extracted KOReader directory, with repository and EPUB absolute paths.
require("setupkoenv")
local cre = require("libs/libkoreader-cre")
local Anchors = dofile(arg[1] .. "/koreader-plugin/homebranch.koplugin/anchors.lua")
local Identity = dofile(arg[1] .. "/koreader-plugin/homebranch.koplugin/identity.lua")
cre.initCache(arg[2] .. ".cache", 8 * 1024 * 1024)
cre.initHyphDict("./data/hyph/")
cre.registerFont("fonts/noto/NotoSerif-Regular.ttf")
local native = cre.newDocView(600, 800, 1)
native:setStringProperty("font.face.default", "Noto Serif")
native:setIntProperty("crengine.render.dpi", 96)
assert(native:loadDocument(arg[2]), "Fixture failed to load.")
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
        local before = native:getPrevVisibleWordStart(a) or a
        local after = native:getNextVisibleWordEnd(b) or b
        return native:getTextFromXPointers(before, a, false, false),
            native:getTextFromXPointers(b, after, false, false)
    end,
}
local exact = "A unique cross-reader highlight belongs here."
if os.getenv("HOMEBRANCH_PROBE_VERBOSE") then
    print("height", native:getFullHeight(), "text", native:getTextFromXPointer("/body"))
    print(require("rapidjson").encode(document:findAllText("unique", false, 32, 257, false) or {}))
    print("container", native:getDocumentFileContent("META-INF/container.xml"))
end
local found, err = Anchors.resolve(document, { version = 1, exact = exact })
assert(found, err)
assert(Anchors.normalize(document:getTextFromXPointers(found.pos0, found.pos1)) == exact)
local captured = assert(Anchors.capture(document, { drawer = "lighten", pos0 = found.pos0, pos1 = found.pos1 }))
assert(Anchors.resolve(document, captured))
local ambiguous, reason = Anchors.resolve(document, {
    version = 1, exact = "The repeated passage appears twice.",
})
assert(not ambiguous and type(reason) == "string", tostring(reason))
assert(not Anchors.resolve(document, { version = 1, exact = "A nonexistent highlight" }))
local second = assert(Anchors.resolve(document, {
    version = 1, exact = "A final distinct annotation can cross multiple text nodes.",
}))
assert(native:isXPointerInDocument(second.pos0))
local content_hash, hash_error = Identity.contentHash({
    getDocumentFileContent = function(_, path) return native:getDocumentFileContent(path) end,
}, require("ffi/sha2").sha256)
assert(content_hash, hash_error)
print("EPUB spine SHA-256: " .. content_hash)
print("Native KOReader EPUB probe passed: unique/multi-node quotes, native round-trip, ambiguity and missing-text rejection.")
print("DOM version: " .. cre.getLatestDomVersion())
native:close()
