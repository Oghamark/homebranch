local State = {}

function State.document(account, digest)
    account.documents = account.documents or {}
    local state = account.documents[digest]
    if not state then
        state = { known = {}, pending = {}, unresolved = {}, cursor = "0" }
        account.documents[digest] = state
    end
    return state
end

function State.queue(state, id, payload, new_id)
    local operation = {}
    for key, value in pairs(payload) do operation[key] = value end
    operation.mutationId = new_id()
    state.pending[#state.pending + 1] = { id = id, body = operation }
end

function State.acknowledge(state, mutation_id)
    for index, operation in ipairs(state.pending) do
        if operation.body.mutationId == mutation_id then
            table.remove(state.pending, index)
            return true
        end
    end
    return false
end

function State.hasPending(state, id)
    for _, operation in ipairs(state.pending) do
        if operation.id == id then return true end
    end
    return false
end

function State.collect(state, items, encode, fingerprint, new_id, ignored_ids)
    local seen, changes = {}, {}
    for _, item in ipairs(items) do
        if item.drawer and type(item.pos0) == "string" and type(item.pos1) == "string" then
            item.homebranch_id = item.homebranch_id or new_id()
            local id = item.homebranch_id
            seen[id] = true
            local payload, err = encode(item)
            if not payload then return nil, err end
            local signature = fingerprint(payload)
            local previous = state.known[id]
            if not previous or previous.signature ~= signature or previous.deleted then
                changes[#changes + 1] = { id = id, body = payload, signature = signature, deleted = false }
            end
        end
    end
    for id, known in pairs(state.known) do
        -- An unresolved remote annotation has never been installed locally.
        if not seen[id] and not known.deleted and not state.unresolved[id]
            and not (ignored_ids and ignored_ids[id]) then
            local payload = {}
            for key, value in pairs(known.body) do payload[key] = value end
            payload.deleted = true
            changes[#changes + 1] = { id = id, body = payload, signature = known.signature, deleted = true }
        end
    end
    for _, change in ipairs(changes) do
        State.queue(state, change.id, change.body, new_id)
        state.known[change.id] = {
            signature = change.signature, body = change.body, deleted = change.deleted,
        }
    end
    return true
end

function State.apply(state, remote, items, resolve, fingerprint, install)
    if State.hasPending(state, remote.id) then return false, "Local changes are waiting to upload." end
    local index
    for i, item in ipairs(items) do
        if item.homebranch_id == remote.id then index = i; break end
    end
    if remote.deleted then
        if index then table.remove(items, index) end
        state.unresolved[remote.id] = nil
        state.known[remote.id] = { body = remote, deleted = true }
        return true
    end
    local position, err = resolve(remote.anchor)
    if not position then
        if index then table.remove(items, index) end
        state.unresolved[remote.id] = { annotation = remote, reason = err }
        return false, err
    end
    local item = install(remote, position, index and items[index])
    if index then items[index] = item else items[#items + 1] = item end
    state.unresolved[remote.id] = nil
    return true, item
end

return State
