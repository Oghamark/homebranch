local ConfirmBox = require("ui/widget/confirmbox")
local DataStorage = require("datastorage")
local Device = require("device")
local Event = require("ui/event")
local InfoMessage = require("ui/widget/infomessage")
local InputDialog = require("ui/widget/inputdialog")
local LuaSettings = require("luasettings")
local NetworkMgr = require("ui/network/manager")
local Trapper = require("ui/trapper")
local UIManager = require("ui/uimanager")
local WidgetContainer = require("ui/widget/container/widgetcontainer")
local sha2 = require("ffi/sha2")
local util = require("util")
local logger = require("logger")

local Homebranch = WidgetContainer:extend { name = "homebranch", is_doc_only = true }
local colors = {
    yellow = "#ffff00", green = "#90ee90", blue = "#87cefa",
    red = "#ff8080", orange = "#ffa500", purple = "#c8a2c8", gray = "#c0c0c0",
}

local function uuid()
    local file = assert(io.open("/dev/urandom", "rb"), "Secure random source unavailable.")
    local bytes = file:read(16)
    file:close()
    assert(bytes and #bytes == 16, "Secure random source unavailable.")
    local hex = bytes:gsub(".", function(c) return string.format("%02x", c:byte()) end)
    return hex:sub(1, 8) .. "-" .. hex:sub(9, 12) .. "-4" .. hex:sub(14, 16)
        .. "-a" .. hex:sub(18, 20) .. "-" .. hex:sub(21)
end

function Homebranch:notice(text)
    UIManager:show(InfoMessage:new { text = text })
end

function Homebranch:init()
    self.epoch = 0
    self.anchors = dofile(self.path .. "/anchors.lua")
    self.identity = dofile(self.path .. "/identity.lua")
    self.state_ops = dofile(self.path .. "/state.lua")
    self.transport = dofile(self.path .. "/transport.lua")
    self.tls = dofile(self.path .. "/tls.lua")
    self.store = LuaSettings:open(DataStorage:getSettingsDir() .. "/homebranch.lua")
    self.settings = self.store:readSetting("settings", { auto_sync = true })
    self.run_task = function() self:startSync(false) end
    self.claim_task = function() self:claimPairing() end
    self.ui.menu:registerToMainMenu(self)
end

function Homebranch:save()
    self.store:saveSetting("settings", self.settings)
    self.store:flush()
end

function Homebranch:isEpub()
    return self.ui.rolling and self.ui.document and self.ui.document.file
        and self.ui.document.file:lower():match("%.epub$")
end

function Homebranch:request(method, path, body, anonymous)
    local epoch = self.epoch
    local completed, result = Trapper:dismissableRunInSubprocess(function()
        return self.transport.request(self.settings.server, method, path, body,
            not anonymous and self.settings.account or nil, self.tls)
    end, "Connecting to Homebranch...")
    if epoch ~= self.epoch then error("Homebranch operation cancelled because the document or account changed.") end
    if not completed then error("Homebranch request interrupted; pending changes were retained.") end
    if not result or result.error then error(result and result.error or "Homebranch request failed.") end
    return result.body
end

function Homebranch:wrapped(task)
    Trapper:wrap(function()
        local ok, err = pcall(task)
        if not ok then
            -- Transport errors exclude credentials and request bodies.
            logger.warn("Homebranch sync failed")
            self:notice("Homebranch: " .. tostring(err))
        end
    end)
end

function Homebranch:configure()
    local dialog
    dialog = InputDialog:new {
        title = "Homebranch sync URL (HTTPS)",
        input = self.settings.server or "https://homebranch.example/api/koreader",
        buttons = {{
            { text = "Cancel", callback = function() UIManager:close(dialog) end },
            { text = "Save", callback = function()
                local url = dialog:getInputText():gsub("/+$", "")
                if not url:match("^https://[^/%s?#]+[/]?[^%s?#]*$") then
                    self:notice("Enter an HTTPS URL without credentials, query, or fragment.")
                    return
                end
                if url:match("^https://[^/]*@") then self:notice("Credentials are not allowed in the URL."); return end
                if self.settings.account and url ~= self.settings.server then
                    self:notice("Forget this device before switching servers.")
                    return
                end
                if url ~= self.settings.server then
                    self.epoch = self.epoch + 1
                    UIManager:unschedule(self.claim_task)
                    self.pairing = nil
                end
                self.settings.server = url
                self:save()
                UIManager:close(dialog)
            end },
        }},
    }
    UIManager:show(dialog)
    dialog:onShowKeyboard()
end

function Homebranch:pair()
    if not self.settings.server then self:configure(); return end
    if self.settings.account then self:notice("Forget this device before pairing a different account."); return end
    NetworkMgr:runWhenOnline(function()
        self:wrapped(function()
            local pairing = self:request("POST", "/pairings", { deviceName = Device.model }, true)
            self.pairing = pairing
            self.pairing.expires_at = os.time() + pairing.expiresIn
            self:notice("In your signed-in Homebranch browser, open Settings > KOReader and approve code:\n\n"
                .. pairing.userCode .. "\n\nOnly a revocable sync-only key will be stored in KOReader settings. "
                .. "Anyone who can read that file can use this key. Your Homebranch password is never stored here.")
            UIManager:scheduleIn(pairing.interval or 5, self.claim_task)
        end)
    end)
end

function Homebranch:claimPairing()
    if not self.pairing then return end
    if os.time() >= self.pairing.expires_at then
        self.pairing = nil
        self:notice("Homebranch pairing expired. Start pairing again.")
        return
    end
    self:wrapped(function()
        local response = self:request("POST", "/pairings/claim", { deviceCode = self.pairing.deviceCode }, true)
        if response.state == "pending" then
            UIManager:scheduleIn(self.pairing.interval or 5, self.claim_task)
        elseif response.state == "approved" and response.username and response.key and response.deviceId then
            self.settings.account = {
                username = response.username, key = response.key, deviceId = response.deviceId, documents = {},
            }
            self.pairing = nil
            self.current_state = nil
            self.link_verified = nil
            self:save()
            self:notice("Homebranch paired. Use Sync now to link this EPUB and synchronize.")
        else error("Unexpected pairing response. Start pairing again.") end
    end)
end

function Homebranch:forget()
    UIManager:show(ConfirmBox:new {
        text = "Forget this device and discard its queued changes? Revoke the device in Homebranch Settings "
            .. "to also invalidate the server credential. This is required if the device settings were copied.",
        ok_text = "Forget",
        ok_callback = function()
            self.epoch = self.epoch + 1
            UIManager:unschedule(self.run_task)
            UIManager:unschedule(self.claim_task)
            self.pairing = nil
            if self.settings.account then
                for _, item in ipairs(self.ui.annotation.annotations) do
                    if item.drawer then item.homebranch_owner = item.homebranch_owner or self.settings.account.username end
                end
                self.ui.doc_settings:saveSetting("annotations", self.ui.annotation.annotations)
                self.ui.doc_settings:flush()
            end
            self.settings.account = nil
            self.current_state = nil
            self.link_verified = nil
            self:save()
        end,
    })
end

function Homebranch:chooseFormat()
    local state = self.current_state
    if not state then self:notice("Pair this reader and open an EPUB first."); return end
    if state.bookId then
        self:notice("This EPUB is already verified as format:\n" .. state.formatId
            .. "\n\nA linked EPUB is not silently reassigned to another book.")
        return
    end
    local dialog
    dialog = InputDialog:new {
        title = "EPUB format ID from the Homebranch reader",
        input = state.formatHint or "",
        buttons = {{
            { text = "Cancel", callback = function() UIManager:close(dialog) end },
            { text = "Use format", callback = function()
                local value = dialog:getInputText()
                if value ~= "" and (#value ~= 36 or not value:match("^[%x%-]+$")) then
                    self:notice("Enter an EPUB format UUID, or leave empty for automatic matching.")
                    return
                end
                state.formatHint = value ~= "" and value or nil
                self:save()
                UIManager:close(dialog)
            end },
        }},
    }
    UIManager:show(dialog)
    dialog:onShowKeyboard()
end

function Homebranch:payload(item)
    local anchor, err = self.anchors.capture(self.ui.document, item)
    if not anchor then return nil, err end
    -- Retain a web resource selector when only notes/style changed locally.
    local state = self.current_state
    local previous = state and state.known[item.homebranch_id]
    if previous and previous.body.anchor then anchor.href = previous.body.anchor.href end
    return {
        quote = item.text or anchor.exact,
        note = item.note or "",
        color = item.homebranch_native_color == item.color and item.homebranch_color
            or colors[item.color] or "#ffff00",
        anchor = anchor,
        deleted = false,
    }
end

function Homebranch:fingerprint(payload)
    local anchor = payload.anchor
    return sha2.sha256(table.concat({
        payload.quote, payload.note, payload.color, tostring(payload.deleted),
        anchor.exact, anchor.native and anchor.native.pos0 or "", anchor.native and anchor.native.pos1 or "",
    }, "\0"))
end

function Homebranch:collect()
    local state = self.current_state
    if not state or self.applying then return end
    assert(not state.incoming, "An interrupted remote annotation update must finish. Run Sync now before editing.")
    local owned, ignored, excluded = {}, {}, 0
    for _, item in ipairs(self.ui.annotation.annotations) do
        if item.drawer then
            item.homebranch_owner = item.homebranch_owner or self.settings.account.username
            if item.homebranch_owner == self.settings.account.username then
                item.homebranch_document = item.homebranch_document or state.documentKey
            end
            if item.homebranch_owner == self.settings.account.username
                and item.homebranch_document == state.documentKey then
                owned[#owned + 1] = item
            else
                excluded = excluded + 1
                if item.homebranch_id then ignored[item.homebranch_id] = true end
            end
        end
    end
    self.excluded_annotations = excluded
    local ok, err = self.state_ops.collect(state, owned,
        function(item) return self:payload(item) end,
        function(payload) return self:fingerprint(payload) end, uuid, ignored)
    if not ok then error(err) end
    self.ui.doc_settings:saveSetting("annotations", self.ui.annotation.annotations)
    self.ui.doc_settings:flush()
    self:save()
end

function Homebranch:install(remote, position, existing)
    local item = existing or { datetime = os.date("%Y-%m-%d %H:%M:%S") }
    item.homebranch_id = remote.id
    item.homebranch_owner = self.settings.account.username
    item.homebranch_document = self.current_state.documentKey
    item.page, item.pos0, item.pos1 = position.pos0, position.pos0, position.pos1
    item.text, item.note, item.drawer = remote.quote, remote.note ~= "" and remote.note or nil, item.drawer or "lighten"
    item.color = "yellow"
    for name, color in pairs(colors) do
        if remote.color:lower() == color then item.color = name; break end
    end
    item.homebranch_color, item.homebranch_native_color = remote.color, item.color
    item.datetime_updated = os.date("%Y-%m-%d %H:%M:%S")
    item.chapter = self.ui.toc:getTocTitleByPage(item.page)
    return item
end

function Homebranch:apply(remote)
    local was_applying = self.applying
    self.applying = true
    local completed, ok, result = pcall(self.state_ops.apply,
        self.current_state, remote, self.ui.annotation.annotations,
        function(anchor) return self.anchors.resolve(self.ui.document, anchor) end,
        function(payload) return self:fingerprint(payload) end,
        function(annotation, position, existing) return self:install(annotation, position, existing) end)
    self.applying = was_applying
    if not completed then error(ok) end
    if ok and not remote.deleted then
        self.current_state.known[remote.id] = { body = remote }
        local payload = assert(self:payload(result))
        self.current_state.known[remote.id] = {
            body = payload, signature = self:fingerprint(payload), deleted = false,
        }
    end
    return ok
end

function Homebranch:applyIncoming()
    local state = self.current_state
    local response = state and state.incoming
    if not response then return end
    self:save()
    local was_applying = self.applying
    self.applying = true
    local ok, err = pcall(function()
        for _, annotation in ipairs(response.items) do self:apply(annotation) end
        self.ui.annotation:updateAnnotations(true, true)
        self.ui.doc_settings:saveSetting("annotations", self.ui.annotation.annotations)
        self.ui.doc_settings:flush()
        state.cursor = response.cursor
        state.incoming = nil
        self:save()
    end)
    self.applying = was_applying
    if not ok then state.incoming = response; error(err) end
end

function Homebranch:syncAnnotations()
    self:applyIncoming()
    self:collect()
    local state = self.current_state
    while #state.pending > 0 do
        local operation = state.pending[1]
        self:request("PUT", "/books/" .. state.bookId .. "/annotations/" .. operation.id, operation.body)
        self.state_ops.acknowledge(state, operation.body.mutationId)
        self:save()
    end
    local response
    repeat
        response = self:request("GET", "/books/" .. state.bookId .. "/annotations?after=" .. state.cursor)
        assert(type(response.items) == "table" and type(response.cursor) == "string", "Invalid annotation response.")
        state.incoming = response
        self:applyIncoming()
    until not response.hasMore
    -- An unresolved item may become resolvable after a reader DOM upgrade.
    local unresolved = {}
    for _, item in pairs(state.unresolved) do unresolved[#unresolved + 1] = item.annotation end
    if #unresolved > 0 then
        state.incoming = { items = unresolved, cursor = state.cursor }
        self:applyIncoming()
    end
    UIManager:setDirty(self.ui.dialog, "ui")
end

function Homebranch:offerProgress(progress)
    if type(progress) ~= "table" or type(progress.percentage) ~= "number" then return end
    local state = self.current_state
    local epoch = self.epoch
    if progress.revision == state.seenProgress then return end
    local local_percent = self.ui.rolling:getLastPercent()
    if math.abs(progress.percentage - local_percent) < 0.001 then
        state.seenProgress = progress.revision
        self:save()
        return
    end
    local exact = progress.source == "koreader" and type(progress.nativeProgress) == "string"
        and self.ui.document:isXPointerInDocument(progress.nativeProgress)
    UIManager:show(ConfirmBox:new {
        text = string.format("Jump to %s%.1f%% from %s?",
            exact and "" or "approximately ", progress.percentage * 100, progress.device or "another reader"),
        ok_text = exact and "Jump" or "Jump approximately",
        ok_callback = function()
            if epoch ~= self.epoch or self.current_state ~= state then return end
            self.applying = true
            if exact then self.ui:handleEvent(Event:new("GotoXPointer", progress.nativeProgress))
            else self.ui:handleEvent(Event:new("GotoPercent", progress.percentage * 100)) end
            self.applying = false
            state.lastProgress = self.ui.rolling:getLastProgress()
            state.pendingProgress = nil
            state.seenProgress = progress.revision
            self:save()
        end,
        cancel_callback = function()
            if epoch ~= self.epoch or self.current_state ~= state then return end
            state.seenProgress = progress.revision
            state.lastProgress = nil
            state.pendingProgress = {
                document = self.ui.doc_settings:readSetting("partial_md5_checksum")
                    or util.partialMD5(self.ui.document.file),
                progress = self.ui.rolling:getLastProgress(), percentage = self.ui.rolling:getLastPercent(),
                device = Device.model, device_id = self.settings.account.deviceId, mutationId = uuid(),
            }
            self:save()
        end,
    })
end

function Homebranch:pushProgress(state)
    local operation = state.pendingProgress
    self:request("PUT", "/syncs/progress", operation)
    local accepted = self:request("GET", "/books/" .. state.bookId .. "/progress")
    if type(accepted) == "table" and accepted.nativeProgress == operation.progress then
        state.seenProgress = accepted.revision
    end
    state.lastProgress = operation.progress
    if state.pendingProgress and state.pendingProgress.mutationId == operation.mutationId then
        state.pendingProgress = nil
    end
    self:save()
end

function Homebranch:documentState(digest)
    local content_hash, reason = self.identity.contentHash(self.ui.document, sha2.sha256)
    local key = content_hash or digest
    local state = self.state_ops.document(self.settings.account, key)
    state.documentKey, state.contentHash, state.identityWarning = key, content_hash, reason
    return state
end

function Homebranch:sync(interactive)
    if not self:isEpub() then error("Homebranch sync currently supports EPUB only.") end
    local account = self.settings.account
    assert(account, "Pair this reader with Homebranch first.")
    local digest = self.ui.doc_settings:readSetting("partial_md5_checksum")
        or util.partialMD5(self.ui.document.file)
    assert(digest, "Could not identify this EPUB.")
    local state = self.current_state or self:documentState(digest)
    self.current_state = state
    if not self.link_verified then
        local match = self:request("POST", "/documents/resolve", {
            document = digest, contentHash = state.contentHash, formatId = state.formatHint or state.formatId,
        })
        assert(not state.bookId or state.bookId == match.bookId,
            "Homebranch returned a different book for this EPUB. Previous local sync data was retained.")
        state.bookId, state.formatId = match.bookId, match.formatId
        assert(state.bookId and state.formatId, "Homebranch could not verify this EPUB.")
        self.link_verified = true
        self:save()
    end
    local remote = self:request("GET", "/books/" .. state.bookId .. "/progress")
    self:syncAnnotations()
    -- Do not overwrite an unseen remote position just because the book opened.
    if type(remote) == "table" and remote.revision ~= state.seenProgress then
        self:offerProgress(remote)
    elseif state.pendingProgress then
        self:pushProgress(state)
    elseif interactive and (type(remote) ~= "table" or not remote.percentage) then
        state.pendingProgress = {
            document = digest, progress = self.ui.rolling:getLastProgress(),
            percentage = self.ui.rolling:getLastPercent(), device = Device.model, device_id = account.deviceId,
            mutationId = uuid(),
        }
        self:save()
        self:pushProgress(state)
    end
    if interactive then
        local count = 0
        for _ in pairs(state.unresolved) do count = count + 1 end
        local message = count > 0 and ("Homebranch synchronized. " .. count
            .. " annotation(s) unresolved. See Homebranch > Unresolved annotations.") or "Homebranch synchronized."
        if self.excluded_annotations and self.excluded_annotations > 0 then
            message = message .. "\n\n" .. self.excluded_annotations
                .. " local annotation(s) from another pairing or edition were not uploaded."
        end
        if state.identityWarning then
            message = message .. "\n\nContent-hash matching unavailable: " .. state.identityWarning
                .. " The EPUB was matched by its binary checksum."
        end
        self:notice(message)
    end
end

function Homebranch:startSync(interactive)
    if self.busy or not self.settings.account or not self:isEpub() then
        if interactive then self:notice("Pair this device and open an EPUB first.") end
        return
    end
    if not interactive and not NetworkMgr:isOnline() then return end
    local run = function()
        self:wrapped(function()
            local epoch = self.epoch
            self.busy = true
            local ok, err = pcall(function() self:sync(interactive) end)
            self.busy = false
            if not ok then
                self.failures = (self.failures or 0) + 1
                if epoch == self.epoch and self.settings.auto_sync and self.failures <= 5 then
                    UIManager:scheduleIn(math.min(300, 10 * 2 ^ self.failures), self.run_task)
                end
                error(err)
            end
            self.failures = 0
        end)
    end
    if interactive then NetworkMgr:runWhenOnline(run) else run() end
end

function Homebranch:onAnnotationsModified()
    if self.applying or not self.settings.account or not self:isEpub() then return end
    if self.current_state then
        local ok, err = pcall(function() self:collect() end)
        if not ok then self:notice("Homebranch: " .. tostring(err)) end
    end
    if self.settings.auto_sync then UIManager:unschedule(self.run_task); UIManager:scheduleIn(5, self.run_task) end
end

function Homebranch:onPageUpdate()
    if self.applying or not self.settings.account or not self.current_state or not self:isEpub() then return end
    local state = self.current_state
    local progress = self.ui.rolling:getLastProgress()
    if state.lastProgress ~= progress then
        local digest = self.ui.doc_settings:readSetting("partial_md5_checksum") or util.partialMD5(self.ui.document.file)
        state.pendingProgress = {
            document = digest, progress = progress, percentage = self.ui.rolling:getLastPercent(),
            device = Device.model, device_id = self.settings.account.deviceId,
            mutationId = uuid(),
        }
        self:save()
        if self.settings.auto_sync then UIManager:unschedule(self.run_task); UIManager:scheduleIn(10, self.run_task) end
    end
end

Homebranch.onPosUpdate = Homebranch.onPageUpdate

function Homebranch:onReaderReady()
    self.current_state = nil
    self.link_verified = nil
    if self.settings.account and self:isEpub() then
        local digest = self.ui.doc_settings:readSetting("partial_md5_checksum") or util.partialMD5(self.ui.document.file)
        self.current_state = digest and self:documentState(digest) or nil
        if self.current_state then
            local ok, err = pcall(function() self:applyIncoming() end)
            if not ok then self:notice("Homebranch: " .. tostring(err)) end
            self.current_state.lastProgress = self.ui.rolling:getLastProgress()
        end
        if self.settings.auto_sync then UIManager:scheduleIn(2, self.run_task) end
    end
end

function Homebranch:onNetworkConnected()
    if self.settings.auto_sync then UIManager:unschedule(self.run_task); UIManager:scheduleIn(2, self.run_task) end
end

function Homebranch:onCloseDocument()
    self.epoch = self.epoch + 1
    if self.current_state and self:isEpub() then
        local ok, err = pcall(function() self:collect() end)
        if not ok then self:notice("Homebranch: " .. tostring(err)) end
    end
    UIManager:unschedule(self.run_task)
    UIManager:unschedule(self.claim_task)
    self.current_state = nil
    self.link_verified = nil
end

function Homebranch:addToMainMenu(menu)
    menu.homebranch = {
        text = "Homebranch",
        sub_item_table = {
            { text = "Sync URL", callback = function() self:configure() end },
            { text = "Pair device", callback = function() self:pair() end },
            { text = "Check pairing", callback = function() self:claimPairing() end },
            { text = "Sync now", callback = function() self:startSync(true) end },
            { text = "EPUB format link", callback = function() self:chooseFormat() end },
            { text = "Automatic sync", checked_func = function() return self.settings.auto_sync end,
                callback = function()
                    self.settings.auto_sync = not self.settings.auto_sync
                    if not self.settings.auto_sync then UIManager:unschedule(self.run_task) end
                    self:save()
                end },
            { text = "Unresolved annotations", callback = function()
                local messages = {}
                for _, item in pairs(self.current_state and self.current_state.unresolved or {}) do
                    local note = item.annotation.note or ""
                    messages[#messages + 1] = item.reason .. "\n" .. item.annotation.quote
                        .. (note ~= "" and ("\n\n" .. note) or "")
                end
                self:notice(#messages > 0 and table.concat(messages, "\n\n") or "No unresolved annotations.")
            end },
            { text = "Forget device", callback = function() self:forget() end },
        },
    }
end

return Homebranch
