local TLS = {}

function TLS.matchesName(host, pattern)
    host, pattern = host:lower(), pattern:lower()
    if host == pattern then return true end
    local suffix = pattern:match("^%*%.([^*]+)$")
    if not suffix or not suffix:find("%.") then return false end
    local first, rest = host:match("^([^.]+)%.(.+)$")
    return first ~= nil and rest == suffix
end

function TLS.verifyName(host, certificate)
    local extensions = certificate:extensions()
    local san = extensions and extensions["2.5.29.17"]
    if not san then return false end
    -- SAN is required; legacy CN fallback is intentionally not supported.
    local is_ip = host:match("^%d+%.%d+%.%d+%.%d+$") or host:find(":", 1, true)
    if not is_ip then
        for _, name in ipairs(san.dNSName or {}) do
            if TLS.matchesName(host, name) then return true end
        end
    end
    for _, address in ipairs(san.iPAddress or {}) do
        if host == address then return true end
    end
    return false
end

function TLS.create()
    local create = require("ssl.https").tcp({
        protocol = "tlsv1_2",
        verify = "peer",
        cafile = "data/ca-bundle.crt",
        options = { "all", "no_sslv2", "no_sslv3", "no_tlsv1", "no_tlsv1_1" },
    })
    return function()
        local connection = create()
        local connect = connection.connect
        function connection:connect(host, port)
            local ok, err = connect(self, host, port)
            if not ok then return nil, err end
            local certificate = self:getpeercertificate()
            if not certificate or not TLS.verifyName(host, certificate) then
                self:close()
                return nil, "TLS certificate hostname mismatch."
            end
            return 1
        end
        return connection
    end
end

return TLS
