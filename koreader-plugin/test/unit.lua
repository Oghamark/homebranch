local root = (arg[0]:match("^(.*)/") or ".") .. "/../homebranch.koplugin/"
local Anchors = dofile(root .. "anchors.lua")
local State = dofile(root .. "state.lua")
local TLS = dofile(root .. "tls.lua")
local Identity = dofile(root .. "identity.lua")
local passed = 0
local function test(name, run)
    run()
    passed = passed + 1
    print("ok " .. passed .. " - " .. name)
end
local function equal(a, b) assert(a == b, tostring(a) .. " != " .. tostring(b)) end
local next_id = 0
local function id() next_id = next_id + 1; return "id-" .. next_id end
local function payload(item)
    return { quote = item.text, note = item.note or "", color = "#ffff00",
        deleted = false, anchor = { version = 1, exact = item.text } }
end
local function fingerprint(item) return item.quote .. item.note .. tostring(item.deleted) end
local function document(hits)
    return {
        isXPointerInDocument = function(_, xp) return xp == "a" or xp == "b" or xp == "c" end,
        getTextFromXPointers = function(_, start) return start == "a" and "Exact quote" or "Other quote" end,
        findAllText = function() return hits end,
        getNextVisibleChar = function() return nil end,
        getTextFromXPointer = function()
            local text = {}
            for _ in ipairs(hits) do text[#text + 1] = "Exact quote" end
            return table.concat(text, " ")
        end,
        getSelectedWordContext = function() return "Prefix ", " suffix" end,
    }
end

test("normalization collapses only whitespace", function()
    equal(Anchors.normalize("  Exact\n quote\t"), "Exact quote")
    assert(Anchors.normalize("exact quote") ~= Anchors.normalize("Exact quote"))
end)
test("original native anchors require exact extracted text", function()
    local resolved = Anchors.resolve(document({}), { version = 1, exact = "Exact quote",
        native = { pos0 = "a", pos1 = "b" } })
    equal(resolved.pos0, "a")
    equal(Anchors.resolve(document({}), { version = 1, exact = "Wrong",
        native = { pos0 = "a", pos1 = "b" } }), nil)
end)
test("unique literal quote resolves and ambiguous quote is rejected", function()
    local hit = { start = "a", ["end"] = "b" }
    local resolved = Anchors.resolve(document({ hit }), { version = 1, exact = "Exact quote" })
    equal(resolved.pos0, "a")
    equal(Anchors.resolve(document({ hit, hit }), { version = 1, exact = "Exact quote" }), nil)
end)
test("mismatched context cannot disambiguate repeated passages", function()
    local hit = { start = "a", ["end"] = "b" }
    equal(Anchors.resolve(document({ hit, hit }),
        { version = 1, exact = "Exact quote", prefix = "Wrong" }), nil)
end)
test("unique exact quote tolerates cross-engine context differences", function()
    local result = Anchors.resolve(document({ { start = "a", ["end"] = "b" } }),
        { version = 1, exact = "Exact quote", prefix = "Different surrounding layout" })
    equal(result.pos0, "a")
end)
test("invalid and empty anchors are rejected", function()
    equal(Anchors.resolve(document({}), {}), nil)
    equal(Anchors.resolve(document({}), { version = 1, exact = "" }), nil)
end)
test("a missed split-token occurrence cannot be guessed as unique", function()
    local doc = document({ { start = "a", ["end"] = "b" } })
    doc.getTextFromXPointer = function() return "Exact quote and another Exact quote" end
    equal(Anchors.resolve(doc, { version = 1, exact = "Exact quote" }), nil)
end)
test("queue mutations keep stable IDs through retry and acknowledgements", function()
    local state = State.document({}, "digest")
    State.queue(state, "annotation", payload({ text = "Exact quote" }), id)
    local operation = state.pending[1]
    assert(State.hasPending(state, "annotation"))
    equal(state.pending[1].body.mutationId, operation.body.mutationId)
    assert(State.acknowledge(state, operation.body.mutationId))
    equal(#state.pending, 0)
    equal(State.acknowledge(state, operation.body.mutationId), false)
end)
test("diff assigns IDs once, detects note edits and deletions", function()
    local state = State.document({}, "digest")
    local item = { drawer = "lighten", pos0 = "a", pos1 = "b", text = "Exact quote" }
    assert(State.collect(state, { item }, payload, fingerprint, id))
    local original_id = item.homebranch_id
    equal(#state.pending, 1)
    assert(State.collect(state, { item }, payload, fingerprint, id))
    equal(#state.pending, 1)
    item.note = "Edited"
    assert(State.collect(state, { item }, payload, fingerprint, id))
    equal(item.homebranch_id, original_id)
    equal(#state.pending, 2)
    assert(State.collect(state, {}, payload, fingerprint, id))
    equal(#state.pending, 3)
    equal(state.pending[3].body.deleted, true)
    assert(State.collect(state, {}, payload, fingerprint, id))
    equal(#state.pending, 3)
end)
test("remote changes cannot overwrite pending local changes", function()
    local state = State.document({}, "digest")
    State.queue(state, "a", payload({ text = "Exact quote" }), id)
    equal(State.apply(state, { id = "a", deleted = true }, {}, function() error("unexpected") end), false)
end)
test("an invalid local anchor cannot partially advance the durable snapshot", function()
    local state = State.document({}, "digest")
    local items = {
        { drawer = "lighten", pos0 = "a", pos1 = "b", text = "Valid" },
        { drawer = "lighten", pos0 = "a", pos1 = "b", text = "Invalid" },
    }
    local ok = State.collect(state, items, function(item)
        if item.text == "Invalid" then return nil, "Invalid anchor" end
        return payload(item)
    end, fingerprint, id)
    assert(not ok)
    equal(#state.pending, 0)
    equal(next(state.known), nil)
end)
test("unresolved remote annotations are retained and never queued as deletion", function()
    local state = State.document({}, "digest")
    local remote = payload({ text = "Exact quote" })
    remote.id = "a"
    equal(State.apply(state, remote, {}, function() return nil, "Not found" end), false)
    equal(state.unresolved.a.annotation, remote)
    assert(State.collect(state, {}, payload, fingerprint, id))
    equal(#state.pending, 0)
end)
test("remote delete removes both installed and unresolved state", function()
    local state = State.document({}, "digest")
    state.unresolved.a = { annotation = { id = "a" } }
    local items = { { homebranch_id = "a" } }
    assert(State.apply(state, { id = "a", deleted = true }, items))
    equal(#items, 0)
    equal(state.unresolved.a, nil)
    equal(state.known.a.deleted, true)
end)
test("accounts and document queues are independent", function()
    local first, second = {}, {}
    State.queue(State.document(first, "same"), "a", payload({ text = "Private" }), id)
    equal(#State.document(second, "same").pending, 0)
    equal(#State.document(first, "different").pending, 0)
end)
test("hostname matching supports only single-label SAN wildcards", function()
    assert(TLS.matchesName("sync.example.com", "*.example.com"))
    assert(TLS.matchesName("SYNC.example.com", "sync.EXAMPLE.com"))
    assert(not TLS.matchesName("a.b.example.com", "*.example.com"))
    assert(not TLS.matchesName("example.com", "*.example.com"))
    assert(not TLS.matchesName("example.com", "*.com"))
    assert(not TLS.matchesName("sync.evil.com", "sync.example.com"))
end)
test("certificate SAN is required and CN alone is not trusted", function()
    assert(TLS.verifyName("sync.example.com", { extensions = function()
        return { ["2.5.29.17"] = { dNSName = { "*.example.com" } } }
    end }))
    assert(not TLS.verifyName("sync.example.com", { extensions = function() return {} end }))
end)
test("IP hosts require IP subject alternative names", function()
    assert(TLS.verifyName("127.0.0.1", { extensions = function()
        return { ["2.5.29.17"] = { iPAddress = { "127.0.0.1" } } }
    end }))
    assert(not TLS.verifyName("127.0.0.1", { extensions = function()
        return { ["2.5.29.17"] = { dNSName = { "127.0.0.1" } } }
    end }))
end)
test("content identity follows the EPUB spine and ignores metadata", function()
    local files = {
        ["META-INF/container.xml"] = '<rootfile full-path="OPS/book.opf"/>',
        ["OPS/book.opf"] = '<metadata>Original title</metadata><manifest>'
            .. '<item id="a" href="chapter%20one.xhtml" media-type="application/xhtml+xml"/>'
            .. '<item id="b" href="two.xhtml" media-type="application/xhtml+xml"/>'
            .. '</manifest><spine><itemref idref="a"/><itemref idref="b"/></spine>',
        ["OPS/chapter one.xhtml"] = "First chapter.",
        ["OPS/two.xhtml"] = "Second chapter.",
    }
    local doc = { getDocumentFileContent = function(_, path) return files[path] end }
    local function hash()
        local chunks = {}
        return function(text)
            if text then chunks[#chunks + 1] = text else return table.concat(chunks) end
        end
    end
    equal(Identity.contentHash(doc, hash), "First chapter.Second chapter.")
    files["OPS/book.opf"] = files["OPS/book.opf"]:gsub("Original title", "Updated title")
    equal(Identity.contentHash(doc, hash), "First chapter.Second chapter.")
    files["OPS/two.xhtml"] = nil
    equal(Identity.contentHash(doc, hash), nil)
end)
print("Passed " .. passed .. " plugin unit tests.")
