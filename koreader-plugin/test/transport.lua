local root = (arg[0]:match("^(.*)/") or ".") .. "/../homebranch.koplugin/"
local response, captured, calls, now = {}, nil, 0, 0
local null = {}
package.loaded["rapidjson"] = {
    null = null,
    encode = function() return "request-body" end,
    decode = function(value)
        if value == "null" then return null end
        if value == "ok" then return { authorized = "OK" } end
        if value == "error" then return { message = "Invalid credentials" } end
        return nil
    end,
}
package.loaded["socket"] = { gettime = function() return now end }
package.loaded["socketutil"] = { set_timeout = function() end, reset_timeout = function() end }
package.loaded["ltn12"] = { source = { string = function(value) return function() return value end end } }
package.loaded["socket.http"] = { request = function(request)
    captured, calls = request, calls + 1
    now = now + (response.elapsed or 0)
    local ok, err = request.sink(response.body)
    if not ok then return nil, err end
    if response.failed then return nil, "Network unavailable" end
    return 1, response.code
end }
local Transport = dofile(root .. "transport.lua")
local tls = { create = function() return function() end end }
local account = { username = "device", key = "scoped-key" }
local passed = 0
local function test(name, run)
    response, captured, now = {}, nil, 0
    run()
    passed = passed + 1
    print("ok " .. passed .. " - " .. name)
end
test("plain HTTP is rejected before transport or credential disclosure", function()
    local before = calls
    local result = Transport.request("http://example.test", "GET", "/users/auth", nil, account, tls)
    assert(result.error and calls == before)
end)
test("native headers use only scoped device credentials and redirects are disabled", function()
    response = { code = 200, body = "ok" }
    local result = Transport.request("https://example.test", "GET", "/users/auth", nil, account, tls)
    assert(result.body.authorized == "OK")
    assert(captured.headers["x-auth-user"] == account.username)
    assert(captured.headers["x-auth-key"] == account.key)
    assert(captured.headers.Authorization == nil and captured.redirect == false)
    assert(type(captured.create) == "function")
end)
test("public pairing never sends an account credential", function()
    response = { code = 200, body = "ok" }
    Transport.request("https://example.test", "POST", "/pairings", {}, nil, tls)
    assert(captured.headers["x-auth-key"] == nil)
end)
test("JSON null is an explicit no-progress response", function()
    response = { code = 200, body = "null" }
    local result = Transport.request("https://example.test", "GET", "/books/book/progress", nil, account, tls)
    assert(result.body == false and not result.error)
end)
test("empty successful deletes are accepted", function()
    response = { code = 204, body = "" }
    assert(not Transport.request("https://example.test", "DELETE", "/devices/id", nil, account, tls).error)
end)
test("malformed and unauthorized responses remain explicit failures", function()
    response = { code = 200, body = "invalid" }
    assert(Transport.request("https://example.test", "GET", "/users/auth", nil, account, tls).error)
    response = { code = 401, body = "error" }
    local result = Transport.request("https://example.test", "GET", "/users/auth", nil, account, tls)
    assert(result.error == "Invalid credentials" and result.code == 401)
end)
test("redirects do not become successful account requests", function()
    response = { code = 302, body = "" }
    assert(Transport.request("https://example.test", "GET", "/users/auth", nil, account, tls).error)
    assert(captured.redirect == false)
end)
test("body receive time and response bytes are bounded", function()
    response = { code = 200, body = "ok", elapsed = 21 }
    assert(Transport.request("https://example.test", "GET", "/users/auth", nil, account, tls).error)
    now = 0
    response = { code = 200, body = string.rep("x", 4 * 1024 * 1024 + 1) }
    assert(Transport.request("https://example.test", "GET", "/users/auth", nil, account, tls).error)
end)
print("Passed " .. passed .. " transport contract tests.")
