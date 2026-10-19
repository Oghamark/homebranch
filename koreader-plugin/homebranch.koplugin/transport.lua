local http = require("socket.http")
local ltn12 = require("ltn12")
local json = require("rapidjson")
local socketutil = require("socketutil")
local socket = require("socket")

local Transport = {}

function Transport.request(base, method, path, body, account, tls)
    if not base:match("^https://[^/]+") then
        return { error = "An HTTPS Homebranch API URL is required." }
    end
    local encoded = body and json.encode(body) or ""
    local headers = {
        ["Accept"] = "application/vnd.koreader.v1+json",
        ["Content-Type"] = "application/json",
        ["Content-Length"] = tostring(#encoded),
    }
    if account then
        headers["x-auth-user"] = account.username
        headers["x-auth-key"] = account.key
    end
    local chunks, size = {}, 0
    local started = socket.gettime()
    socketutil:set_timeout(5, 20)
    local ok, code = http.request({
        url = base .. path,
        method = method,
        headers = headers,
        redirect = false,
        create = tls.create(),
        source = encoded ~= "" and ltn12.source.string(encoded) or nil,
        sink = function(chunk)
            if socket.gettime() - started > 20 then return nil, "Homebranch request timed out." end
            if chunk then
                size = size + #chunk
                if size > 4 * 1024 * 1024 then return nil, "Response exceeds sync limit." end
                chunks[#chunks + 1] = chunk
            end
            return 1
        end,
    })
    socketutil:reset_timeout()
    if not ok then return { error = "Homebranch could not be reached: " .. tostring(code) } end
    local result = json.decode(table.concat(chunks))
    if type(code) ~= "number" or code < 200 or code >= 300 then
        return {
            code = code,
            error = type(result) == "table" and type(result.message) == "string"
                and result.message or ("Homebranch returned HTTP " .. tostring(code)),
        }
    end
    if code == 204 then return { code = code, body = {} } end
    if result == json.null then return { code = code, body = false } end
    if type(result) ~= "table" then return { code = code, error = "Homebranch returned invalid JSON." } end
    return { code = code, body = result }
end

return Transport
